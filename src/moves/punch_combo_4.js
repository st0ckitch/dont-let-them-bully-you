export const PUNCH_COMBO_4 = {
  key: 'punch_combo_4', label: 'body combo', range: 1.05, reach: 1.3, heavy: false,
  impacts: [
    { at: 0.22, min: 4, max: 7 },
    { at: 0.4, min: 3, max: 6 },
    { at: 0.59, min: 4, max: 7 },
    { at: 0.78, min: 4, max: 8 },
  ],
  w: f => 14 + f.stats.striking * 0.22,
};
