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
   Manages image extraction and voxel building in a **Worker thread** (serialized via `Function.prototype.toString()`; falls back to main thread). Caches pixel data and cube arrays by signature to avoid redundant computation.

4. **Cubes → Rendered scene** (`src/VoxelPortraitScene.tsx`)  
   Renders via a single `InstancedMesh` (sphere geometry). Every `useFrame` tick it interpolates each cube between `initialPosition` and `explodedPosition` based on the external `progress` prop (0–1), plus hover/click gaussian influence fields, plus optional wave/twist/pulse effects. Color depth-cuing adjusts HSL brightness by Z position.

### Public Surface

`src/index.ts` is the sole export root. It re-exports:
- `VoxelPortraitCanvas` — the single consumer-facing component
- `defaultOptions` — merge target for configuration
- All types from `src/types/voxelPortrait.ts`

`VoxelPortraitScene` is **internal** — consumers never import it directly.

### Color Modes

Resolved in `src/lib/theme/colorResolver.ts`. Four modes: `solid`, `gradient`, `randomPalette`, `imageSampled`. CSS variables are resolved at generation time so colors are baked into cube data (not reactive to theme changes at render time).

### Key invariants

- Y-axis is **flipped** when converting from image pixel coordinates to 3D space (`y' = (centerY - pixelY) * cubeSize`).
- `frustumCulled = false` on the InstancedMesh — intentional, the geometry is small enough that culling overhead isn't worth it.
- The Worker is created inline by stringifying `buildVoxelPortrait` — this means the function must remain self-contained with no external imports.
- `prefers-reduced-motion` disables scroll-driven animation.

## Versioning

After every code change, ask the user whether they want to bump the version in `package.json` and suggest which bump is appropriate:

- **patch** (1.1.x) — bug fixes, internal refactors, doc/config-only changes with no API impact
- **minor** (1.x.0) — new options, new props, new exports, or new behavior that is fully backwards-compatible
- **major** (x.0.0) — removed or renamed props/exports, changed option shapes, or any change that breaks existing consumer code

Explain briefly why the change falls into that category so the user can confirm or override.

## Build Output

tsup builds to `dist/`:
- `index.js` — CommonJS
- `index.mjs` — ESM
- `index.d.ts` + `index.d.mts` — type declarations
