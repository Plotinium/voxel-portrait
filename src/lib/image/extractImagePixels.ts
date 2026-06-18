export type ExtractedImagePixels = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type ExtractImagePixelsOptions = {
  maxResolution?: number | false;
  imageScale?: number;
  offsetX?: number;
  offsetY?: number;
  rotationDeg?: number;
};

const DEFAULT_MAX_RESOLUTION = 512;

export async function extractImagePixels(
  imageSrc: string,
  options?: ExtractImagePixelsOptions,
): Promise<ExtractedImagePixels> {
  const image = await loadImage(imageSrc);
  const maxResolution = options?.maxResolution === false
    ? Number.POSITIVE_INFINITY
    : (options?.maxResolution ?? DEFAULT_MAX_RESOLUTION);

  // Downscale to maxResolution while preserving aspect ratio so
  // world-space coordinates are always within a predictable range.
  const scale = Math.min(1, maxResolution / Math.max(image.width, image.height));
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas context is not available.');
  }

  const imageScale = Math.max(0.01, options?.imageScale ?? 1);
  const offsetX = options?.offsetX ?? 0;
  const offsetY = options?.offsetY ?? 0;
  const rotationDeg = options?.rotationDeg ?? 0;
  const rotationRad = (rotationDeg * Math.PI) / 180;

  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.save();
  context.translate(
    width / 2 + offsetX * width,
    height / 2 + offsetY * height,
  );
  context.rotate(rotationRad);
  context.scale(imageScale, imageScale);
  context.drawImage(image, -width / 2, -height / 2, width, height);
  context.restore();

  const imageData = context.getImageData(0, 0, width, height);

  return {
    width,
    height,
    data: imageData.data,
  };
}

function loadImage(imageSrc: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${imageSrc}`));
    image.src = imageSrc;
  });
}
