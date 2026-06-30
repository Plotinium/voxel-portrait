export type TransitionContext = {
  /** Instance index of the particle being placed. */
  index: number;
  /** Total active particle count. */
  count: number;
  /** Global clock seconds (continuous — use for spin so motion never freezes). */
  elapsed: number;
  /** Seconds since the current storm began. */
  stormTime: number;
  /** Portrait base position the particle disperses from / converges to. */
  bx: number;
  by: number;
  bz: number;
  /** Per-style tuning values supplied via `options.transition.params`. */
  params: Record<string, number>;
};

/**
 * Computes a particle's full-storm position (storm-space) and writes it into
 * `out`. Implementations MUST be pure and allocation-free — they run once per
 * particle per frame on the render hot path.
 */
export type TransitionField = (
  ctx: TransitionContext,
  out: [number, number, number],
) => void;
