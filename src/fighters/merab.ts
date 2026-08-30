import { LEG_SWEEP, PUNCH_COMBO, SPARTAN_KICK } from '../moves/index.ts';
import type { Fighter } from './types.ts';

export const MERAB: Fighter = {
  id: 'merab', short: 'MERAB', name: 'Merab Dvalishvili', nick: 'The Machine', flag: '🇬🇪',
  record: '19–4–0', stance: 'orthodox',
  visual: {
    body: 'assets/fighters/merab/body.glb', rig: 'athletic', height: 1.8,
    idle: 'idle', victory: 'victory_cheer',
  },
  voice: { win: 'assets/fighters/merab/win.m4a', announce: null },
  stats: { striking: 86, grappling: 97, cardio: 97, chin: 95, speed: 86 },
  counterSkill: 0.25,
  powerKO: 1,
  kit: { light: PUNCH_COMBO, heavy: SPARTAN_KICK, special: LEG_SWEEP },
};
