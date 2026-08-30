import type { Move } from './types.ts';

export const FLYING_KICK: Move = {
  key: 'flying_kick', label: 'flying kick', range: 1.45, reach: 1.75, heavy: true,
  impacts: [{ at: 0.55, min: 16, max: 25 }],
  w: f => 8 + Math.max(0, f.stats.speed - 84) * 3,
};
