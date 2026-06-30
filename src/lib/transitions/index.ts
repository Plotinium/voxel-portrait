import type { TransitionField } from './types';
import { vortex } from './vortex';
import { spiral } from './spiral';
import { turbulence } from './turbulence';
import { nucleus } from './nucleus';

export type { TransitionContext, TransitionField } from './types';
export { vortex } from './vortex';
export { spiral } from './spiral';
export { turbulence } from './turbulence';
export { nucleus } from './nucleus';

/**
 * Registry of built-in particle-storm transitions. Add a new animation by
 * dropping a `TransitionField` here — the canvas/scene pick it up by name.
 */
export const TRANSITIONS: Record<string, TransitionField> = {
  vortex,
  spiral,
  turbulence,
  nucleus,
};

export type TransitionStyle = keyof typeof TRANSITIONS;

/** Resolve a style name to its field, falling back to `vortex`. */
export function getTransitionField(style: string | undefined): TransitionField {
  return (style ? TRANSITIONS[style] : undefined) ?? vortex;
}
