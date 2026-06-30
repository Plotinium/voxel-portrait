import { seededUnit } from './seed';

/**
 * Adds a per-particle, animated wander offset to `out` so a fraction of
 * particles break free of the otherwise-perfect motion and feel organic. The
 * "escape" factor is heavily skewed: most particles drift only slightly while a
 * minority stray far, which reads as natural turbulence rather than uniform jitter.
 *
 * Pure and allocation-free — mutates `out` in place. Main-thread only (imports
 * `seed`), never bundle into the worker build.
 */
export function applyChaos(
  out: [number, number, number],
  index: number,
  stormTime: number,
  amount: number,
): void {
  if (amount <= 0) return;

  // Cubic skew: e^3 keeps most particles tame and lets a few escape hard.
  const e = seededUnit(index * 0.917 + 4.2);
  const a = amount * (0.35 + e * e * e * 3);

  const px = seededUnit(index * 0.271 + 8.1) * 6.28318;
  const py = seededUnit(index * 0.613 + 2.7) * 6.28318;
  const pz = seededUnit(index * 0.451 + 5.9) * 6.28318;

  out[0] += Math.sin(stormTime * 1.3 + px) * a
    + Math.sin(stormTime * 2.1 + px * 1.7) * a * 0.4;
  out[1] += Math.cos(stormTime * 1.1 + py) * a
    + Math.sin(stormTime * 1.9 + py * 1.3) * a * 0.4;
  out[2] += Math.sin(stormTime * 1.6 + pz) * a * 0.7;
}
