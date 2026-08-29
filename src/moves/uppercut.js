export const UPPERCUT = {
  key: 'uppercut', label: 'uppercut', range: 1.0, reach: 1.25, heavy: false,
  impacts: [{ at: 0.5, min: 10, max: 16 }],
  w: f => 15 + f.stats.striking * 0.25,
};
