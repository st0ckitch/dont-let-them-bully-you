export const HIGH_KICK = {
  key: 'high_kick', label: 'step high kick', range: 1.3, reach: 1.55, heavy: true,
  impacts: [{ at: 0.66, min: 13, max: 20 }],
  w: f => 5 + f.stats.striking * 0.08,
};
