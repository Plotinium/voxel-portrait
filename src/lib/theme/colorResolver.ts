import type { VoxelColorConfig, VoxelPoint } from '../../types/voxelPortrait';

const FALLBACK_COLOR = '#38bdf8';

export function resolveVoxelColor(
  point: VoxelPoint,
  points: VoxelPoint[],
  colorConfig: VoxelColorConfig,
): string {
  let resolved: string;

  switch (colorConfig.mode) {
    case 'solid':
      resolved = colorConfig.value || FALLBACK_COLOR;
      break;
    case 'gradient':
      resolved = resolveGradientColor(point, colorConfig.palette, colorConfig.direction ?? 'vertical');
      break;
    case 'randomPalette':
      resolved = resolveRandomPaletteColor(point.index, colorConfig.palette, colorConfig.seed ?? 42);
      break;
    case 'imageSampled':
      resolved = tintColor(point.sampleColor, colorConfig.tint, colorConfig.tintStrength ?? 0.5);
      break;
    default:
      resolved = points.length > 0 ? points[0].sampleColor : FALLBACK_COLOR;
      break;
  }

  return normalizeColorToHex(resolved);
}

function resolveGradientColor(
  point: VoxelPoint,
  palette: string[],
  direction: 'horizontal' | 'vertical' | 'diagonal' | 'radial' | 'depth',
): string {
  const normalizedPalette = palette.length > 0 ? palette : [FALLBACK_COLOR, '#0f172a'];
  const factor = getGradientFactor(point, direction);
  return samplePalette(normalizedPalette, factor);
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

function resolveRandomPaletteColor(index: number, palette: string[], seed: number): string {
  const normalizedPalette = palette.length > 0 ? palette : [FALLBACK_COLOR];
  const pseudo = seededUnit(index + seed * 9973);
  const colorIndex = Math.min(normalizedPalette.length - 1, Math.floor(pseudo * normalizedPalette.length));
  return normalizedPalette[colorIndex];
}

function samplePalette(palette: string[], factor: number): string {
  if (palette.length === 1) {
    return palette[0];
  }

  const scaled = clamp01(factor) * (palette.length - 1);
  const left = Math.floor(scaled);
  const right = Math.min(palette.length - 1, left + 1);
  const localFactor = scaled - left;
  return mixHex(palette[left], palette[right], localFactor);
}

function tintColor(baseHex: string, tintHex?: string, tintStrength = 0.5): string {
  if (!tintHex) {
    return baseHex;
  }
  return mixHex(baseHex, tintHex, clamp01(tintStrength));
}

function mixHex(from: string, to: string, t: number): string {
  const fromRgb = parseColorToRgb(from);
  const toRgb = parseColorToRgb(to);

  const mixed = {
    r: Math.round(fromRgb.r + (toRgb.r - fromRgb.r) * t),
    g: Math.round(fromRgb.g + (toRgb.g - fromRgb.g) * t),
    b: Math.round(fromRgb.b + (toRgb.b - fromRgb.b) * t),
  };

  return rgbToHex(mixed.r, mixed.g, mixed.b);
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

function parseColorToRgb(color: string): { r: number; g: number; b: number } {
  const trimmed = color.trim();

  // Fast path for hex values.
  if (trimmed.startsWith('#')) {
    return hexToRgb(trimmed);
  }

  // Support rgb()/rgba() strings.
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

  // Browser parser fallback for named/hsl/advanced formats.
  if (typeof document !== 'undefined') {
    const probe = document.createElement('span');
    probe.style.color = trimmed;
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    document.body.removeChild(probe);

    const computedMatch = computed.match(/^rgba?\(([^)]+)\)$/i);
    if (computedMatch) {
      const parts = computedMatch[1].split(',').map((part) => parseFloat(part.trim()));
      if (parts.length >= 3 && parts.every((value) => Number.isFinite(value))) {
        return {
          r: clampByte(parts[0]),
          g: clampByte(parts[1]),
          b: clampByte(parts[2]),
        };
      }
    }
  }

  // Never return black due to parse failures.
  return hexToRgb(FALLBACK_COLOR);
}

function normalizeColorToHex(color: string): string {
  const { r, g, b } = parseColorToRgb(color);
  return rgbToHex(r, g, b);
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function seededUnit(value: number): number {
  const wave = Math.sin(value * 12.9898) * 43758.5453;
  return wave - Math.floor(wave);
}
