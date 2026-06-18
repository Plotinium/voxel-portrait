import type { ExtractedImagePixels } from '../image/extractImagePixels';
import type {
  VoxelColorConfig,
  VoxelCubeData,
  VoxelGenerationConfig,
  VoxelPoint,
} from '../../types/voxelPortrait';

type VoxelExplosionConfig = {
  strength?: number;
  depthStrength?: number;
  rotationStrength?: number;
  seed?: number;
};

export type BuildVoxelPortraitRequest = {
  pixels: ExtractedImagePixels;
  colorConfig: VoxelColorConfig;
  generation: VoxelGenerationConfig;
  explosion: VoxelExplosionConfig;
};

export type BuildVoxelPortraitResult = {
  cubes: VoxelCubeData[];
  cubeSize: number;
};

export type BuildVoxelPortraitResponse =
  | {
      ok: true;
      result: BuildVoxelPortraitResult;
    }
  | {
      ok: false;
      error: string;
    };

export function buildVoxelPortrait(
  request: BuildVoxelPortraitRequest,
): BuildVoxelPortraitResult {
  const generation = {
    density: 0.55,
    cubeSize: 0.08,
    alphaThreshold: 40,
    maxCubes: 2800,
    depthMultiplier: 18,
    ...request.generation,
  };
  const explosion = {
    strength: 2.4,
    depthStrength: 2.2,
    rotationStrength: 1.2,
    seed: 42,
    ...request.explosion,
  };

  const step = Math.max(1, Math.round(1 / Math.max(0.05, generation.density)));
  const centerX = request.pixels.width / 2;
  const centerY = request.pixels.height / 2;

  type CandidatePoint = Omit<VoxelPoint, 'index'> & { detail: number };
  const candidates: CandidatePoint[] = [];

  function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
  }

  function seededUnit(value: number): number {
    const wave = Math.sin(value * 12.9898) * 43758.5453;
    return wave - Math.floor(wave);
  }

  function rgbToHex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  }

  function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const normalized = hex.replace('#', '');
    const value = normalized.length === 3
      ? normalized.split('').map((char) => `${char}${char}`).join('')
      : normalized;

    return {
      r: parseInt(value.slice(0, 2), 16) || 0,
      g: parseInt(value.slice(2, 4), 16) || 0,
      b: parseInt(value.slice(4, 6), 16) || 0,
    };
  }

  function clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function parseColorToRgb(color: string): { r: number; g: number; b: number } {
    const trimmed = color.trim();

    if (trimmed.startsWith('#')) {
      return hexToRgb(trimmed);
    }

    const rgbMatch = trimmed.match(/^rgba?\(([^)]+)\)$/i);
    if (rgbMatch) {
      const parts = rgbMatch[1].split(',').map((part) => parseFloat(part.trim()));
      if (parts.length >= 3 && parts.every((value) => Number.isFinite(value))) {
        return {
          r: clampByte(parts[0]),
          g: clampByte(parts[1]),
          b: clampByte(parts[2]),
        };
      }
    }

    return hexToRgb('#38bdf8');
  }

  function normalizeColorToHex(color: string): string {
    const { r, g, b } = parseColorToRgb(color);
    return rgbToHex(r, g, b);
  }

  function mixHex(from: string, to: string, factor: number): string {
    const fromRgb = parseColorToRgb(from);
    const toRgb = parseColorToRgb(to);

    return rgbToHex(
      Math.round(fromRgb.r + (toRgb.r - fromRgb.r) * factor),
      Math.round(fromRgb.g + (toRgb.g - fromRgb.g) * factor),
      Math.round(fromRgb.b + (toRgb.b - fromRgb.b) * factor),
    );
  }

  function samplePalette(palette: string[], factor: number): string {
    if (palette.length === 1) {
      return palette[0];
    }

    const scaled = clamp01(factor) * (palette.length - 1);
    const left = Math.floor(scaled);
    const right = Math.min(palette.length - 1, left + 1);
    return mixHex(palette[left], palette[right], scaled - left);
  }

  function getGradientFactor(
    point: VoxelPoint,
    direction: 'horizontal' | 'vertical' | 'diagonal' | 'radial' | 'depth',
  ): number {
    if (direction === 'horizontal') {
      return clamp01(point.normalizedX);
    }
    if (direction === 'diagonal') {
      return clamp01((point.normalizedX + point.normalizedY) / 2);
    }
    if (direction === 'radial') {
      const dx = point.normalizedX - 0.5;
      const dy = point.normalizedY - 0.5;
      return clamp01(Math.sqrt(dx * dx + dy * dy) / 0.70710678118);
    }
    if (direction === 'depth') {
      return clamp01((point.z + 1) / 2);
    }
    return clamp01(point.normalizedY);
  }

  function resolveVoxelColor(point: VoxelPoint, points: VoxelPoint[]): string {
    let resolved: string;

    switch (request.colorConfig.mode) {
      case 'solid':
        resolved = request.colorConfig.value || '#38bdf8';
        break;
      case 'gradient':
        resolved = samplePalette(
          request.colorConfig.palette.length > 0 ? request.colorConfig.palette : ['#38bdf8', '#0f172a'],
          getGradientFactor(point, request.colorConfig.direction ?? 'vertical'),
        );
        break;
      case 'randomPalette': {
        const palette = request.colorConfig.palette.length > 0 ? request.colorConfig.palette : ['#38bdf8'];
        const pseudo = seededUnit(point.index + (request.colorConfig.seed ?? 42) * 9973);
        resolved = palette[Math.min(palette.length - 1, Math.floor(pseudo * palette.length))];
        break;
      }
      case 'imageSampled':
        resolved = request.colorConfig.tint
          ? mixHex(point.sampleColor, request.colorConfig.tint, clamp01(request.colorConfig.tintStrength ?? 0.5))
          : point.sampleColor;
        break;
      default:
        resolved = points.length > 0 ? points[0].sampleColor : '#38bdf8';
        break;
    }

    return normalizeColorToHex(resolved);
  }

  function getLuminance(r: number, g: number, b: number): number {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function getPixelLuminance(x: number, y: number): number {
    const clampedX = Math.min(request.pixels.width - 1, Math.max(0, x));
    const clampedY = Math.min(request.pixels.height - 1, Math.max(0, y));
    const pixelIndex = (clampedY * request.pixels.width + clampedX) * 4;

    return getLuminance(
      request.pixels.data[pixelIndex],
      request.pixels.data[pixelIndex + 1],
      request.pixels.data[pixelIndex + 2],
    );
  }

  function estimateDetail(x: number, y: number): number {
    const center = getPixelLuminance(x, y);
    const left = getPixelLuminance(x - 1, y);
    const right = getPixelLuminance(x + 1, y);
    const up = getPixelLuminance(x, y - 1);
    const down = getPixelLuminance(x, y + 1);

    const gx = Math.abs(right - left);
    const gy = Math.abs(down - up);
    const localContrast = Math.abs(center - (left + right + up + down) / 4);

    return gx + gy + localContrast;
  }

  for (let y = 0; y < request.pixels.height; y += step) {
    for (let x = 0; x < request.pixels.width; x += step) {
      const pixelIndex = (y * request.pixels.width + x) * 4;
      const alpha = request.pixels.data[pixelIndex + 3];
      if (alpha <= generation.alphaThreshold) {
        continue;
      }

      const r = request.pixels.data[pixelIndex];
      const g = request.pixels.data[pixelIndex + 1];
      const b = request.pixels.data[pixelIndex + 2];
      const luminance = getLuminance(r, g, b);

      candidates.push({
        x: (x - centerX) * generation.cubeSize,
        y: (centerY - y) * generation.cubeSize,
        z: (0.5 - luminance) * generation.cubeSize * generation.depthMultiplier,
        sampleColor: rgbToHex(r, g, b),
        normalizedX: x / Math.max(1, request.pixels.width - 1),
        normalizedY: y / Math.max(1, request.pixels.height - 1),
        detail: estimateDetail(x, y),
      });
    }
  }

  let points: VoxelPoint[];
  if (candidates.length <= generation.maxCubes) {
    points = candidates.map((point, index) => ({ ...point, index }));
  } else {
    const selected = new Set<number>();
    const uniformCount = Math.max(1, Math.floor(generation.maxCubes * 0.72));
    const detailCount = Math.max(0, generation.maxCubes - uniformCount);
    const uniformStep = candidates.length / uniformCount;

    for (let i = 0; i < uniformCount; i += 1) {
      selected.add(Math.min(candidates.length - 1, Math.floor(i * uniformStep)));
    }

    const rankedByDetail = candidates
      .map((candidate, index) => ({ index, score: candidate.detail }))
      .sort((a, b) => b.score - a.score);

    let detailAdded = 0;
    for (let i = 0; i < rankedByDetail.length && detailAdded < detailCount; i += 1) {
      const index = rankedByDetail[i].index;
      if (selected.has(index)) {
        continue;
      }
      selected.add(index);
      detailAdded += 1;
    }

    points = Array.from(selected)
      .sort((a, b) => a - b)
      .map((sourceIndex, index) => {
        const { detail: _detail, ...candidate } = candidates[sourceIndex];
        return { ...candidate, index };
      });
  }

  const cubes: VoxelCubeData[] = points.map((point, index) => {
    const randomA = seededUnit(explosion.seed + index * 1.123);
    const randomB = seededUnit(explosion.seed + index * 2.417);
    const randomC = seededUnit(explosion.seed + index * 3.917);
    const radialLength = Math.max(0.0001, Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z));
    const radialUnitX = point.x / radialLength;
    const radialUnitY = point.y / radialLength;
    const radialUnitZ = point.z / radialLength;

    return {
      initialPosition: [point.x, point.y, point.z],
      explodedPosition: [
        point.x + (radialUnitX * 0.7 + (randomA * 2 - 1) * 0.5) * explosion.strength,
        point.y + (radialUnitY * 0.7 + (randomB * 2 - 1) * 0.5) * explosion.strength,
        point.z + (
          radialUnitZ * 0.8
          + (randomC * 2 - 1) * 0.6
          + seededUnit(explosion.seed + index * 4.131) * 0.2
        ) * explosion.depthStrength,
      ],
      initialRotation: [0, 0, 0],
      explodedRotation: [
        (randomA * 2 - 1) * explosion.rotationStrength,
        (randomB * 2 - 1) * explosion.rotationStrength,
        (randomC * 2 - 1) * explosion.rotationStrength,
      ],
      initialScale: 1,
      explodedScale: 0.75 + seededUnit(explosion.seed + index * 5.907) * 0.6,
      color: resolveVoxelColor(point, points),
      pixelColor: point.sampleColor,
    };
  });

  return {
    cubes,
    cubeSize: generation.cubeSize,
  };
}