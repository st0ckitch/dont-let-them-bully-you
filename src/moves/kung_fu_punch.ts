import type { Move } from './types.ts';

export const KUNG_FU_PUNCH: Move = {
  key: 'kung_fu_punch', label: 'kung-fu flurry', range: 1.05, reach: 1.3, heavy: false,
  impacts: [
    { at: 0.16, min: 4, max: 7 },
    { at: 0.36, min: 4, max: 7 },
    { at: 0.58, min: 4, max: 8 },
    { at: 0.74, min: 5, max: 8 },
  ],
  w: f => 8 + f.stats.striking * 0.1,
};
