export const TURN_KICK = {
  key: 'turn_kick', label: 'step-in turn kick', range: 1.35, reach: 1.6, heavy: true,
  impacts: [{ at: 0.7, min: 12, max: 19 }],
  w: f => 3 + Math.max(0, f.stats.speed - 86) * 1.1,
};
