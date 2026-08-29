// Fighter definitions. Four groups of fields, each read by a different layer:
//
//   identity      id, short, name, nick, flag, record, stance   -> UI
//   presentation  body, rig, height, builtin, victoryClip,
//                 voice, announce                                -> anim.js, fighter3d.js
//   combat        stats, counterSkill, powerKO                   -> fight.js, modes/autochess/units.js
//   kit           kit                                            -> control mode only
//
// stats are 0-100 on all five axes. The two combat scalars are NOT on that
// scale and are the strongest levers in the sim:
//
//   counterSkill  0-1. Chance to fire a free counter when the opponent's
//                 strike misses. Roster spans 0.10 (Cotne) to 0.45 (Dato).
//   powerKO       Multiplier on flash-KO chance per landed hit. Absent means
//                 1. Roster spans 1.6 (Soso) to 4 (Cotne). A flash KO ends the
//                 fight outright, so this is worth far more than it looks.
//
// kit maps the three control-mode buttons to move keys in moves/.
//
// One file per fighter. This barrel is the only thing the game imports. The
// order of FIGHTERS is load-bearing: anim.js loads body models in this order
// and units.js keys each autochess unit to that index.

import type { Fighter } from './types.ts';
export type { Fighter, Kit, Visual, Voice } from './types.ts';

import { MERAB } from './merab.ts';
import { ILIA } from './ilia.ts';
import { DAVIT } from './davit.ts';
import { COTNE } from './cotne.ts';
import { DATO } from './dato.ts';
import { LEVAN } from './levan.ts';
import { DAVID } from './david.ts';
import { SOSO } from './soso.ts';
import { GIGI } from './gigi.ts';

export { MERAB } from './merab.ts';
export { ILIA } from './ilia.ts';
export { DAVIT } from './davit.ts';
export { COTNE } from './cotne.ts';
export { DATO } from './dato.ts';
export { LEVAN } from './levan.ts';
export { DAVID } from './david.ts';
export { SOSO } from './soso.ts';
export { GIGI } from './gigi.ts';

export const FIGHTERS: Fighter[] = [
  MERAB,
  ILIA,
  DAVIT,
  COTNE,
  DATO,
  LEVAN,
  DAVID,
  SOSO,
  GIGI,
];

export const FIGHTER_BY_ID: Record<string, Fighter> = Object.fromEntries(FIGHTERS.map(f => [f.id, f]));
