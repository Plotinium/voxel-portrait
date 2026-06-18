import type { VoxelGenerationConfig, VoxelPoint } from '../../types/voxelPortrait';

type PixelSource = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

type CandidatePoint = Omit<VoxelPoint, 'index'> & {
  detail: number;
};

const DEFAULT_CONFIG: Required<VoxelGenerationConfig> = {
  density: 0.55,
  cubeSize: 0.08,
  alphaThreshold: 40,
  maxCubes: 2800,
  depthMultiplier: 18,
};

export function generateVoxelMap(
  pixels: PixelSource,
  config?: VoxelGenerationConfig,
): VoxelPoint[] {
  const { density, cubeSize, alphaThreshold, maxCubes, depthMultiplier } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const step = Math.max(1, Math.round(1 / Math.max(0.05, density)));
  const centerX = pixels.width / 2;
  const centerY = pixels.height / 2;

  const candidates: CandidatePoint[] = [];

  for (let y = 0; y < pixels.height; y += step) {
    for (let x = 0; x < pixels.width; x += step) {
      const pixelIndex = (y * pixels.width + x) * 4;
      const alpha = pixels.data[pixelIndex + 3];
      if (alpha <= alphaThreshold) {
        continue;
      }

      const r = pixels.data[pixelIndex];
      const g = pixels.data[pixelIndex + 1];
      const b = pixels.data[pixelIndex + 2];
      const luminance = getLuminance(r, g, b);
      const depth = (0.5 - luminance) * cubeSize * depthMultiplier;
      const detail = estimateDetail(pixels, x, y);

      candidates.push({
        x: (x - centerX) * cubeSize,
        y: (centerY - y) * cubeSize,
        z: depth,
        sampleColor: rgbToHex(r, g, b),
        normalizedX: x / Math.max(1, pixels.width - 1),
        normalizedY: y / Math.max(1, pixels.height - 1),
        detail,
      });
    }
  }

  if (candidates.length <= maxCubes) {
    return candidates.map((point, index) => ({
      ...point,
      index,
    }));
  }

  const selected = new Set<number>();
  const uniformCount = Math.max(1, Math.floor(maxCubes * 0.72));
  const detailCount = Math.max(0, maxCubes - uniformCount);

  const uniformStep = candidates.length / uniformCount;
  for (let i = 0; i < uniformCount; i += 1) {
    const sourceIndex = Math.min(candidates.length - 1, Math.floor(i * uniformStep));
    selected.add(sourceIndex);
  }

  const rankedByDetail = candidates
    .map((candidate, index) => ({
      index,
      score: candidate.detail,
    }))
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

  const sampled: VoxelPoint[] = [];
  const sortedIndices = Array.from(selected).sort((a, b) => a - b);
  for (let i = 0; i < sortedIndices.length; i += 1) {
    const sourceIndex = sortedIndices[i];
    const { detail: _detail, ...candidate } = candidates[sourceIndex];
    sampled.push({
      ...candidate,
      index: i,
    });
  }

  return sampled;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function getLuminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function estimateDetail(pixels: PixelSource, x: number, y: number): number {
  const center = getPixelLuminance(pixels, x, y);
  const left = getPixelLuminance(pixels, x - 1, y);
  const right = getPixelLuminance(pixels, x + 1, y);
  const up = getPixelLuminance(pixels, x, y - 1);
  const down = getPixelLuminance(pixels, x, y + 1);

  const gx = Math.abs(right - left);
  const gy = Math.abs(down - up);
  const localContrast = Math.abs(center - (left + right + up + down) / 4);

  return gx + gy + localContrast;
}

function getPixelLuminance(pixels: PixelSource, x: number, y: number): number {
  const clampedX = Math.min(pixels.width - 1, Math.max(0, x));
  const clampedY = Math.min(pixels.height - 1, Math.max(0, y));
  const pixelIndex = (clampedY * pixels.width + clampedX) * 4;

  const r = pixels.data[pixelIndex];
  const g = pixels.data[pixelIndex + 1];
  const b = pixels.data[pixelIndex + 2];
  return getLuminance(r, g, b);
}
