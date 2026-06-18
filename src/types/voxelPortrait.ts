export type VoxelColorConfig =
  | {
      mode: 'solid';
      value: string;
    }
  | {
      mode: 'gradient';
      palette: string[];
      direction?: 'horizontal' | 'vertical' | 'diagonal' | 'radial' | 'depth';
    }
  | {
      mode: 'randomPalette';
      palette: string[];
      seed?: number;
    }
  | {
      mode: 'imageSampled';
      tint?: string;
      tintStrength?: number;
    };

export type VoxelPoint = {
  index: number;
  x: number;
  y: number;
  z: number;
  sampleColor: string;
  normalizedX: number;
  normalizedY: number;
};

export type VoxelCubeData = {
  initialPosition: [number, number, number];
  explodedPosition: [number, number, number];
  initialRotation: [number, number, number];
  explodedRotation: [number, number, number];
  initialScale: number;
  explodedScale: number;
  color: string;
  /** Raw pixel colour sampled from the source image, regardless of the active colour mode. */
  pixelColor: string;
};

export type VoxelGenerationConfig = {
  density?: number;
  cubeSize?: number;
  alphaThreshold?: number;
  maxCubes?: number;
  depthMultiplier?: number;
};
