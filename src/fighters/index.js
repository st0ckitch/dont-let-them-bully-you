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

import { MERAB } from './merab.js?v=202608281148';
import { ILIA } from './ilia.js?v=202608281148';
import { DAVIT } from './davit.js?v=202608281148';
import { COTNE } from './cotne.js?v=202608281148';
import { DATO } from './dato.js?v=202608281148';
import { LEVAN } from './levan.js?v=202608281148';
import { DAVID } from './david.js?v=202608281148';
import { SOSO } from './soso.js?v=202608281148';
import { GIGI } from './gigi.js?v=202608281148';

export { MERAB } from './merab.js?v=202608281148';
export { ILIA } from './ilia.js?v=202608281148';
export { DAVIT } from './davit.js?v=202608281148';
export { COTNE } from './cotne.js?v=202608281148';
export { DATO } from './dato.js?v=202608281148';
export { LEVAN } from './levan.js?v=202608281148';
export { DAVID } from './david.js?v=202608281148';
export { SOSO } from './soso.js?v=202608281148';
export { GIGI } from './gigi.js?v=202608281148';

export const FIGHTERS = [
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

export const FIGHTER_BY_ID = Object.fromEntries(FIGHTERS.map(f => [f.id, f]));
