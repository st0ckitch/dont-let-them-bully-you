import { ELBOW_STRIKE, LEG_SWEEP, UPPERCUT } from '../moves/index.ts';
import type { Fighter } from './types.ts';

export const GIGI: Fighter = {
  id: 'gigi', short: 'GIGI', name: 'Gigi Gvaramia', nick: 'The Deputy CTO', flag: '🇬🇪',
  record: '14–6–1', stance: 'southpaw',
  visual: {
    body: 'assets/fighters/gigi/body.glb', rig: 'gigi', height: 1.82,
    idle: 'pod_groove', victory: 'pod_groove',
  },
  voice: { win: 'assets/fighters/gigi/win.m4a', announce: null },
  // the architect: reads the fight like a system diagram — elite counters
  // (second only to Dato), sturdy chin, real grappling, a step slower than
  // the kids. simFight N=3000: 43-57% — feasts on merab (57), the teenage
  // speed of soso is the one system he can't debug (43).
  stats: { striking: 94, grappling: 89, cardio: 91, chin: 94, speed: 88 },
  counterSkill: 0.42,
  powerKO: 1,
  kit: { light: UPPERCUT, heavy: ELBOW_STRIKE, special: LEG_SWEEP },
};
