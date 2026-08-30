import type { Move } from './types.ts';

export const RISING_KICK: Move = {
  key: 'rising_kick', label: 'rising flying kick', range: 1.4, reach: 1.7, heavy: true,
  impacts: [{ at: 0.45, min: 14, max: 22 }],
  w: f => 4 + Math.max(0, f.stats.speed - 88) * 1.3,
};
