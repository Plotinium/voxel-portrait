/**
 * Maps a point from canonical funnel space into world space for a chosen axis.
 *
 * Canonical space: `(px, py)` is the radial plane and `axial` runs along the
 * funnel's centre line — positive `axial` is the wide mouth (toward the camera
 * for the default Z axis), negative is the narrow tip.
 *
 * `axis` encoding (numeric so it can travel through `transition.params`):
 *   0 = into the screen (Z) — looking down a whirlpool, tip recedes away.
 *   1 = vertical (Y)        — upright tornado, wide top narrowing down.
 *   2 = tilted              — Z funnel rotated toward the camera by `tilt` rad.
 *
 * Pure and allocation-free: writes straight into `out`.
 */
export function placeOnAxis(
  out: [number, number, number],
  px: number,
  py: number,
  axial: number,
  axis: number,
  tilt: number,
): void {
  if (axis === 1) {
    // Vertical tornado: axial becomes height (positive = wide top).
    out[0] = px;
    out[1] = axial;
    out[2] = py;
    return;
  }
  if (axis === 2) {
    // Tilted: take the into-screen funnel and rotate it around the X axis so
    // the 3D cone is seen in perspective.
    const c = Math.cos(tilt);
    const s = Math.sin(tilt);
    out[0] = px;
    out[1] = py * c - axial * s;
    out[2] = py * s + axial * c;
    return;
  }
  // Default (0): into the screen along Z.
  out[0] = px;
  out[1] = py;
  out[2] = axial;
}
