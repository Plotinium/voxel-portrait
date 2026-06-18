import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  extractImagePixels,
  type ExtractedImagePixels,
  type ExtractImagePixelsOptions,
} from './lib/image/extractImagePixels';
import {
  buildVoxelPortrait,
  type BuildVoxelPortraitRequest,
  type BuildVoxelPortraitResponse,
  type BuildVoxelPortraitResult,
} from './lib/voxel/buildVoxelPortrait';
import { normalizeColorToHex } from './lib/theme/colorResolver';
import { VoxelPortraitScene } from './VoxelPortraitScene';
import type { VoxelColorConfig, VoxelCubeData } from './types/voxelPortrait';

export type VoxelPortraitColorOptions = {
  mode?: 'solid' | 'gradient' | 'imageSampled';
  useTheme?: boolean;
  value?: string;
  palette?: string[];
  direction?: 'horizontal' | 'vertical' | 'diagonal' | 'radial' | 'depth';
  tint?: string;
  tintStrength?: number;
  cssVars?: {
    primary?: string;
    secondary?: string;
    foreground?: string;
  };
  fallbacks?: {
    primary?: string;
    secondary?: string;
    foreground?: string;
  };
};

export type VoxelPortraitCanvasOptions = {
  color?: VoxelPortraitColorOptions;
  render?: {
    portraitScale?: number;
    imageScale?: number;
    imageOffsetX?: number;
    imageOffsetY?: number;
    imageRotationDeg?: number;
  };
  generation?: {
    maxResolution?: number | false;
    maxCubes?: number;
    density?: number;
    cubeSize?: number;
    alphaThreshold?: number;
    depthMultiplier?: number;
  };
  explosion?: {
    strength?: number;
    depthStrength?: number;
    rotationStrength?: number;
    seed?: number;
  };
  interaction?: {
    enableScroll?: boolean;
    enableHover?: boolean;
    enableClick?: boolean;
    hoverBoost?: number;
    clickBoost?: number;
    influenceRadius?: number;
    influenceFalloff?: number;
    hoverInfluenceRadius?: number;
    hoverInfluenceFalloff?: number;
    clickInfluenceRadius?: number;
    clickInfluenceFalloff?: number;
    cursorAreaScale?: number;
  };
  camera?: {
    fov?: number;
    z?: number;
    dprMin?: number;
    dprMax?: number;
  };
  lighting?: {
    ambientIntensity?: number;
    keyLight?: {
      position?: [number, number, number];
      intensity?: number;
      color?: string;
    };
    fillLight?: {
      position?: [number, number, number];
      intensity?: number;
      color?: string;
    };
  };
  controls?: {
    enablePan?: boolean;
    enableZoom?: boolean;
    enableRotate?: boolean;
  };
  effects?: {
    wave?: {
      enabled?: boolean;
      amplitude?: number;
      frequency?: number;
      speed?: number;
      axis?: 'x' | 'y' | 'z';
    };
    twist?: {
      enabled?: boolean;
      strength?: number;
      speed?: number;
    };
    pulse?: {
      enabled?: boolean;
      amplitude?: number;
      speed?: number;
    };
  };
  imagePlane?: {
    /** Show the source image as a photo and transition to voxels when the cursor approaches */
    enabled?: boolean;
    /** Distance from portrait centre (in local units) at which voxels are fully assembled */
    proximityRadius?: number;
    /** Distance range over which the cross-fade occurs */
    transitionRange?: number;
    /** Hide the visible proximity transition grid and hide the flat image while exploding */
    suppressGridArtifacts?: boolean;
  };
};

type VoxelPortraitCanvasProps = {
  imageSrc: string;
  fallbackImage?: string;
  progress: number;
  options?: VoxelPortraitCanvasOptions;
  onGenerationStateChange?: (isGenerating: boolean) => void;
};

