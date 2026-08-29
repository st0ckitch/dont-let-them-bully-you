export const KNEE_STRIKE = {
  key: 'knee_strike', label: 'step knee', range: 1.0, reach: 1.25, heavy: false,
  impacts: [{ at: 0.33, min: 9, max: 15 }],
  w: f => 6 + f.stats.grappling * 0.1,
};
