import { FLYING_KICK, LUNGE_ROUNDHOUSE, PUNCH_COMBO_2 } from '../moves/index.ts';
import type { Fighter } from './types.ts';

export const ILIA: Fighter = {
  id: 'ilia', short: 'ILIA', name: 'Ilia Topuria', nick: 'El Matador', flag: '🇬🇪🇪🇸',
  record: '17–0–0', stance: 'orthodox',
  visual: {
    body: 'assets/fighters/ilia/body.glb', rig: 'athletic', height: 1.76,
    idle: 'walk', victory: 'chest_pound',
  },
  voice: { win: 'assets/fighters/ilia/win.m4a', announce: null },
  stats: { striking: 96, grappling: 88, cardio: 88, chin: 92, speed: 90 },
  counterSkill: 0.38,
  powerKO: 1,
  kit: { light: PUNCH_COMBO_2, heavy: LUNGE_ROUNDHOUSE, special: FLYING_KICK },
};
