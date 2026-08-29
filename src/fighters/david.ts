import { BACKFLIP_KICK, ROUNDHOUSE, UPPERCUT } from '../moves/index.ts';
import type { Fighter } from './types.ts';

export const DAVID: Fighter = {
  id: 'david', short: 'DAVID', name: 'David Kometiani', nick: 'The CEO', flag: '🇬🇪',
  record: '10–1–0', stance: 'orthodox',
  visual: {
    body: 'assets/fighters/david/body.glb', rig: 'david', height: 1.83,
    idle: 'funny_dance_3', victory: 'funny_dance_3',
  },
  voice: { win: null, announce: null },
  // boss with heavy hands: high striking + a bit of one-punch pop, weak
  // grappling. Monte-Carlo balanced 48-52% vs the whole roster (N=3000).
  stats: { striking: 94, grappling: 82, cardio: 90, chin: 94, speed: 87 },
  counterSkill: 0.2,
  powerKO: 1.8,
  kit: { light: UPPERCUT, heavy: ROUNDHOUSE, special: BACKFLIP_KICK },
};
