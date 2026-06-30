export type QualityLevel = 'auto' | 'off' | 'low' | 'medium' | 'high';

export type QualityProfile = {
  name: 'off' | 'low' | 'medium' | 'high';
  dprMin: number;
  dprMax: number;
  antialias: boolean;
  sphereSegments: number;
  /** Cap on rendered cubes (Infinity = honour the consumer's maxCubes). */
  maxCubes: number;
  /** Cap on image resolution before sampling (Infinity = honour consumer). */
  maxResolution: number;
  /** Whether runtime FPS throttling should run (only for `auto`). */
  adaptive: boolean;
};

const PROFILES: Record<'off' | 'low' | 'medium' | 'high', Omit<QualityProfile, 'adaptive'>> = {
  // 'off' bypasses the quality system: no caps, no runtime throttling. dpr is
  // left to the consumer's camera.dprMin/dprMax (Infinity here means "don't
  // cap"), and detail matches pre-quality-system behaviour (10 segments).
  off: {
    name: 'off',
    dprMin: 0,
    dprMax: Number.POSITIVE_INFINITY,
    antialias: true,
    sphereSegments: 10,
    maxCubes: Number.POSITIVE_INFINITY,
    maxResolution: Number.POSITIVE_INFINITY,
  },
  low: {
    name: 'low',
    dprMin: 0.75,
    dprMax: 1.0,
    antialias: false,
    sphereSegments: 6,
    maxCubes: 3000,
    maxResolution: 384,
  },
  medium: {
    name: 'medium',
    dprMin: 1.0,
    dprMax: 1.25,
    antialias: true,
    sphereSegments: 8,
    maxCubes: 6000,
    maxResolution: 640,
  },
  high: {
    name: 'high',
    dprMin: 1.0,
    dprMax: 1.75,
    antialias: true,
    sphereSegments: 12,
    maxCubes: Number.POSITIVE_INFINITY,
    maxResolution: Number.POSITIVE_INFINITY,
  },
};

/** Heuristic device-class detection from CPU cores, memory and UA. */
export function detectDeviceQuality(): 'low' | 'medium' | 'high' {
  if (typeof navigator === 'undefined') {
    return 'high';
  }

  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent ?? '');

  if (cores <= 2 || memory <= 2) {
    return 'low';
  }
  if (isMobile || cores <= 4 || memory <= 4) {
    return 'medium';
  }
  if (cores >= 8 && memory >= 8) {
    return 'high';
  }
  return 'medium';
}

export function resolveQualityProfile(quality: QualityLevel = 'auto'): QualityProfile {
  if (quality === 'auto') {
    return { ...PROFILES[detectDeviceQuality()], adaptive: true };
  }
  return { ...PROFILES[quality], adaptive: false };
}
