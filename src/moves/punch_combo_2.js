export const PUNCH_COMBO_2 = {
  key: 'punch_combo_2', label: 'blitz combo', range: 1.05, reach: 1.3, heavy: false,
  impacts: [
    { at: 0.23, min: 3, max: 6 },
    { at: 0.44, min: 3, max: 6 },
    { at: 0.6, min: 3, max: 7 },
    { at: 0.7, min: 4, max: 8 },
  ],
  w: f => 18 + Math.max(0, f.stats.speed - 84) * 1.5,
};
