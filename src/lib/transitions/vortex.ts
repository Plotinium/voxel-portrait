import type { TransitionField } from './types';
import { seededUnit } from './seed';
import { placeOnAxis } from './funnel';
import { applyChaos } from './chaos';

/**
 * A living, snaking tube. Particles wrap around a slim funnel whose centre line
 * bends and wanders unpredictably along its length and over time — like a hose
 * whipping around — instead of swirling around a fixed straight axis. Layered
 * sine waves drive the bend so the path never repeats cleanly, and `chaos` lets
 * a minority of particles escape the tube for an organic, turbulent feel.
 *
 * Params:
 *   `radius` — tube radius.
 *   `length` — tube length along its axis.
 *   `tip`    — far-end radius as a fraction of `radius` (0–1; 1 = even tube).
 *   `speed`  — swirl speed around the tube.
 *   `bend`   — how far the centre line snakes sideways.
 *   `chaos`  — per-particle wander; some particles break free of the tube.
 *   `axis`   — 0 into-screen (Z), 1 vertical (Y), 2 tilted. Default 2.
 *   `tilt`   — tilt angle (radians) when `axis` is 2.
 */
export const vortex: TransitionField = (ctx, out) => {
  const radiusMax = ctx.params.radius ?? 5;
  const length = ctx.params.length ?? 18;
  const tipRatio = ctx.params.tip ?? 0.5;
  const speed = ctx.params.speed ?? 1.4;
  const bend = ctx.params.bend ?? 3.2;
  const chaos = ctx.params.chaos ?? 0.6;
  const axis = ctx.params.axis ?? 2;
  const tilt = ctx.params.tilt ?? 0.95;

  // Per-particle seeds: angular phase, axial position, radial fill.
  const phase = seededUnit(ctx.index * 0.1234 + 1.7);
  const h = seededUnit(ctx.index * 0.3717 + 5.3); // 0 = near end, 1 = far end
  const rj = seededUnit(ctx.index * 0.7311 + 2.1);

  // Mild taper so it reads as a tube, not a wide cone.
  const radiusAtH = radiusMax * (tipRatio + (1 - tipRatio) * (1 - h));
  const radius = radiusAtH * Math.sqrt(0.2 + rj * 0.8);

  // Particles wrap around the tube; far rings spin a touch faster for shear.
  const angularSpeed = speed * (0.7 + h * 0.9);
  const angle = phase * Math.PI * 2 + ctx.stormTime * angularSpeed;

  // Radial position around the local axis.
  let px = Math.cos(angle) * radius;
  let py = Math.sin(angle) * radius;

  // Bend the centre line: offset depends on position ALONG the tube (h) and
  // time, with two unequal frequencies so the snake never looks periodic.
  px += Math.sin(h * 3.1 + ctx.stormTime * 0.9) * bend
    + Math.sin(h * 6.7 + ctx.stormTime * 1.7) * bend * 0.4;
  py += Math.cos(h * 2.7 + ctx.stormTime * 1.1) * bend
    + Math.sin(h * 5.3 + ctx.stormTime * 1.3) * bend * 0.4;

  const axial = (0.5 - h) * length;

  placeOnAxis(out, px, py, axial, axis, tilt);
  applyChaos(out, ctx.index, ctx.stormTime, chaos);
};
