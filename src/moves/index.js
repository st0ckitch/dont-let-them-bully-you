// Move catalogue: every strike the sim can throw, as data.
//
// A move is inert — it carries its animation key, the distances it works at,
// and the damage each impact does. Nothing here decides who throws it or what
// it does on landing; that lives in fight.js.
//
// `range` = distance the attacker closes to before striking.
// `reach`  = max distance at which an impact can actually land (air gate).
// `at`     = normalized clip time the impact fires at, tuned against the
//            clip's rotational-energy peak.
// `w`      = relative share of a fighter's move budget, from their stats.
//            Only ratios matter; 0 means the fighter never throws it.
//
// One file per move. This barrel is the only thing the sim imports. The order
// of MOVES is load-bearing: pickMove() walks it for a weighted draw, so
// reordering it changes which move a given roll lands on.

import { PUNCH_COMBO } from './punch_combo.js?v=202608281148';
import { ROUNDHOUSE } from './roundhouse.js?v=202608281148';
import { FLYING_KICK } from './flying_kick.js?v=202608281148';
import { HOOK } from './hook.js?v=202608281148';
import { UPPERCUT } from './uppercut.js?v=202608281148';
import { PUNCH_COMBO_2 } from './punch_combo_2.js?v=202608281148';
import { PUNCH_COMBO_4 } from './punch_combo_4.js?v=202608281148';
import { DOUBLE_KICK } from './double_kick.js?v=202608281148';
import { JUMPING_PUNCH } from './jumping_punch.js?v=202608281148';
import { LUNGE_SPIN_KICK } from './lunge_spin_kick.js?v=202608281148';
import { BACKFLIP_KICK } from './backflip_kick.js?v=202608281148';
import { KNEE_STRIKE } from './knee_strike.js?v=202608281148';
import { ELBOW_STRIKE } from './elbow_strike.js?v=202608281148';
import { LUNGE_ROUNDHOUSE } from './lunge_roundhouse.js?v=202608281148';
import { SPARTAN_KICK } from './spartan_kick.js?v=202608281148';
import { SWEEPING_KICK } from './sweeping_kick.js?v=202608281148';
import { KUNG_FU_PUNCH } from './kung_fu_punch.js?v=202608281148';
import { HIGH_KICK } from './high_kick.js?v=202608281148';
import { PUNCH_COMBO_3 } from './punch_combo_3.js?v=202608281148';
import { PUNCH_COMBO_5 } from './punch_combo_5.js?v=202608281148';
import { BACKFLIP_HOOKS } from './backflip_hooks.js?v=202608281148';
import { RISING_KICK } from './rising_kick.js?v=202608281148';
import { TURN_KICK } from './turn_kick.js?v=202608281148';
import { LEG_SWEEP } from './leg_sweep.js?v=202608281148';

export { PUNCH_COMBO } from './punch_combo.js?v=202608281148';
export { ROUNDHOUSE } from './roundhouse.js?v=202608281148';
export { FLYING_KICK } from './flying_kick.js?v=202608281148';
export { HOOK } from './hook.js?v=202608281148';
export { UPPERCUT } from './uppercut.js?v=202608281148';
export { PUNCH_COMBO_2 } from './punch_combo_2.js?v=202608281148';
export { PUNCH_COMBO_4 } from './punch_combo_4.js?v=202608281148';
export { DOUBLE_KICK } from './double_kick.js?v=202608281148';
export { JUMPING_PUNCH } from './jumping_punch.js?v=202608281148';
export { LUNGE_SPIN_KICK } from './lunge_spin_kick.js?v=202608281148';
export { BACKFLIP_KICK } from './backflip_kick.js?v=202608281148';
export { KNEE_STRIKE } from './knee_strike.js?v=202608281148';
export { ELBOW_STRIKE } from './elbow_strike.js?v=202608281148';
export { LUNGE_ROUNDHOUSE } from './lunge_roundhouse.js?v=202608281148';
export { SPARTAN_KICK } from './spartan_kick.js?v=202608281148';
export { SWEEPING_KICK } from './sweeping_kick.js?v=202608281148';
export { KUNG_FU_PUNCH } from './kung_fu_punch.js?v=202608281148';
export { HIGH_KICK } from './high_kick.js?v=202608281148';
export { PUNCH_COMBO_3 } from './punch_combo_3.js?v=202608281148';
export { PUNCH_COMBO_5 } from './punch_combo_5.js?v=202608281148';
export { BACKFLIP_HOOKS } from './backflip_hooks.js?v=202608281148';
export { RISING_KICK } from './rising_kick.js?v=202608281148';
export { TURN_KICK } from './turn_kick.js?v=202608281148';
export { LEG_SWEEP } from './leg_sweep.js?v=202608281148';
export { COUNTER_MOVE, COUNTER_CLIPS } from './counter.js?v=202608281148';

export const MOVES = [
  PUNCH_COMBO,
  ROUNDHOUSE,
  FLYING_KICK,
  HOOK,
  UPPERCUT,
  PUNCH_COMBO_2,
  PUNCH_COMBO_4,
  DOUBLE_KICK,
  JUMPING_PUNCH,
  LUNGE_SPIN_KICK,
  BACKFLIP_KICK,
  KNEE_STRIKE,
  ELBOW_STRIKE,
  LUNGE_ROUNDHOUSE,
  SPARTAN_KICK,
  SWEEPING_KICK,
  KUNG_FU_PUNCH,
  HIGH_KICK,
  PUNCH_COMBO_3,
  PUNCH_COMBO_5,
  BACKFLIP_HOOKS,
  RISING_KICK,
  TURN_KICK,
  LEG_SWEEP,
];

export const MOVE_BY_KEY = Object.fromEntries(MOVES.map(m => [m.key, m]));
