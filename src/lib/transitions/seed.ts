/** Deterministic 0–1 hash, matching the seededUnit used elsewhere in the lib. */
export function seededUnit(value: number): number {
  const wave = Math.sin(value * 12.9898) * 43758.5453;
  return wave - Math.floor(wave);
}
