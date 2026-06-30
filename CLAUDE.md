# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # Bundle with tsup → dist/ (CJS + ESM + .d.ts)
npm run dev          # Watch mode bundling
npm run typecheck    # Type-check without emitting files
npm publish          # prepublishOnly runs build automatically
```

No test suite exists in this project.

## What This Is

A React component library (`@plotinium/voxel-portrait`) that converts images into scroll-driven 3D voxel portraits using React Three Fiber. Distributed as a dual-module package (ESM + CJS) with TypeScript declarations. React, Three.js, R3F, and Drei are **peer dependencies** — not bundled.

## Architecture

### Data Pipeline

The core flow is a one-way data pipeline:

1. **Image → Pixels** (`src/lib/image/extractImagePixels.ts`)  
   Loads an image into an off-screen canvas with configurable transforms (scale, rotation, offset, smoothing), then reads back raw RGBA pixel data.

2. **Pixels → Voxels** (`src/lib/voxel/buildVoxelPortrait.ts`)  
   Samples pixels at a density step, culls by alpha threshold, maps luminance to Z-depth, and picks up to `maxCubes` candidates using a 72% uniform spatial / 28% highest-detail heuristic. Produces `VoxelCubeData[]` with initial and exploded 3D positions, rotations, scales, and colors.

3. **Voxels → React state** (`src/VoxelPortraitCanvas.tsx`)  
   Manages image extraction and voxel building in a **Worker thread** (serialized via `Function.prototype.toString()`; falls back to main thread). **One worker is pooled per canvas instance** (`workerRef`, created lazily on first build, reused across image swaps, terminated on unmount); builds are matched to responses by an incrementing `requestId` echoed back by the worker, and the existing `prepareRunRef` latch still discards stale builds. The blob URL (`voxelBuildWorkerUrl`) is built once per page and shared by all worker instances. Caches pixel data and cube arrays by signature to avoid redundant computation. Resolves the **quality profile** (caps `maxCubes`/`maxResolution`, picks dpr/antialias/sphere segments) and drives the **particle-storm transition** state machine on image change (see below). The rendered cubes live in `displayCubes` — distinct from the freshly built array — so the old portrait can keep rendering while the storm plays.

4. **Cubes → Rendered scene** (`src/VoxelPortraitScene.tsx`)  
   Renders via a single `InstancedMesh` (sphere geometry) allocated once at a **fixed `capacity`** (= resolved `maxCubes`); image swaps only change `mesh.count`, never re-allocate GPU buffers. Both the `instanceMatrix` **and** the `instanceColor` buffers are sized to `capacity`: the persistent colour `Float32Array`s (`dimmedColorArray`/`pixelColorArray`, sized via `useMemo([instanceCapacity])`) are wrapped once by `bindInstanceColor` and re-filled **in place** on swap, so a swap never reallocates the colour buffer mid-storm. Color depth-cuing (`fillDimmedColors`, adjusting HSL brightness by Z position) and the flat-tile pixel colours (`fillPixelColors`) use module-level scratch `THREE.Color`/HSL objects — **allocation-free**, so the swap render produces no GC spike. Every `useFrame` tick interpolates each cube between `initialPosition` and `explodedPosition` based on the external `progress` prop (0–1), plus hover/click gaussian influence fields, plus optional wave/twist/pulse effects, plus the active particle-storm offset.

   Two hot-path optimizations: **idle frame-skipping** (the per-instance loop is skipped entirely when nothing can move — static progress, no hover, no effects, no storm) and **gated influence math** (the per-cube `sqrt`/`exp` gaussian only runs when hover/click boosts are active or imagePlane is hovered).

   On unmount the scene disposes both meshes' geometry, material(s), and instance buffers to avoid GPU-memory growth across SPA route changes. It also emits **`onPerfSample`** (`{ fps, dropped, dpr }`) roughly once per second from `useFrame`, accumulated in refs and placed **before** the idle-skip return so telemetry keeps flowing while static; the callback is held in `onPerfSampleRef` so it never becomes a render-loop dependency.

### Public Surface

`src/index.ts` is the sole export root. It re-exports:

- `VoxelPortraitCanvas` — the single consumer-facing component
- `DEFAULT_VOXEL_CANVAS_OPTIONS` — the full merged default options object (merge target for consumers)
- `VoxelPortraitCanvasOptions`, `VoxelPortraitColorOptions`, `VoxelTransitionOptions`, `VoxelStormPhase`, `PerfSample`, and all types from `src/types/voxelPortrait.ts`
- Transition registry: `TRANSITIONS`, `getTransitionField`, and types `TransitionField`/`TransitionContext`/`TransitionStyle`
- Quality helpers: `resolveQualityProfile`, `detectDeviceQuality`, and types `QualityLevel`/`QualityProfile`

`VoxelPortraitScene` is **internal** — consumers never import it directly.

### Consumer options vs internal config

`VoxelPortraitColorOptions` (in `VoxelPortraitCanvas.tsx`) is the consumer-facing color API: it adds `useTheme`, `cssVars`, and `fallbacks` on top of the four core modes. Before calling `buildVoxelPortrait`, the canvas resolves CSS variables, applies theme logic, and converts this to the internal `VoxelColorConfig` (from `src/types/voxelPortrait.ts`) that the builder understands.

### Color Modes

Four modes: `solid`, `gradient`, `randomPalette`, `imageSampled`. Colors are baked into cube data at generation time (not reactive to theme changes at render time).

Two separate color implementations exist intentionally:

- `src/lib/theme/colorResolver.ts` — full implementation with DOM fallback for named/HSL colors (used in `VoxelPortraitCanvas` to resolve CSS vars and `useTheme` logic).
- Inline utilities inside `buildVoxelPortrait` — handles only hex and `rgb()`/`rgba()` strings. This is a deliberate duplication: the Worker has no DOM access, so the full resolver cannot be used there.

Do not import from `colorResolver.ts` inside `buildVoxelPortrait.ts` — it would break Worker serialization.

### Modular lib files vs Worker-inlined logic

`src/lib/image/generateVoxelMap.ts` and `src/lib/animation/createExplosionTargets.ts` are clean, readable extractions of the pixel-to-points and points-to-cubes steps. They are **not used** by `buildVoxelPortrait.ts`, which re-implements the same logic inline to remain self-contained for Worker serialization. They exist as the maintainable reference; `buildVoxelPortrait.ts` is the Worker-safe copy.

### Quality system (`src/lib/quality/resolveQuality.ts`)

`options.quality` (`'auto' | 'off' | 'low' | 'medium' | 'high'`, default `'auto'`) resolves to a `QualityProfile` controlling dpr range, antialias, sphere segment count, and caps on `maxCubes`/`maxResolution`. The canvas applies the caps on top of the consumer's `generation` settings (`effectiveMaxCubes`/`effectiveMaxResolution`) and feeds them into the extraction/build signatures, so changing quality re-runs the pipeline. `'auto'` detects a device class from `hardwareConcurrency`/`deviceMemory`/UA and additionally renders drei's `<PerformanceMonitor>` to **live-throttle dpr** when FPS drops. Explicit levels disable runtime adaptation. `'off'` is the bypass profile: `Infinity` caps and `dprMin: 0`/`dprMax: Infinity` so nothing is capped and the consumer's `camera.dprMin`/`dprMax` and `generation` values are used verbatim (segments back to 10). `camera.dprMin`/`dprMax` always cap the profile's dpr for backwards compatibility.

### Particle-storm transitions (`src/lib/transitions/`)

On image change the canvas plays a continuous particle storm so the swap never feels frozen. The system is a **registry of `TransitionField` functions** keyed by name in `src/lib/transitions/index.ts` (`vortex`, `spiral`, `turbulence`, `nucleus`). **To add a new animation: add a `TransitionField` file and one registry entry** — no other wiring needed. Fields must be pure and allocation-free (they run per particle per frame); use the shared `seededUnit` from `src/lib/transitions/seed.ts` for per-index variety.

Two shared, **main-thread-only** helpers back the built-in fields (never import either into `buildVoxelPortrait.ts`):

- `src/lib/transitions/funnel.ts` — `placeOnAxis(out, px, py, axial, axis, tilt)` maps a point from canonical funnel space (radial `px`/`py` + signed `axial`) to world space for a numeric `axis` param (`0` into-screen/Z, `1` vertical/Y, `2` tilted by `tilt` radians).
- `src/lib/transitions/chaos.ts` — `applyChaos(out, index, stormTime, amount)` adds a cubic-skewed per-particle wander so a minority of particles escape the perfect motion (organic turbulence, not uniform jitter). Exposed to consumers via the shared `chaos` param on `vortex`/`spiral`/`nucleus`.

The built-in fields: `vortex` is a slim **snaking tube** whose centre line bends via layered sine waves keyed to along-axis position + time (uses `placeOnAxis`); `spiral` biases particles toward a tight, deep-sinking **drain core** (uses `placeOnAxis`); `nucleus` fills a sphere whose surface ripples with waves while the whole core drifts; `turbulence` is a center-less flowing cloud. All except `turbulence` apply `applyChaos`.

Coordination is split between canvas and scene:

- **Canvas** keeps the old `displayCubes` rendered, bumps the internal `transitionToken` state when `imageSrc` changes (starts disperse), and when the new build is ready swaps `displayCubes` and bumps the internal `sceneConvergeToken` state (starts converge). These two internal state counters are the scene's only storm drivers — they map onto the scene's `transitionToken` / `convergeToken` props. `transitionPendingRef` distinguishes a real image-change storm from a plain rebuild (e.g. quality change), which swaps instantly.
- **Scene** owns the timeline in refs (no re-renders): `disperse → hold → converge → idle`. `stormBlend` lerps each particle between its portrait position and the field's storm position. The data swap happens during `hold`, where positions are index-driven (data-independent), so the new cubes/colors appear invisibly inside the swirl. `minHold` guarantees a minimum storm even when the build is instant; the minimum total transition length is therefore `disperseDuration + minHold + convergeDuration`.

The `replayToken` prop replays the storm against the **current** cubes (no rebuild): the canvas bumps both internal token states (`transitionToken` + `sceneConvergeToken`) so the scene runs disperse→hold→converge back to the same portrait. Intended for previewing styles; it ignores `transition.enabled`/reduced-motion because it is an explicit action.

**Consumer-controlled storm (page transitions).** Three public props expose the disperse and converge triggers *separately* (unlike `replayToken`, which fires both at once):

- `disperseToken` bump → canvas bumps the internal `transitionToken` only → scene runs disperse → hold and **stays in `hold`** with no auto-converge. The canvas also clears `transitionPendingRef` so a stray image swap can't auto-converge the held storm.
- `convergeToken` bump → canvas bumps the internal `sceneConvergeToken` only → scene releases hold → converge → idle, reassembling the **currently mounted** cubes (no `imageSrc` change needed). The scene's existing `convergeRequestedRef` latch + `minHold` gate handle a converge bump that arrives during `disperse`.
- `onStormPhaseChange` is forwarded to the scene, which emits it from `useFrame` on every `phaseRef.current` change. The emit is placed **before the idle-frame-skip early-return** so the final `→ idle` still fires on the frame that renders nothing; the callback is held in a ref (`onStormPhaseChangeRef`) so it never becomes a render-loop dependency.

Like `replayToken`, these token-driven storms are explicit actions and ignore `transition.enabled`/reduced-motion.

### Key invariants

- Y-axis is **flipped** when converting from image pixel coordinates to 3D space (`y' = (centerY - pixelY) * cubeSize`).
- `frustumCulled = false` on the InstancedMesh — intentional, the geometry is small enough that culling overhead isn't worth it.
- The InstancedMesh `capacity` (`args` count) must stay **stable** across image swaps or R3F re-allocates GPU buffers (the hitch this design exists to avoid). It is derived from the resolved `maxCubes`, and the builder caps cube counts to it.
- The `instanceColor`/`pixelColor` `Float32Array`s must also be sized to `capacity` (not `cubes.length`) and re-filled in place — never replace the `InstancedBufferAttribute` on swap, or the colour GPU buffer reallocates mid-storm. The colour-fill loops must stay **allocation-free** (reuse the module-level scratch `THREE.Color`/HSL objects), since they run during the swap render.
- The Worker is created inline by stringifying `buildVoxelPortrait` — this means the function must remain self-contained with no external imports. `src/lib/transitions/` and `src/lib/quality/` run on the **main thread only** and must never be imported into `buildVoxelPortrait.ts`.
- `prefers-reduced-motion` disables scroll-driven animation **and** the image-change particle-storm transition (falls back to an instant swap). It does **not** disable the explicit token-driven storms (`replayToken`, `disperseToken`/`convergeToken`) — those are consumer actions and always run.

