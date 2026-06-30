import type { TransitionField } from './types';
import { seededUnit } from './seed';

/**
 * Center-less flowing cloud — particles drift on layered sine "curl" motion.
 * The most chaotic, "storm"-like style. Params: `radius` (spread), `speed`,
 * `amplitude`.
 */
export const turbulence: TransitionField = (ctx, out) => {
  const spread = ctx.params.radius ?? 11;
  const speed = ctx.params.speed ?? 0.6;
  const amp = ctx.params.amplitude ?? 2.4;

  const hx = seededUnit(ctx.index * 0.127 + 1.1);
  const hy = seededUnit(ctx.index * 0.391 + 7.7);
  const hz = seededUnit(ctx.index * 0.733 + 3.3);

  const baseX = (hx - 0.5) * 2 * spread;
  const baseY = (hy - 0.5) * 2 * spread;
  const baseZ = (hz - 0.5) * 2 * (spread * 0.4);

  const tt = ctx.stormTime * speed;
  out[0] = baseX
    + Math.sin(tt + hy * 6.28318) * amp
    + Math.sin(tt * 1.7 + ctx.index * 0.13) * amp * 0.4;
  out[1] = baseY
    + Math.cos(tt * 1.2 + hx * 6.28318) * amp
    + Math.sin(tt * 1.9 + ctx.index * 0.09) * amp * 0.4;
  out[2] = baseZ
    + Math.sin(tt * 1.5 + hz * 6.28318) * amp * 0.5;
};
