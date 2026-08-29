export const PUNCH_COMBO = {
  key: 'punch_combo', label: 'punch combo', range: 1.05, reach: 1.3, heavy: false,
  impacts: [
    { at: 0.22, min: 5, max: 10 },
    { at: 0.45, min: 5, max: 10 },
    { at: 0.72, min: 6, max: 11 },
  ],
  w: f => 55 + f.stats.striking * 0.5,
};
