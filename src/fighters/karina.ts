import { PUNCH_COMBO, RISING_KICK, ROUNDHOUSE } from '../moves/index.ts';
import type { Fighter } from './types.ts';

export const KARINA: Fighter = {
  id: 'karina', short: 'KARINA', name: 'Karina', nick: 'The Spin Doctor', flag: '🇬🇪',
  record: '8–2–0', stance: 'orthodox',
  visual: {
    body: 'assets/fighters/karina/body.glb', rig: 'karina', height: 1.7,
    idle: 'arm_flex', victory: 'arm_flex',
  },
  voice: { win: null, announce: null },
  // kick-first speedster: fast hands and a deep gas tank buy her the attack
  // frequency and a little one-kick pop (powerKO) buys the finishes; light grappling,
  // chin still developing. simFight N=3000: 41-57% — takes merab (57), the
  // one-punch power of cotne is the matchup she fears (41), like everyone.
  stats: { striking: 91, grappling: 84, cardio: 92, chin: 90, speed: 92 },
  counterSkill: 0.3,
  powerKO: 1.35,
  kit: { light: PUNCH_COMBO, heavy: ROUNDHOUSE, special: RISING_KICK },
};
