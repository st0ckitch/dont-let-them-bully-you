import { LUNGE_ROUNDHOUSE, LUNGE_SPIN_KICK, PUNCH_COMBO_4 } from '../moves/index.ts';
import type { Fighter } from './types.ts';

export const LIKA: Fighter = {
  id: 'lika', short: 'LIKA', name: 'Lika', nick: 'The Showstopper', flag: '🇬🇪',
  record: '7–1–0', stance: 'southpaw',
  visual: {
    body: 'assets/fighters/lika/body.glb', rig: 'lika', height: 1.68,
    idle: 'baby_groove', victory: 'baby_groove',
  },
  voice: { win: null, announce: 'assets/fighters/lika/announce.mp3' },
  // the showstopper: sharpest striking outside the champions with real
  // counter timing and a bit of one-kick pop; the walk-out line is hers.
  // simFight N=3000: 44-56% — beats merab (56), cotne's power (44) and the
  // teenage speed of soso (45) are the two that trouble her.
  stats: { striking: 93, grappling: 83, cardio: 90, chin: 92, speed: 90 },
  counterSkill: 0.36,
  powerKO: 1.3,
  kit: { light: PUNCH_COMBO_4, heavy: LUNGE_ROUNDHOUSE, special: LUNGE_SPIN_KICK },
};
