import type { Move } from './types.ts';

export const BACKFLIP_KICK: Move = {
  key: 'backflip_kick', label: 'backflip sweep kick', range: 1.4, reach: 1.65, heavy: true,
  impacts: [{ at: 0.74, min: 15, max: 23 }],
  w: f => 3 + Math.max(0, f.stats.speed - 86) * 1.2,
};
