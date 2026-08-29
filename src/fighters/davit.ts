import { HIGH_KICK, KUNG_FU_PUNCH, PUNCH_COMBO_4 } from '../moves/index.ts';
import type { Fighter } from './types.ts';

export const DAVIT: Fighter = {
  id: 'davit', short: 'DAVIT', name: 'Davit Panjakidze', nick: 'The Hoking', flag: '🇬🇪',
  record: '12–3–0', stance: 'southpaw',
  visual: {
    body: 'assets/fighters/davit/body.glb', rig: 'portrait', height: 1.82,
    idle: 'uppercut', victory: 'flex',
  },
  voice: { win: 'assets/fighters/davit/win.m4a', announce: null },
  // chin 88→91 after the 30s-round retune: flash KOs weigh more in longer
  // fights and his chin was the soft target in every drifted pairing
  stats: { striking: 90, grappling: 85, cardio: 92, chin: 91, speed: 92 },
  counterSkill: 0.3,
  powerKO: 1,
  kit: { light: PUNCH_COMBO_4, heavy: HIGH_KICK, special: KUNG_FU_PUNCH },
};
