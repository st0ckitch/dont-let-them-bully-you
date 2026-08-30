import { PUNCH_COMBO_3, PUNCH_COMBO_5, SWEEPING_KICK } from '../moves/index.ts';
import type { Fighter } from './types.ts';

export const DATO: Fighter = {
  id: 'dato', short: 'DATO', name: 'Dato Witaishvili', nick: 'The Firuz', flag: '🇬🇪',
  record: '11–2–0', stance: 'southpaw',
  visual: {
    body: 'assets/fighters/dato/body.glb', rig: 'dato', height: 1.85,
    idle: 'funny_dance', victory: 'funny_dance',
  },
  voice: { win: null, announce: null },
  // counter-brawler: highest counterSkill in the roster + some one-punch pop.
  // Monte-Carlo balanced: 51/50/54/56% vs merab/ilia/davit/cotne (N=3000)
  stats: { striking: 94, grappling: 86, cardio: 88, chin: 96, speed: 85 },
  counterSkill: 0.45,
  powerKO: 1.8,
  kit: { light: PUNCH_COMBO_3, heavy: SWEEPING_KICK, special: PUNCH_COMBO_5 },
};
