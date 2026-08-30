import type { Move } from './types.ts';

// ---- second animation batch; impact `at` values sit on the clip's
// rotational-energy peaks so strikes, dodges and blocks line up visually
export const DOUBLE_KICK: Move = {
  key: 'double_kick', label: 'double kick', range: 1.35, reach: 1.6, heavy: true,
  impacts: [
    { at: 0.3, min: 7, max: 12 },
    { at: 0.46, min: 7, max: 12 },
  ],
  w: f => 6 + Math.max(0, f.stats.speed - 84) * 1.6,
};
