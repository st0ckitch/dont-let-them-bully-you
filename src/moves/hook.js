export const HOOK = {
  key: 'hook', label: 'left hook', range: 1.05, reach: 1.3, heavy: false,
  impacts: [{ at: 0.5, min: 8, max: 14 }],
  w: f => 25 + f.stats.striking * 0.3,
};
