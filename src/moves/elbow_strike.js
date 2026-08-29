export const ELBOW_STRIKE = {
  key: 'elbow_strike', label: 'elbow strike', range: 1.0, reach: 1.25, heavy: false,
  impacts: [{ at: 0.48, min: 9, max: 16 }],
  w: f => 6 + f.stats.striking * 0.1,
};