const DEFAULT_OPTIONS: Required<VoxelPortraitCanvasOptions> = {
  color: {
    mode: 'imageSampled',
    useTheme: false,
    value: '#22d3ee',
    palette: [],
    direction: 'vertical',
    tint: '#67e8f9',
    tintStrength: 0,
    cssVars: {
      primary: '--neon-primary',
      secondary: '--neon-secondary',
      foreground: '--foreground',
    },
    fallbacks: {
      primary: '#22d3ee',
      secondary: '#0891b2',
      foreground: '#e5f3ff',
    },
  },
  render: {
    portraitScale: 1,
    imageScale: 1,
    imageOffsetX: 0,
    imageOffsetY: 0,
    imageRotationDeg: 0,
  },
  generation: {
    maxResolution: 768,
    maxCubes: 8000,
    density: 0.8,
    cubeSize: 0.05,
    alphaThreshold: 12,
    depthMultiplier: 18,
  },
  explosion: {
    strength: 2.45,
    depthStrength: 2.1,
    rotationStrength: 1,
    seed: 42,
  },
  interaction: {
    enableScroll: true,
    enableHover: true,
    enableClick: true,
    hoverBoost: 0.1,
    clickBoost: 0.2,
    influenceRadius: 2.2,
    influenceFalloff: 0.45,
    hoverInfluenceRadius: 2.2,
    hoverInfluenceFalloff: 0.45,
    clickInfluenceRadius: 2.2,
    clickInfluenceFalloff: 0.45,
    cursorAreaScale: 1,
  },
  camera: {
    fov: 60,
    z: 16,
    dprMin: 1,
    dprMax: 1.75,
  },
  lighting: {
    ambientIntensity: 1.2,
    keyLight: {
      position: [3.5, 3, 5],
      intensity: 1.5,
      color: '#67e8f9',
    },
    fillLight: {
      position: [-3, -1, 2],
      intensity: 0.8,
      color: '#0ea5e9',
    },
  },
  controls: {
    enablePan: false,
    enableZoom: false,
    enableRotate: false,
  },
  effects: {
    wave: {
      enabled: false,
      amplitude: 0.18,
      frequency: 2.2,
      speed: 1.1,
      axis: 'z',
    },
    twist: {
      enabled: false,
      strength: 0.18,
      speed: 0.9,
    },
    pulse: {
      enabled: false,
      amplitude: 0.08,
      speed: 1.7,
    },
  },
  imagePlane: {
    enabled: false,
    proximityRadius: 1,
    transitionRange: 1,
    suppressGridArtifacts: false,
  },
};

export const DEFAULT_VOXEL_CANVAS_OPTIONS = DEFAULT_OPTIONS;

type CachedPixels = {
  signature: string;
  pixels: ExtractedImagePixels;
};

let voxelBuildWorkerUrl: string | null = null;

function createVoxelBuildWorker(): Worker | null {
  if (
    typeof window === 'undefined'
    || typeof Worker === 'undefined'
    || typeof Blob === 'undefined'
    || typeof URL === 'undefined'
  ) {
    return null;
  }

  try {
    if (!voxelBuildWorkerUrl) {
      const workerScript = `const buildVoxelPortrait = ${buildVoxelPortrait.toString()};self.onmessage = function(event) {try { const result = buildVoxelPortrait(event.data); self.postMessage({ ok: true, result: result }); } catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Voxel worker failed.' }); }};`;
      voxelBuildWorkerUrl = URL.createObjectURL(new Blob([workerScript], { type: 'text/javascript' }));
    }

    return new Worker(voxelBuildWorkerUrl);
  } catch (error) {
    console.warn('[VoxelPortraitCanvas] Falling back to main-thread voxel generation.', error);
    return null;
  }
}

function runVoxelBuildInWorker(
  request: BuildVoxelPortraitRequest,
): Promise<BuildVoxelPortraitResult> {
  const worker = createVoxelBuildWorker();

  if (!worker) {
    return Promise.resolve(buildVoxelPortrait(request));
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      worker.terminate();
    };

    const handleMessage = (event: MessageEvent<BuildVoxelPortraitResponse>) => {
      cleanup();
      if (event.data.ok) {
        resolve(event.data.result);
        return;
      }

      reject(new Error(event.data.error));
    };

    const handleError = (event: ErrorEvent) => {
      cleanup();
      reject(event.error instanceof Error ? event.error : new Error(event.message || 'Voxel worker failed.'));
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);
    worker.postMessage(request);
  });
}

