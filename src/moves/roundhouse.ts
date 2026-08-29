import type { Move } from './types.ts';

export const ROUNDHOUSE: Move = {
  key: 'roundhouse', label: 'roundhouse kick', range: 1.3, reach: 1.55, heavy: true,
  impacts: [{ at: 0.5, min: 13, max: 21 }],
  w: f => 18 + f.stats.striking * 0.3,
};
