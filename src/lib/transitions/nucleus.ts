import type { TransitionField } from './types';
import { seededUnit } from './seed';
import { applyChaos } from './chaos';

/**
 * A pulsing nucleus. Particles fill a sphere whose surface ripples with layered
 * waves so the whole mass breathes and wobbles like a living cell, while the
 * core itself drifts on a slow wave. `chaos` lets a fraction of particles bud
 * off the surface, keeping the blob organic rather than perfectly smooth.
 *
 * Params:
 *   `radius`    — base nucleus radius.
 *   `amplitude` — how far the surface waves push particles in/out.
 *   `speed`     — wave + drift speed.
 *   `drift`     — how far the whole nucleus wanders.
 *   `chaos`     — per-particle wander; some particles bud off the surface.
 */
export const nucleus: TransitionField = (ctx, out) => {
  const radius = ctx.params.radius ?? 6;
  const amplitude = ctx.params.amplitude ?? 1.6;
  const speed = ctx.params.speed ?? 1.0;
  const drift = ctx.params.drift ?? 1.8;
  const chaos = ctx.params.chaos ?? 0.7;

  // Even point distribution inside a sphere.
  const phi = seededUnit(ctx.index * 0.317 + 1.9) * 6.28318;
  const cosT = seededUnit(ctx.index * 0.733 + 6.1) * 2 - 1;
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const fill = Math.cbrt(seededUnit(ctx.index * 0.529 + 3.4)); // uniform volume

  // Ripple the radius with two unequal wave bands → a breathing, lumpy surface.
  const wave = Math.sin(phi * 3 + ctx.stormTime * speed)
    + Math.sin(cosT * 4 + ctx.stormTime * speed * 1.3) * 0.7;
  const r = radius * fill + wave * amplitude;

  const x = r * sinT * Math.cos(phi);
  const y = r * sinT * Math.sin(phi);
  const z = r * cosT * 0.8;

  const tt = ctx.stormTime * speed;
  out[0] = x + Math.sin(tt * 0.7) * drift;
  out[1] = y + Math.cos(tt * 0.9) * drift;
  out[2] = z + Math.sin(tt * 1.1) * drift * 0.6;

  applyChaos(out, ctx.index, ctx.stormTime, chaos);
};
