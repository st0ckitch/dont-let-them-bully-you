export const SWEEPING_KICK = {
  key: 'sweeping_kick', label: 'sweeping kick', range: 1.3, reach: 1.55, heavy: true,
  impacts: [{ at: 0.53, min: 11, max: 17 }],
  w: f => 5 + Math.max(0, f.stats.speed - 84) * 1.2,
};