function normalizeColorConfigForBuild(colorConfig: VoxelColorConfig): VoxelColorConfig {
  switch (colorConfig.mode) {
    case 'solid':
      return {
        mode: 'solid',
        value: normalizeColorToHex(colorConfig.value),
      };
    case 'gradient':
      return {
        mode: 'gradient',
        palette: colorConfig.palette.map((color) => normalizeColorToHex(color)),
        direction: colorConfig.direction,
      };
    case 'randomPalette':
      return {
        mode: 'randomPalette',
        palette: colorConfig.palette.map((color) => normalizeColorToHex(color)),
        seed: colorConfig.seed,
      };
    case 'imageSampled':
      return {
        mode: 'imageSampled',
        tint: colorConfig.tint ? normalizeColorToHex(colorConfig.tint) : undefined,
        tintStrength: colorConfig.tintStrength,
      };
    default:
      return colorConfig;
  }
}

function lightenHex(hex: string, amount: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    return hex;
  }

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);

  const t = Math.min(1, Math.max(0, amount));
  const mix = (channel: number) => Math.round(channel + (255 - channel) * t);

  return `#${[mix(r), mix(g), mix(b)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export function VoxelPortraitCanvas({
  imageSrc,
  fallbackImage,
  progress,
  options,
  onGenerationStateChange,
}: VoxelPortraitCanvasProps) {
  const [cubes, setCubes] = useState<VoxelCubeData[] | null>(null);
  const [cubeSize, setCubeSize] = useState(0.05);
  const [cachedPixels, setCachedPixels] = useState<CachedPixels | null>(null);
  const [failed, setFailed] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [themeVersion, setThemeVersion] = useState(0);
  const extractRunRef = useRef(0);
  const prepareRunRef = useRef(0);

  const mergedOptions = useMemo(() => ({
    color: {
      ...DEFAULT_OPTIONS.color,
      ...options?.color,
      cssVars: {
        ...DEFAULT_OPTIONS.color.cssVars,
        ...options?.color?.cssVars,
      },
      fallbacks: {
        ...DEFAULT_OPTIONS.color.fallbacks,
        ...options?.color?.fallbacks,
      },
    },
    render: {
      ...DEFAULT_OPTIONS.render,
      ...options?.render,
    },
    generation: {
      ...DEFAULT_OPTIONS.generation,
      ...options?.generation,
    },
    explosion: {
      ...DEFAULT_OPTIONS.explosion,
      ...options?.explosion,
    },
    interaction: {
      ...DEFAULT_OPTIONS.interaction,
      ...options?.interaction,
    },
    camera: {
      ...DEFAULT_OPTIONS.camera,
      ...options?.camera,
    },
    lighting: {
      ...DEFAULT_OPTIONS.lighting,
      ...options?.lighting,
      keyLight: {
        ...DEFAULT_OPTIONS.lighting.keyLight,
        ...options?.lighting?.keyLight,
      },
      fillLight: {
        ...DEFAULT_OPTIONS.lighting.fillLight,
        ...options?.lighting?.fillLight,
      },
    },
    controls: {
      ...DEFAULT_OPTIONS.controls,
      ...options?.controls,
    },
    effects: {
      ...DEFAULT_OPTIONS.effects,
      ...options?.effects,
      wave: {
        ...DEFAULT_OPTIONS.effects.wave,
        ...options?.effects?.wave,
      },
      twist: {
        ...DEFAULT_OPTIONS.effects.twist,
        ...options?.effects?.twist,
      },
      pulse: {
        ...DEFAULT_OPTIONS.effects.pulse,
        ...options?.effects?.pulse,
      },
    },
    imagePlane: {
      ...DEFAULT_OPTIONS.imagePlane,
      ...options?.imagePlane,
    },
  }), [options]);

  useEffect(() => {
    if (!mergedOptions.color.useTheme || typeof window === 'undefined') {
      return;
    }

    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setThemeVersion((value) => value + 1);
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    return () => {
      observer.disconnect();
    };
  }, [mergedOptions.color.useTheme]);

  const resolvedColorConfig = useMemo((): VoxelColorConfig => {
    if (mergedOptions.color.useTheme && typeof window !== 'undefined') {
      const styles = getComputedStyle(document.documentElement);
      const primaryVar = mergedOptions.color.cssVars.primary ?? '--neon-primary';
      const secondaryVar = mergedOptions.color.cssVars.secondary ?? '--neon-secondary';
      const fallbackPrimary = mergedOptions.color.fallbacks.primary ?? '#22d3ee';
      const fallbackSecondary = mergedOptions.color.fallbacks.secondary ?? '#0891b2';

      const neonPrimary = styles.getPropertyValue(primaryVar).trim() || fallbackPrimary;
      const neonSecondary = styles.getPropertyValue(secondaryVar).trim() || fallbackSecondary || neonPrimary;
      const brightPrimary = lightenHex(neonPrimary, 0.12);
      const brightSecondary = lightenHex(neonSecondary, 0.24);

      if (mergedOptions.color.mode === 'solid') {
        return {
          mode: 'solid',
          value: brightPrimary,
        };
      }

      if (mergedOptions.color.mode === 'imageSampled') {
        return {
          mode: 'imageSampled',
          tint: brightPrimary,
          tintStrength: mergedOptions.color.tintStrength,
        };
      }

      const themePalette = (mergedOptions.color.palette ?? []).filter(
        (color): color is string => Boolean(color),
      );

      return {
        mode: 'gradient',
        palette: themePalette.length > 0
          ? themePalette
          : [brightSecondary, brightPrimary, lightenHex(brightPrimary, 0.24)],
        direction: mergedOptions.color.direction,
      };
    }

    if (mergedOptions.color.mode === 'solid') {
      return {
        mode: 'solid',
        value: mergedOptions.color.value ?? '#22d3ee',
      };
    }

    if (mergedOptions.color.mode === 'imageSampled') {
      return {
        mode: 'imageSampled',
        tint: mergedOptions.color.tint,
        tintStrength: mergedOptions.color.tintStrength,
      };
    }

    const customPalette = (mergedOptions.color.palette ?? []).filter(
      (color): color is string => Boolean(color),
    );

    return {
      mode: 'gradient',
      palette: customPalette.length > 0 ? customPalette : ['#0891b2', '#22d3ee', '#e5f3ff'],
      direction: mergedOptions.color.direction,
    };
  }, [mergedOptions.color, themeVersion]);

  const normalizedColorConfig = useMemo(
    () => normalizeColorConfigForBuild(resolvedColorConfig),
    [resolvedColorConfig],
  );

  const pixelExtractionSignature = useMemo(
    () => JSON.stringify({
      imageSrc,
      maxResolution: mergedOptions.generation.maxResolution,
      imageTransform: {
        imageScale: mergedOptions.render.imageScale,
        imageOffsetX: mergedOptions.render.imageOffsetX,
        imageOffsetY: mergedOptions.render.imageOffsetY,
        imageRotationDeg: mergedOptions.render.imageRotationDeg,
      },
    }),
    [
      imageSrc,
      mergedOptions.generation.maxResolution,
      mergedOptions.render.imageScale,
      mergedOptions.render.imageOffsetX,
      mergedOptions.render.imageOffsetY,
      mergedOptions.render.imageRotationDeg,
    ],
  );

  const voxelBuildSignature = useMemo(
    () => JSON.stringify({
      pixels: pixelExtractionSignature,
      colorConfig: normalizedColorConfig,
      generation: {
        density: mergedOptions.generation.density,
        cubeSize: mergedOptions.generation.cubeSize,
        alphaThreshold: mergedOptions.generation.alphaThreshold,
        maxCubes: mergedOptions.generation.maxCubes,
        depthMultiplier: mergedOptions.generation.depthMultiplier,
      },
      explosion: mergedOptions.explosion,
    }),
    [
      pixelExtractionSignature,
      normalizedColorConfig,
      mergedOptions.generation.density,
      mergedOptions.generation.cubeSize,
      mergedOptions.generation.alphaThreshold,
      mergedOptions.generation.maxCubes,
      mergedOptions.generation.depthMultiplier,
      mergedOptions.explosion,
    ],
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleMediaChange = () => setPrefersReducedMotion(mediaQuery.matches);

    handleMediaChange();
    mediaQuery.addEventListener('change', handleMediaChange);

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    extractRunRef.current += 1;
    const runId = extractRunRef.current;
    setIsExtracting(true);

    async function loadPixels() {
      try {
        setFailed(false);

        const extractImageOptions: ExtractImagePixelsOptions = {
          maxResolution: mergedOptions.generation.maxResolution ?? 768,
          imageScale: mergedOptions.render.imageScale ?? 1,
          offsetX: mergedOptions.render.imageOffsetX ?? 0,
          offsetY: mergedOptions.render.imageOffsetY ?? 0,
          rotationDeg: mergedOptions.render.imageRotationDeg ?? 0,
        };

        const pixels = await extractImagePixels(imageSrc, extractImageOptions);

        if (!cancelled && runId === extractRunRef.current) {
          setCachedPixels({
            signature: pixelExtractionSignature,
            pixels,
          });
        }
      } catch (err) {
        console.error('[VoxelPortraitCanvas] extractImagePixels failed:', err);
        if (!cancelled && runId === extractRunRef.current) {
          setFailed(true);
        }
      } finally {
        if (!cancelled && runId === extractRunRef.current) {
          setIsExtracting(false);
        }
      }
    }

    loadPixels();

    return () => {
      cancelled = true;
    };
  }, [
    pixelExtractionSignature,
    imageSrc,
    mergedOptions.generation.maxResolution,
    mergedOptions.render.imageScale,
    mergedOptions.render.imageOffsetX,
    mergedOptions.render.imageOffsetY,
    mergedOptions.render.imageRotationDeg,
  ]);

  useEffect(() => {
    if (!cachedPixels || cachedPixels.signature !== pixelExtractionSignature) {
      return;
    }

    let cancelled = false;
    prepareRunRef.current += 1;
    const runId = prepareRunRef.current;
    setIsPreparing(true);

    const request: BuildVoxelPortraitRequest = {
      pixels: cachedPixels.pixels,
      colorConfig: normalizedColorConfig,
      generation: {
        density: mergedOptions.generation.density,
        cubeSize: mergedOptions.generation.cubeSize,
        alphaThreshold: mergedOptions.generation.alphaThreshold,
        maxCubes: mergedOptions.generation.maxCubes,
        depthMultiplier: mergedOptions.generation.depthMultiplier,
      },
      explosion: {
        strength: mergedOptions.explosion.strength,
        depthStrength: mergedOptions.explosion.depthStrength,
        rotationStrength: mergedOptions.explosion.rotationStrength,
        seed: mergedOptions.explosion.seed,
      },
    };

    runVoxelBuildInWorker(request)
      .then((prepared) => {
        if (!cancelled && runId === prepareRunRef.current) {
          setFailed(false);
          setCubeSize(prepared.cubeSize);
          setCubes(prepared.cubes);
        }
      })
      .catch((err) => {
        console.error('[VoxelPortraitCanvas] buildVoxelPortrait failed:', err);
        if (!cancelled && runId === prepareRunRef.current) {
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled && runId === prepareRunRef.current) {
          setIsPreparing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    cachedPixels,
    pixelExtractionSignature,
    voxelBuildSignature,
    normalizedColorConfig,
    mergedOptions.generation.density,
    mergedOptions.generation.cubeSize,
    mergedOptions.generation.alphaThreshold,
    mergedOptions.generation.maxCubes,
    mergedOptions.generation.depthMultiplier,
    mergedOptions.explosion.strength,
    mergedOptions.explosion.depthStrength,
    mergedOptions.explosion.rotationStrength,
    mergedOptions.explosion.seed,
  ]);

  useEffect(() => {
    onGenerationStateChange?.(isExtracting || isPreparing);
  }, [isExtracting, isPreparing, onGenerationStateChange]);

  useEffect(() => () => {
    onGenerationStateChange?.(false);
  }, [onGenerationStateChange]);

  const scrollProgress = (mergedOptions.interaction.enableScroll ?? true)
    ? (prefersReducedMotion ? 0 : progress)
    : 0;
  const hoverBoost = mergedOptions.interaction.enableHover && isHovering
    ? (mergedOptions.interaction.hoverBoost ?? 0.1)
    : 0;
  const clickBoost = mergedOptions.interaction.enableClick && isPointerDown
    ? (mergedOptions.interaction.clickBoost ?? 0.2)
    : 0;
  const areaScale = mergedOptions.interaction.cursorAreaScale ?? 1;
  const effectiveInfluenceRadius = Math.max(
    0.05,
    (mergedOptions.interaction.influenceRadius ?? 2.2) * areaScale,
  );
  const hoverInfluenceRadius = Math.max(
    0.05,
    (mergedOptions.interaction.hoverInfluenceRadius ?? effectiveInfluenceRadius) * areaScale,
  );
  const clickInfluenceRadius = Math.max(
    0.05,
    (mergedOptions.interaction.clickInfluenceRadius ?? effectiveInfluenceRadius) * areaScale,
  );
  const hoverInfluenceFalloff = Math.max(
    0.01,
    mergedOptions.interaction.hoverInfluenceFalloff ?? mergedOptions.interaction.influenceFalloff ?? 0.45,
  );
  const clickInfluenceFalloff = Math.max(
    0.01,
    mergedOptions.interaction.clickInfluenceFalloff ?? mergedOptions.interaction.influenceFalloff ?? 0.45,
  );

  const canUseWebGL = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  }, []);

  if (failed || !canUseWebGL || !cubes) {
    if (fallbackImage) {
      return (
        <div style={{ position: 'relative', height: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img
            src={fallbackImage}
            alt="Portrait fallback"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: 0.95 }}
          />
        </div>
      );
    } else {
      return null;
    }
  }

  return (
    <Canvas
      dpr={[
        mergedOptions.camera.dprMin ?? 1,
        mergedOptions.camera.dprMax ?? 1.75,
      ]}
      camera={{
        fov: mergedOptions.camera.fov ?? 60,
        position: [0, 0, mergedOptions.camera.z ?? 16],
      }}
      style={{ height: '100%', width: '100%' }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onPointerEnter={() => setIsHovering(true)}
      onPointerLeave={() => {
        setIsHovering(false);
        setIsPointerDown(false);
      }}
      onPointerDown={() => setIsPointerDown(true)}
      onPointerUp={() => setIsPointerDown(false)}
    >
      <ambientLight intensity={mergedOptions.lighting.ambientIntensity} />
      <directionalLight
        position={mergedOptions.lighting.keyLight.position}
        intensity={mergedOptions.lighting.keyLight.intensity}
        color={mergedOptions.lighting.keyLight.color}
      />
      <directionalLight
        position={mergedOptions.lighting.fillLight.position}
        intensity={mergedOptions.lighting.fillLight.intensity}
        color={mergedOptions.lighting.fillLight.color}
      />
      <VoxelPortraitScene
        cubes={cubes}
        cubeSize={cubeSize}
        portraitScale={mergedOptions.render.portraitScale ?? 1}
        progress={scrollProgress}
        hoverBoost={hoverBoost}
        clickBoost={clickBoost}
        hoverInfluenceRadius={hoverInfluenceRadius}
        hoverInfluenceFalloff={hoverInfluenceFalloff}
        clickInfluenceRadius={clickInfluenceRadius}
        clickInfluenceFalloff={clickInfluenceFalloff}
        effects={mergedOptions.effects}
        imagePlaneEnabled={mergedOptions.imagePlane.enabled ?? false}
        imagePlaneProximityRadius={mergedOptions.imagePlane.proximityRadius ?? 1}
        imagePlaneTransitionRange={mergedOptions.imagePlane.transitionRange ?? 1}
        imagePlaneSuppressGridArtifacts={mergedOptions.imagePlane.suppressGridArtifacts ?? false}
        isHovering={isHovering}
      />
      <OrbitControls
        enablePan={mergedOptions.controls.enablePan}
        enableZoom={mergedOptions.controls.enableZoom}
        enableRotate={mergedOptions.controls.enableRotate}
      />
    </Canvas>
  );
}
