# voxel-portrait

> **[Try the live demo at plotinium.dev](https://plotinium.dev/)**

`@plotinium/voxel-portrait` is a React component that turns an image into a scroll-driven 3D voxel portrait using React Three Fiber.

It is designed for landing pages, portfolio sections, and immersive hero blocks where a static image needs a stronger visual treatment without building a custom Three.js scene from scratch.

It gives you a reusable canvas component instead of a one-off scene, so you can plug the effect into any React app and drive it with your own scroll or interaction state.

## Features

- Converts any source image into a voxel-based portrait
- Drives assembly and explosion with a `progress` value from `0` to `1`
- Plays a continuous particle-storm transition when the image changes (vortex, spiral, turbulence, or nucleus) so swaps never freeze
- Adaptive quality system (`auto` device detection + runtime FPS throttling) for smooth playback on low-end devices
- Supports image-sampled, solid, and gradient color modes
- Includes hover and click interaction controls
- Exposes rendering, lighting, camera, and effect options
- Ships ESM, CommonJS, and TypeScript declarations

## Installation

Install the package and its peer dependencies:

```bash
npm install @plotinium/voxel-portrait three @react-three/fiber @react-three/drei
```

You also need React 18+ and React DOM 18+ in the consuming app.

## When to use it

- You want an image-driven 3D hero section without building a Three.js scene manually
- You already have a scroll progress value and want it to control assembly or explosion
- You need a customizable visual component that stays reusable across projects

## Basic usage

```tsx
import { useEffect, useState } from 'react';
import { VoxelPortraitCanvas } from '@plotinium/voxel-portrait';

export default function HeroPortrait() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const maxScroll = Math.max(1, document.body.scrollHeight - window.innerHeight);
      setProgress(window.scrollY / maxScroll);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div style={{ height: 640 }}>
      <VoxelPortraitCanvas
        imageSrc="/portrait.png"
        progress={progress}
        options={{
          color: { mode: 'imageSampled' },
          generation: { maxCubes: 6000, density: 0.85 },
          interaction: { enableHover: true, enableClick: true },
        }}
      />
    </div>
  );
}
```

## Props

### `VoxelPortraitCanvas`

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `imageSrc` | `string` | Yes | Source image used to generate the voxel map |
| `fallbackImage` | `string` | No | Fallback image if the main image fails to load |
| `progress` | `number` | Yes | Animation progress, typically normalized between `0` and `1` |
| `options` | `VoxelPortraitCanvasOptions` | No | Rendering and behavior configuration |
| `onGenerationStateChange` | `(isGenerating: boolean) => void` | No | Called while image extraction or voxel generation is running so the consuming page can show its own loading UI |
| `replayToken` | `number` | No | Increment to replay the particle-storm transition against the current image (no rebuild) — useful for previewing styles. Fires even if `transition.enabled` is `false` or reduced-motion is set |
| `disperseToken` | `number` | No | Increment to start a storm and **hold it open** (disperse → hold) until `convergeToken` changes. For driving the storm as a route/page transition. Fires even if `transition.enabled` is `false` or reduced-motion is set |
| `convergeToken` | `number` | No | Increment to release a held storm (hold → converge) and reassemble the current portrait — no `imageSrc` change required. Respects `transition.minHold`; a bump received during `disperse` is latched until `hold` |
| `onStormPhaseChange` | `(phase: VoxelStormPhase) => void` | No | Called on every storm phase change (`idle` / `disperse` / `hold` / `converge`), including the final `→ idle`. Lets you sequence routing around the storm |
| `onPerfSample` | `(sample: PerfSample) => void` | No | Called ~once per second with `{ fps, dropped, dpr }` render-loop telemetry. Held in a ref internally, so passing a fresh closure each render won't re-render the canvas |

## Configuration overview

`options` is grouped by concern so you can tune the effect without wiring your own scene:

- `quality`: `'auto' | 'off' | 'low' | 'medium' | 'high'` (default `'auto'`). Controls render resolution (dpr), antialiasing, voxel detail, and image/cube caps. `'auto'` detects the device and live-throttles dpr when the frame rate drops; explicit levels are fixed. `'off'` disables the quality system entirely — no caps and no runtime throttling, using your `camera`/`generation` values verbatim.
- `transition`: particle-storm animation played when `imageSrc` changes (see below)
- `color`: solid, gradient, or image-sampled color behavior
- `render`: portrait scale, image scale, offset, rotation, and `preserveDrawingBuffer` (default `false` — only enable if you capture the canvas via `toDataURL()`/`toBlob()`, since it disables a browser fast path)
- `generation`: voxel density, cube size, alpha threshold, and max cube count
- `explosion`: explosion strength, depth, rotation, and seed
- `interaction`: scroll, hover, click, and cursor influence settings
- `camera`: field of view, camera distance, and DPR limits
- `lighting`: ambient, key, and fill lighting
- `controls`: pan, zoom, and rotate toggles for orbit controls
- `effects`: optional wave, twist, and pulse modifiers
- `imagePlane`: optional flat-image to voxel transition mode

The package also exports `DEFAULT_VOXEL_CANVAS_OPTIONS` if you want to inspect or extend the built-in defaults.

### Image-change transition

When `imageSrc` changes, the current portrait scatters into a swirling particle storm, keeps moving while the next image is prepared, then reassembles into the new portrait — so there is no frozen gap during loading. It is enabled by default and respects `prefers-reduced-motion` (falling back to an instant swap).

```tsx
<VoxelPortraitCanvas
  imageSrc={currentImage}
  progress={progress}
  options={{
    quality: 'auto',
    transition: {
      enabled: true,
      style: 'vortex',          // 'vortex' | 'spiral' | 'turbulence' | 'nucleus'
      disperseDuration: 0.6,    // seconds to scatter into the storm
      convergeDuration: 0.7,    // seconds to reassemble the new image
      minHold: 0.25,            // minimum storm duration (hides fast loads)
      params: { bend: 3.2, chaos: 0.6 }, // per-style tuning
    },
  }}
/>
```

`params` are per-style numeric tuning values:

- **`vortex`** — a living, snaking tube whose centre line bends unpredictably. `radius` (tube), `length`, `tip` (far-end/near-end ratio), `speed`, `bend` (how far the centre line snakes), and `axis` to orient it: `2` tilted (default), `0` into the screen, `1` vertical. `tilt` sets the angle (radians) when `axis` is `2`.
- **`spiral`** — a draining water vortex collapsing into a tight core. `radius` (rim), `turns`, `pull` (core density bias), `depth` (drain sink), `speed`, plus the same `axis`/`tilt` (defaults to `0`, into the screen).
- **`nucleus`** — a pulsing spherical blob whose surface ripples with waves while the whole core drifts. `radius`, `amplitude` (wave push), `speed`, `drift` (how far the core wanders).
- **`turbulence`** — a center-less flowing cloud. `radius` (spread), `speed`, `amplitude`.

`vortex`, `spiral`, and `nucleus` also share a **`chaos`** dial: it lets a minority of particles break free of the perfect motion for an organic feel (set `0` for clean geometry).

Built-in styles live in a registry, so additional animations can be added in the library without changing the public API. Available styles are exported via `TRANSITIONS` (e.g. `Object.keys(TRANSITIONS)`).

To preview a style without changing the image, increment the `replayToken` prop — it replays the storm against the current portrait with no rebuild:

```tsx
const [replay, setReplay] = useState(0);

<VoxelPortraitCanvas imageSrc={src} progress={progress} replayToken={replay} options={{ transition: { style } }} />
<button onClick={() => setReplay((n) => n + 1)}>Preview animation</button>
```

### Consumer-controlled storm (page transitions)

For route/page transitions you often want to **scatter on demand, hold the storm open for an
arbitrary duration while the next page loads, then reassemble on a separate signal**. Unlike
`replayToken` (a single fixed auto-cycle), `disperseToken` and `convergeToken` are two
**independent** triggers, and `onStormPhaseChange` reports the phase so you can sequence
routing:

```tsx
import {
  VoxelPortraitCanvas,
  type VoxelStormPhase,
} from '@plotinium/voxel-portrait';

const [disperseToken, setDisperseToken] = useState(0);
const [convergeToken, setConvergeToken] = useState(0);

function startTransition(nextRoute: string) {
  setDisperseToken((n) => n + 1); // scatter, then hold open indefinitely
}

function handleStormPhase(phase: VoxelStormPhase) {
  if (phase === 'hold') {
    router.push(nextRoute);        // navigate while the storm holds
  }
  if (phase === 'idle') {
    // converge finished — reveal the new page, re-enable input
  }
}

// once the new route is mounted (and minHold has elapsed):
function release() {
  setConvergeToken((n) => n + 1); // reassemble the current portrait
}

<VoxelPortraitCanvas
  imageSrc={src}
  progress={0}
  disperseToken={disperseToken}
  convergeToken={convergeToken}
  onStormPhaseChange={handleStormPhase}
/>;
```

Behaviour:

- After a `disperseToken` bump the storm reaches `hold` and **stays there indefinitely** — it
  is your job to bump `convergeToken` to release it.
- `convergeToken` reassembles **whatever portrait is currently mounted**; no `imageSrc` change
  is required. A bump that arrives during `disperse` is latched and applied once `hold` is
  reached (and `transition.minHold` has elapsed).
- `onStormPhaseChange` fires for every phase change, including the final `→ idle`.
- Timing/style come from `options.transition.*` (`disperseDuration`, `convergeDuration`,
  `minHold`, `style`, `params`).
- Like `replayToken`, the token-driven storm is an explicit action: it runs even when
  `transition.enabled` is `false` or reduced-motion is set. If you want reduced-motion users to
  skip it, gate your own token bumps on a `prefers-reduced-motion` check.

## Exports

```ts
import {
  VoxelPortraitCanvas,
  DEFAULT_VOXEL_CANVAS_OPTIONS,
  TRANSITIONS,          // registry of built-in storm styles
  getTransitionField,   // resolve a style name to its field
  resolveQualityProfile,
  detectDeviceQuality,
} from '@plotinium/voxel-portrait';
```

Type exports are also available for the main canvas options (`VoxelPortraitCanvasOptions`, `VoxelTransitionOptions`, `VoxelStormPhase`, `QualityLevel`, `QualityProfile`), the transition registry (`TransitionField`, `TransitionContext`, `TransitionStyle`), and voxel data structures.

## Styling and layout

The component renders a Three.js canvas, so it should be placed inside a container with an explicit height.

While a new image or settings change is being prepared, the current voxel scene stays mounted until the replacement data is ready. In browsers with Web Worker support, voxel preparation runs off the main thread so consuming pages can keep their own UI responsive and decide whether to show a spinner, disable controls, or allow uninterrupted interaction.

For best results:

- Use PNG or WebP images with a clear subject silhouette
- Keep `progress` normalized for predictable transitions
- Leave `quality` on `'auto'`, or set `'low'`/`'medium'` on mobile-heavy pages; you can still lower `generation.maxCubes` for finer control

## Development

```bash
npm install
npm run dev
```

Build the distributable package with:

```bash
npm run build
```

Type-check the source with:

```bash
npm run typecheck
```

## License

MIT
