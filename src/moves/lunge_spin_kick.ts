import type { Move } from './types.ts';

export const LUNGE_SPIN_KICK: Move = {
  key: 'lunge_spin_kick', label: 'spinning kick', range: 1.35, reach: 1.6, heavy: true,
  impacts: [{ at: 0.63, min: 12, max: 19 }],
  w: f => 6 + f.stats.striking * 0.09,
};
