# voxel-portrait

`@plotinium/voxel-portrait` is a React component that turns an image into a scroll-driven 3D voxel portrait using React Three Fiber.

It is designed for landing pages, portfolio sections, and immersive hero blocks where a static image needs a stronger visual treatment without building a custom Three.js scene from scratch.

It gives you a reusable canvas component instead of a one-off scene, so you can plug the effect into any React app and drive it with your own scroll or interaction state.

## Features

- Converts any source image into a voxel-based portrait
- Drives assembly and explosion with a `progress` value from `0` to `1`
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

## Configuration overview

`options` is grouped by concern so you can tune the effect without wiring your own scene:

- `color`: solid, gradient, or image-sampled color behavior
- `render`: portrait scale, image scale, offset, and rotation
- `generation`: voxel density, cube size, alpha threshold, and max cube count
- `explosion`: explosion strength, depth, rotation, and seed
- `interaction`: scroll, hover, click, and cursor influence settings
- `camera`: field of view, camera distance, and DPR limits
- `lighting`: ambient, key, and fill lighting
- `controls`: pan, zoom, and rotate toggles for orbit controls
- `effects`: optional wave, twist, and pulse modifiers
- `imagePlane`: optional flat-image to voxel transition mode

The package also exports `DEFAULT_VOXEL_CANVAS_OPTIONS` if you want to inspect or extend the built-in defaults.

## Exports

```ts
import {
  VoxelPortraitCanvas,
  DEFAULT_VOXEL_CANVAS_OPTIONS,
} from '@plotinium/voxel-portrait';
```

Type exports are also available for the main canvas options and voxel data structures.

## Styling and layout

The component renders a Three.js canvas, so it should be placed inside a container with an explicit height.

While a new image or settings change is being prepared, the current voxel scene stays mounted until the replacement data is ready. In browsers with Web Worker support, voxel preparation runs off the main thread so consuming pages can keep their own UI responsive and decide whether to show a spinner, disable controls, or allow uninterrupted interaction.

For best results:

- Use PNG or WebP images with a clear subject silhouette
- Keep `progress` normalized for predictable transitions
- Lower `generation.maxCubes` on mobile-heavy pages if performance matters

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
