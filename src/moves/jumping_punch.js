export const JUMPING_PUNCH = {
  key: 'jumping_punch', label: 'jumping punch', range: 1.15, reach: 1.4, heavy: false,
  impacts: [{ at: 0.46, min: 9, max: 15 }],
  w: f => 9 + Math.max(0, f.stats.speed - 86) * 1.6,
};
