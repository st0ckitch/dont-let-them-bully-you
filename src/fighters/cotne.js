import { HOOK, JUMPING_PUNCH, ROUNDHOUSE } from '../moves/index.js?v=202608281148';

export const COTNE = {
  id: 'cotne', short: 'COTNE', name: 'Cotne Patchuashvili', nick: 'The Fatso', flag: '🇬🇪',
  record: '9–1–0', stance: 'orthodox',
  visual: {
    body: 'assets/fighters/cotne/body.glb', rig: 'bigguy', height: 1.9,
    idle: 'boom_dance', victory: 'boom_dance',
  },
  voice: { win: null, announce: null },
  // one-punch power: 4× flash-KO chance — Monte-Carlo balanced (44-56% vs the
  // roster) to offset the slowest speed/cardio in the game
  stats: { striking: 96, grappling: 80, cardio: 86, chin: 98, speed: 79 },
  counterSkill: 0.1,
  powerKO: 4,
  kit: { light: HOOK, heavy: ROUNDHOUSE, special: JUMPING_PUNCH },
};
