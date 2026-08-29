import type { Move } from './types.ts';

export const LUNGE_ROUNDHOUSE: Move = {
  key: 'lunge_roundhouse', label: 'lunging roundhouse', range: 1.4, reach: 1.65, heavy: true,
  impacts: [{ at: 0.66, min: 13, max: 21 }],
  w: f => 5 + f.stats.striking * 0.08,
};
