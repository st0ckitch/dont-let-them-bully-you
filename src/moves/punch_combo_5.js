export const PUNCH_COMBO_5 = {
  key: 'punch_combo_5', label: 'pressure flurry', range: 1.05, reach: 1.3, heavy: false,
  impacts: [
    { at: 0.2, min: 3, max: 6 },
    { at: 0.36, min: 3, max: 6 },
    { at: 0.5, min: 3, max: 7 },
    { at: 0.62, min: 4, max: 7 },
  ],
  w: f => 10 + Math.max(0, f.stats.cardio - 84) * 1.4,
};
