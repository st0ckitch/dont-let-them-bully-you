// ---- Gigi's clip; impact at the trimmed sweep's energy peak
export const LEG_SWEEP = {
  key: 'leg_sweep', label: 'leg sweep', range: 1.2, reach: 1.45, heavy: true,
  impacts: [{ at: 0.28, min: 12, max: 20 }],
  // grappling-gated: sweeps are a wrestler's tool (merab picks it up too —
  // matrix-checked, it nudges his soft pairings up without breaking any)
  w: f => 3 + Math.max(0, f.stats.grappling - 88) * 1.0,
};
