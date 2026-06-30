import type { TransitionField } from './types';
import { seededUnit } from './seed';
import { placeOnAxis } from './funnel';
import { applyChaos } from './chaos';

/**
 * A draining water vortex. Particles spiral inward and collapse into a tight,
 * fast-swirling core: the radial distribution is biased toward the centre, the
 * inner particles whirl fastest, and the core is pulled deepest down the drain
 * so the whole storm funnels into a single point.
 *
 * Params:
 *   `radius` — outer (rim) radius.
 *   `turns`  — how many times the feeder arm winds inward.
 *   `pull`   — core density bias (>1 packs more particles into the centre).
 *   `depth`  — how far the core sinks down the drain.
 *   `speed`  — swirl speed.
 *   `chaos`  — per-particle wander; some particles break free of the spiral.
 *   `axis`   — 0 into-screen (Z), 1 vertical (Y), 2 tilted. Default 0.
 *   `tilt`   — tilt angle (radians) when `axis` is 2.
 */
export const spiral: TransitionField = (ctx, out) => {
  const radiusMax = ctx.params.radius ?? 10;
  const turns = ctx.params.turns ?? 2.5;
  const pull = ctx.params.pull ?? 2.2;
  const depth = ctx.params.depth ?? 7;
  const speed = ctx.params.speed ?? 1.1;
  const chaos = ctx.params.chaos ?? 0.4;
  const axis = ctx.params.axis ?? 0;
  const tilt = ctx.params.tilt ?? 0.95;

  const phase = seededUnit(ctx.index * 0.197 + 3.1);
  const tb = seededUnit(ctx.index * 0.53 + 9.2);

  // Bias particles toward the core: t near 0 = centre, t near 1 = rim.
  const t = Math.pow(tb, pull);
  const radius = radiusMax * t;

  // Core particles (small t) whirl fastest, like the throat of a drain.
  const angularSpeed = speed * (0.5 + (1 - t) * 2.5);
  // Winding feeder arm + continuous swirl.
  const angle = phase * Math.PI * 2 + t * turns * Math.PI * 2
    + ctx.stormTime * angularSpeed;

  const px = Math.cos(angle) * radius;
  const py = Math.sin(angle) * radius;
  // Rim sits at the surface, core is sucked deepest → funnel to a point.
  const axial = -depth * (1 - t)
    + Math.sin(ctx.stormTime * 1.5 + ctx.index * 0.07) * 0.2;

  placeOnAxis(out, px, py, axial, axis, tilt);
  applyChaos(out, ctx.index, ctx.stormTime, chaos);
};
