import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  resolveQualityProfile,
  type QualityLevel,
} from './lib/quality/resolveQuality';
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
import { VoxelPortraitScene, type PerfSample } from './VoxelPortraitScene';
import type { VoxelColorConfig, VoxelCubeData } from './types/voxelPortrait';

export type { PerfSample };

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

export type VoxelTransitionOptions = {
  /** Play a particle-storm animation when the image changes. Default `true`. */
  enabled?: boolean;
  /** Built-in storm style, or any name registered in the transition registry. */
  style?: 'vortex' | 'spiral' | 'turbulence' | (string & {});
  /** Seconds to scatter the current portrait into the storm. */
  disperseDuration?: number;
  /** Seconds to reassemble the new portrait from the storm. */
  convergeDuration?: number;
  /** Minimum seconds the storm holds before reassembling (hides fast loads). */
  minHold?: number;
  /** Per-style tuning (e.g. `radius`, `speed`, `arms`). */
  params?: Record<string, number>;
};

export type VoxelPortraitCanvasOptions = {
  /** Rendering quality. `auto` detects the device and throttles at runtime. */
  quality?: QualityLevel;
  transition?: VoxelTransitionOptions;
  color?: VoxelPortraitColorOptions;
  render?: {
    portraitScale?: number;
    imageScale?: number;
    imageOffsetX?: number;
    imageOffsetY?: number;
    imageRotationDeg?: number;
    /**
     * Keep the WebGL drawing buffer so the canvas can be captured via
     * `toDataURL()` / `toBlob()`. Off by default — enabling it disables a
     * browser fast path and adds a per-frame copy cost. Only turn on if you
     * screenshot the canvas.
     */
    preserveDrawingBuffer?: boolean;
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

/** The phases the particle-storm state machine passes through. */
export type VoxelStormPhase = 'idle' | 'disperse' | 'hold' | 'converge';

type VoxelPortraitCanvasProps = {
  imageSrc: string;
  fallbackImage?: string;
  progress: number;
  options?: VoxelPortraitCanvasOptions;
  onGenerationStateChange?: (isGenerating: boolean) => void;
  /**
   * Increment this to replay the particle-storm transition against the current
   * image (no rebuild) — handy for previewing/comparing styles. Triggers the
   * animation even if `transition.enabled` is false or reduced-motion is set.
   */
  replayToken?: number;
  /**
   * Bump to start a storm and HOLD it open: disperse → hold. The storm stays in
   * `hold` indefinitely (no auto-converge) until `convergeToken` changes. Fires
   * independently of `imageSrc` / `replayToken`. Intended for driving a route
   * transition where the hold spans an externally-controlled duration.
   *
   * Like `replayToken`, this is an explicit consumer action: it runs even when
   * `transition.enabled` is false or reduced-motion is set. Use
   * `onStormPhaseChange` to sequence around it.
   */
  disperseToken?: number;
  /**
   * Bump to release a held storm: hold → converge, reassembling the CURRENT
   * cubes (no `imageSrc` change required). Respects `transition.minHold` (won't
   * converge earlier than `minHold` after the hold began). A bump received while
   * still in `disperse` is latched and applied once `hold` is entered.
   */
  convergeToken?: number;
  /**
   * Fired on every storm phase change, including the final `→ idle`. Lets the
   * consumer sequence routing (e.g. push the next route on `hold`, reveal it on
   * `idle`).
   */
  onStormPhaseChange?: (phase: VoxelStormPhase) => void;
  /**
   * Fired roughly once per second with `{ fps, dropped, dpr }` telemetry from the
   * render loop. Useful for monitoring smoothness or proving performance in a
   * demo. Held in a ref internally, so passing a fresh closure won't re-render.
   */
  onPerfSample?: (sample: PerfSample) => void;
};

const DEFAULT_OPTIONS: Required<VoxelPortraitCanvasOptions> = {
  quality: 'auto',
  transition: {
    enabled: true,
    style: 'vortex',
    disperseDuration: 0.6,
    convergeDuration: 0.7,
    minHold: 0.25,
    params: {},
  },
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
    preserveDrawingBuffer: false,
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

// The blob URL is built once per page (the worker source never changes) and
// shared by every worker instance; only the `Worker` objects are per-component.
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
      const workerScript = `const buildVoxelPortrait = ${buildVoxelPortrait.toString()};self.onmessage = function(event) {var requestId = event.data && event.data.requestId;try { const result = buildVoxelPortrait(event.data); self.postMessage({ ok: true, result: result, requestId: requestId }); } catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Voxel worker failed.', requestId: requestId }); }};`;
      voxelBuildWorkerUrl = URL.createObjectURL(new Blob([workerScript], { type: 'text/javascript' }));
    }

    return new Worker(voxelBuildWorkerUrl);
  } catch (error) {
    console.warn('[VoxelPortraitCanvas] Falling back to main-thread voxel generation.', error);
    return null;
  }
}

