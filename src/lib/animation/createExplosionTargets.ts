import type { VoxelCubeData, VoxelPoint } from '../../types/voxelPortrait';

type ExplosionConfig = {
  strength?: number;
  depthStrength?: number;
  rotationStrength?: number;
  seed?: number;
};

const DEFAULT_CONFIG: Required<ExplosionConfig> = {
  strength: 2.4,
  depthStrength: 2.2,
  rotationStrength: 1.2,
  seed: 42,
};

export function createExplosionTargets(
  points: VoxelPoint[],
  colorForPoint: (point: VoxelPoint) => string,
  config?: ExplosionConfig,
): VoxelCubeData[] {
  const { strength, depthStrength, rotationStrength, seed } = { ...DEFAULT_CONFIG, ...config };

  return points.map((point, index) => {
    const randomA = seededUnit(seed + index * 1.123);
    const randomB = seededUnit(seed + index * 2.417);
    const randomC = seededUnit(seed + index * 3.917);

    const radialX = point.x;
    const radialY = point.y;
    const radialZ = point.z;
    const radialLength = Math.max(
      0.0001,
      Math.sqrt(radialX * radialX + radialY * radialY + radialZ * radialZ),
    );
    const radialUnitX = radialX / radialLength;
    const radialUnitY = radialY / radialLength;
    const radialUnitZ = radialZ / radialLength;

    const jitterX = randomA * 2 - 1;
    const jitterY = randomB * 2 - 1;
    const jitterZ = randomC * 2 - 1;

    const explodedX = point.x + (radialUnitX * 0.7 + jitterX * 0.5) * strength;
    const explodedY = point.y + (radialUnitY * 0.7 + jitterY * 0.5) * strength;
    const explodedZ =
      point.z +
      (radialUnitZ * 0.8 + jitterZ * 0.6 + seededUnit(seed + index * 4.131) * 0.2) * depthStrength;

    return {
      initialPosition: [point.x, point.y, point.z],
      explodedPosition: [explodedX, explodedY, explodedZ],
      initialRotation: [0, 0, 0],
      explodedRotation: [
        (randomA * 2 - 1) * rotationStrength,
        (randomB * 2 - 1) * rotationStrength,
        (randomC * 2 - 1) * rotationStrength,
      ],
      initialScale: 1,
      explodedScale: 0.75 + seededUnit(seed + index * 5.907) * 0.6,
      color: colorForPoint(point),
      pixelColor: point.sampleColor,
    };
  });
}

function seededUnit(value: number): number {
  const wave = Math.sin(value * 12.9898) * 43758.5453;
  return wave - Math.floor(wave);
}
