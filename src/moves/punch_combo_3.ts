import type { Move } from './types.ts';

// ---- Dato's batch; impact `at` values from rotational-energy peaks
export const PUNCH_COMBO_3: Move = {
  key: 'punch_combo_3', label: 'combination', range: 1.05, reach: 1.3, heavy: false,
  impacts: [
    { at: 0.27, min: 4, max: 8 },
    { at: 0.36, min: 4, max: 8 },
    { at: 0.59, min: 5, max: 9 },
  ],
  w: f => 14 + f.stats.striking * 0.2,
};