// Run a build on a pooled worker, matching the response by `requestId` so a
// single long-lived worker can service many sequential builds. Falls back to a
// synchronous main-thread build when no worker is available (SSR / no Worker).
function runVoxelBuildInWorker(
  worker: Worker | null,
  request: BuildVoxelPortraitRequest,
  requestId: number,
): Promise<BuildVoxelPortraitResult> {
  if (!worker) {
    return Promise.resolve(buildVoxelPortrait(request));
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
    };

    const handleMessage = (event: MessageEvent<BuildVoxelPortraitResponse>) => {
      // Ignore responses belonging to other in-flight requests on this worker.
      if (event.data.requestId !== requestId) {
        return;
      }
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
    worker.postMessage({ ...request, requestId });
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
  replayToken,
  disperseToken,
  convergeToken,
  onStormPhaseChange,
  onPerfSample,
}: VoxelPortraitCanvasProps) {
  const [displayCubes, setDisplayCubes] = useState<VoxelCubeData[] | null>(null);
  const [cubeSize, setCubeSize] = useState(0.05);
  const [cachedPixels, setCachedPixels] = useState<CachedPixels | null>(null);
  const [failed, setFailed] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [themeVersion, setThemeVersion] = useState(0);
  // Particle-storm transition tokens read by the scene's state machine.
  // These are internal scene drivers — distinct from the public `disperseToken`
  // / `convergeToken` props, which are mapped onto them below.
  const [transitionToken, setTransitionToken] = useState(0);
  const [sceneConvergeToken, setSceneConvergeToken] = useState(0);
  const extractRunRef = useRef(0);
  const prepareRunRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const transitionPendingRef = useRef(false);
  const replayTokenRef = useRef(replayToken);
  const disperseTokenRef = useRef(disperseToken);
  const convergeTokenRef = useRef(convergeToken);
  // One pooled worker per canvas instance: created lazily on first build,
  // reused across image swaps, terminated on unmount. `undefined` = not yet
  // attempted; `null` = no Worker support (build runs on the main thread).
  const workerRef = useRef<Worker | null | undefined>(undefined);
  const buildRequestIdRef = useRef(0);

  // Terminate the pooled worker when the canvas unmounts.
  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = undefined;
  }, []);

  const mergedOptions = useMemo(() => ({
    quality: options?.quality ?? DEFAULT_OPTIONS.quality,
    transition: {
      ...DEFAULT_OPTIONS.transition,
      ...options?.transition,
      params: {
        ...DEFAULT_OPTIONS.transition.params,
        ...options?.transition?.params,
      },
    },
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

  const qualityProfile = useMemo(
    () => resolveQualityProfile(mergedOptions.quality),
    [mergedOptions.quality],
  );

  // Quality caps applied on top of the consumer's generation settings.
  const effectiveMaxCubes = useMemo(
    () => Math.min(mergedOptions.generation.maxCubes ?? 8000, qualityProfile.maxCubes),
    [mergedOptions.generation.maxCubes, qualityProfile.maxCubes],
  );

  const effectiveMaxResolution = useMemo<number | false>(() => {
    const userResolution = mergedOptions.generation.maxResolution ?? 768;
    if (qualityProfile.maxResolution === Number.POSITIVE_INFINITY) {
      return userResolution;
    }
    const userValue = userResolution === false
      ? Number.POSITIVE_INFINITY
      : userResolution;
    return Math.min(userValue, qualityProfile.maxResolution);
  }, [mergedOptions.generation.maxResolution, qualityProfile.maxResolution]);

  const dprMax = Math.min(
    qualityProfile.dprMax,
    mergedOptions.camera.dprMax ?? qualityProfile.dprMax,
  );
  const dprMin = Math.min(
    dprMax,
    mergedOptions.camera.dprMin ?? qualityProfile.dprMin,
  );

  const [dpr, setDpr] = useState(dprMax);
  useEffect(() => {
    setDpr(dprMax);
  }, [dprMax]);

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
      maxResolution: effectiveMaxResolution,
      imageTransform: {
        imageScale: mergedOptions.render.imageScale,
        imageOffsetX: mergedOptions.render.imageOffsetX,
        imageOffsetY: mergedOptions.render.imageOffsetY,
        imageRotationDeg: mergedOptions.render.imageRotationDeg,
      },
    }),
    [
      imageSrc,
      effectiveMaxResolution,
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
        maxCubes: effectiveMaxCubes,
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
      effectiveMaxCubes,
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
          maxResolution: effectiveMaxResolution,
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
        maxCubes: effectiveMaxCubes,
        depthMultiplier: mergedOptions.generation.depthMultiplier,
      },
      explosion: {
        strength: mergedOptions.explosion.strength,
        depthStrength: mergedOptions.explosion.depthStrength,
        rotationStrength: mergedOptions.explosion.rotationStrength,
        seed: mergedOptions.explosion.seed,
      },
    };

    if (workerRef.current === undefined) {
      workerRef.current = createVoxelBuildWorker();
    }
    buildRequestIdRef.current += 1;

    runVoxelBuildInWorker(workerRef.current, request, buildRequestIdRef.current)
      .then((prepared) => {
        if (!cancelled && runId === prepareRunRef.current) {
          setFailed(false);
          setCubeSize(prepared.cubeSize);

          const isFirstLoad = !hasLoadedRef.current;
          hasLoadedRef.current = true;

          if (transitionPendingRef.current && !isFirstLoad) {
            // A storm is mid-flight for an image change: swap the rendered
            // cubes (hidden by the swirl) and ask the scene to reassemble.
            transitionPendingRef.current = false;
            setDisplayCubes(prepared.cubes);
            setSceneConvergeToken((token) => token + 1);
          } else {
            // First load, or a non-image rebuild (e.g. quality change): no storm.
            setDisplayCubes(prepared.cubes);
          }
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

  // When the image changes after the first load, kick off the disperse phase
  // immediately (the new build runs in parallel and triggers the converge).
  useEffect(() => {
    if (!hasLoadedRef.current) {
      return;
    }
    if (!mergedOptions.transition.enabled || prefersReducedMotion) {
      transitionPendingRef.current = false;
      return;
    }
    transitionPendingRef.current = true;
    setTransitionToken((token) => token + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSrc]);

  // Replay the storm against the current cubes (no rebuild) when the consumer
  // bumps `replayToken` — for previewing styles. Ignores transition.enabled /
  // reduced-motion since it is an explicit action.
  useEffect(() => {
    if (replayToken === replayTokenRef.current) {
      return;
    }
    replayTokenRef.current = replayToken;
    if (!hasLoadedRef.current) {
      return;
    }
    setTransitionToken((token) => token + 1);
    setSceneConvergeToken((token) => token + 1);
  }, [replayToken]);

  // Consumer-controlled storm: disperse and HOLD open. Decoupled from
  // `convergeToken` so the storm stays in `hold` until the consumer releases it.
  // Like `replayToken`, this is an explicit action and ignores
  // transition.enabled / reduced-motion.
  useEffect(() => {
    if (disperseToken === disperseTokenRef.current) {
      return;
    }
    disperseTokenRef.current = disperseToken;
    if (!hasLoadedRef.current) {
      return;
    }
    // Not a build-driven storm: ensure a pending image swap doesn't auto-converge.
    transitionPendingRef.current = false;
    setTransitionToken((token) => token + 1);
  }, [disperseToken]);

  // Release a held storm → converge into the current cubes. The scene latches
  // this if it arrives before `hold` is reached, and honours `minHold`.
  useEffect(() => {
    if (convergeToken === convergeTokenRef.current) {
      return;
    }
    convergeTokenRef.current = convergeToken;
    if (!hasLoadedRef.current) {
      return;
    }
    setSceneConvergeToken((token) => token + 1);
  }, [convergeToken]);

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

  if (failed || !canUseWebGL || !displayCubes) {
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
      dpr={qualityProfile.adaptive ? dpr : [dprMin, dprMax]}
      camera={{
        fov: mergedOptions.camera.fov ?? 60,
        position: [0, 0, mergedOptions.camera.z ?? 16],
      }}
      style={{ height: '100%', width: '100%' }}
      gl={{ antialias: qualityProfile.antialias, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: mergedOptions.render.preserveDrawingBuffer ?? false }}
      onPointerEnter={() => setIsHovering(true)}
      onPointerLeave={() => {
        setIsHovering(false);
        setIsPointerDown(false);
      }}
      onPointerDown={() => setIsPointerDown(true)}
      onPointerUp={() => setIsPointerDown(false)}
    >
      {qualityProfile.adaptive && (
        <PerformanceMonitor
          onDecline={() => setDpr((value) => Math.max(dprMin, Math.round((value - 0.25) * 100) / 100))}
          onIncline={() => setDpr((value) => Math.min(dprMax, Math.round((value + 0.25) * 100) / 100))}
        />
      )}
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
        cubes={displayCubes}
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
        capacity={effectiveMaxCubes}
        sphereSegments={qualityProfile.sphereSegments}
        transitionStyle={mergedOptions.transition.style}
        transitionParams={mergedOptions.transition.params}
        transitionToken={transitionToken}
        convergeToken={sceneConvergeToken}
        onStormPhaseChange={onStormPhaseChange}
        onPerfSample={onPerfSample}
        disperseDuration={mergedOptions.transition.disperseDuration}
        convergeDuration={mergedOptions.transition.convergeDuration}
        minHold={mergedOptions.transition.minHold}
      />
      <OrbitControls
        enablePan={mergedOptions.controls.enablePan}
        enableZoom={mergedOptions.controls.enableZoom}
        enableRotate={mergedOptions.controls.enableRotate}
      />
    </Canvas>
  );
}
