import { DOUBLE_KICK, LUNGE_SPIN_KICK, PUNCH_COMBO_2 } from '../moves/index.js?v=202608281148';

export const LEVAN = {
  id: 'levan', short: 'LEVAN', name: 'Levan Kuprava', nick: 'The CPO', flag: '🇬🇪',
  record: '13–2–0', stance: 'orthodox',
  visual: {
    body: 'assets/fighters/levan/body.glb', rig: 'levan', height: 1.8,
    idle: 'gangnam_dance', victory: 'gangnam_dance',
  },
  voice: { win: null, announce: null },
  // speed-first volume all-rounder — pressure without Cotne/Dato's one-punch
  // gimmicks. Monte-Carlo balanced 43-57% vs the roster (N=3000): the Merab
  // matchup rides his speed edge, the Cotne one fears the power, like everyone.
  stats: { striking: 90, grappling: 90, cardio: 92, chin: 91, speed: 93 },
  counterSkill: 0.28,
  powerKO: 1,
  kit: { light: PUNCH_COMBO_2, heavy: DOUBLE_KICK, special: LUNGE_SPIN_KICK },
};
