import type { Move } from './types.ts';

// ---- Soso's batch; impact `at` values from rotational-energy peaks on the
// TRIMMED clip (backflip_hooks plays its [0.5, 4.35] window)
export const BACKFLIP_HOOKS: Move = {
  key: 'backflip_hooks', label: 'backflip & hooks', range: 1.1, reach: 1.35, heavy: false,
  // 3 impacts, not 4: flash KOs roll per hit, and a 4th ticket was enough
  // to tilt Cotne (powerKO 4) into 62% over the soft-chinned end of the roster
  impacts: [
    { at: 0.27, min: 8, max: 14 },
    { at: 0.78, min: 6, max: 10 },
    { at: 0.91, min: 6, max: 10 },
  ],
  // weights speed-gated, not striking-scaled: striking-scaled versions
  // handed Cotne (STR 96, powerKO 4) two extra flash-KO vectors and drifted
  // his merab pairing 43% -> 52% in the matrix rerun
  w: f => 4 + Math.max(0, f.stats.striking - 90) * 1.0,
};
