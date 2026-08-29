import { BACKFLIP_HOOKS, PUNCH_COMBO, TURN_KICK } from '../moves/index.ts';
import type { Fighter } from './types.ts';

export const SOSO: Fighter = {
  id: 'soso', short: 'SOSO', name: 'Soso Ananov', nick: 'The 17', flag: '🇬🇪',
  record: '5–0–0', stance: 'southpaw',
  visual: {
    body: 'assets/fighters/soso/body.glb', rig: 'soso', height: 1.78,
    idle: 'funky_walk', victory: 'muscle_flex',
  },
  voice: { win: 'assets/fighters/soso/win.m4a', announce: 'assets/fighters/soso/announce.mp3' },
  // teenage prodigy: fastest man in the roster with a bottomless gas tank
  // and finishing instinct, green everywhere else — no grappling, chin still
  // developing. powerKO (not striking) is the buff lever here: flash KOs
  // scale on the OPPONENT'S chin, so it lifts him vs the mid-tier without
  // blowing out the merab matchup. Balanced against BOTH sims (simFight
  // N=4000 AND headless live-engine N=200+): 46-61% band, wins mostly
  // finishes. Weak-side story: cotne/david trade bombs with him ~50/50.
  stats: { striking: 89, grappling: 78, cardio: 93, chin: 90, speed: 94 },
  counterSkill: 0.3,
  powerKO: 1.6,
  kit: { light: PUNCH_COMBO, heavy: TURN_KICK, special: BACKFLIP_HOOKS },
};
