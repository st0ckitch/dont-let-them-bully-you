import type { Move } from './types.ts';

export const SPARTAN_KICK: Move = {
  key: 'spartan_kick', label: 'spartan kick', range: 1.25, reach: 1.5, heavy: true,
  impacts: [{ at: 0.51, min: 12, max: 20 }],
  w: f => 5 + f.stats.striking * 0.08,
};