## Versioning

After every code change, ask the user whether they want to bump the version in `package.json` and suggest which bump is appropriate:

- **patch** (1.1.x) — bug fixes, internal refactors, doc/config-only changes with no API impact
- **minor** (1.x.0) — new options, new props, new exports, or new behavior that is fully backwards-compatible
- **major** (x.0.0) — removed or renamed props/exports, changed option shapes, or any change that breaks existing consumer code

Explain briefly why the change falls into that category so the user can confirm or override.

## Documentation upkeep

After every code change, also check whether `README.md` and this `CLAUDE.md` need updating to stay accurate, then **ask the user** whether to apply those doc updates. Treat them differently:

- **README.md** — consumer-facing. Update when the public API or observable behavior changes: new/changed/removed `options`, props, exports, defaults, peer-dependency requirements, or usage patterns. Internal refactors with no API impact usually need no README change.
- **CLAUDE.md** — agent-facing. Update when architecture, data flow, invariants, file responsibilities, or extension points change (e.g. a new lib module, a new registry, a changed worker/serialization constraint), even if the public API is unchanged.

Briefly state what you think should change in each file (or "no change needed") and why, then let the user confirm or override before editing the docs.

## Build Output

tsup builds to `dist/`:

- `index.js` — CommonJS
- `index.mjs` — ESM
- `index.d.ts` + `index.d.mts` — type declarations
