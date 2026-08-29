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

import type { Move } from './types.ts';
export type { Move, Impact, CounterMove, CounterClip } from './types.ts';

import { PUNCH_COMBO } from './punch_combo.ts';
import { ROUNDHOUSE } from './roundhouse.ts';
import { FLYING_KICK } from './flying_kick.ts';
import { HOOK } from './hook.ts';
import { UPPERCUT } from './uppercut.ts';
import { PUNCH_COMBO_2 } from './punch_combo_2.ts';
import { PUNCH_COMBO_4 } from './punch_combo_4.ts';
import { DOUBLE_KICK } from './double_kick.ts';
import { JUMPING_PUNCH } from './jumping_punch.ts';
import { LUNGE_SPIN_KICK } from './lunge_spin_kick.ts';
import { BACKFLIP_KICK } from './backflip_kick.ts';
import { KNEE_STRIKE } from './knee_strike.ts';
import { ELBOW_STRIKE } from './elbow_strike.ts';
import { LUNGE_ROUNDHOUSE } from './lunge_roundhouse.ts';
import { SPARTAN_KICK } from './spartan_kick.ts';
import { SWEEPING_KICK } from './sweeping_kick.ts';
import { KUNG_FU_PUNCH } from './kung_fu_punch.ts';
import { HIGH_KICK } from './high_kick.ts';
import { PUNCH_COMBO_3 } from './punch_combo_3.ts';
import { PUNCH_COMBO_5 } from './punch_combo_5.ts';
import { BACKFLIP_HOOKS } from './backflip_hooks.ts';
import { RISING_KICK } from './rising_kick.ts';
import { TURN_KICK } from './turn_kick.ts';
import { LEG_SWEEP } from './leg_sweep.ts';

export { PUNCH_COMBO } from './punch_combo.ts';
export { ROUNDHOUSE } from './roundhouse.ts';
export { FLYING_KICK } from './flying_kick.ts';
export { HOOK } from './hook.ts';
export { UPPERCUT } from './uppercut.ts';
export { PUNCH_COMBO_2 } from './punch_combo_2.ts';
export { PUNCH_COMBO_4 } from './punch_combo_4.ts';
export { DOUBLE_KICK } from './double_kick.ts';
export { JUMPING_PUNCH } from './jumping_punch.ts';
export { LUNGE_SPIN_KICK } from './lunge_spin_kick.ts';
export { BACKFLIP_KICK } from './backflip_kick.ts';
export { KNEE_STRIKE } from './knee_strike.ts';
export { ELBOW_STRIKE } from './elbow_strike.ts';
export { LUNGE_ROUNDHOUSE } from './lunge_roundhouse.ts';
export { SPARTAN_KICK } from './spartan_kick.ts';
export { SWEEPING_KICK } from './sweeping_kick.ts';
export { KUNG_FU_PUNCH } from './kung_fu_punch.ts';
export { HIGH_KICK } from './high_kick.ts';
export { PUNCH_COMBO_3 } from './punch_combo_3.ts';
export { PUNCH_COMBO_5 } from './punch_combo_5.ts';
export { BACKFLIP_HOOKS } from './backflip_hooks.ts';
export { RISING_KICK } from './rising_kick.ts';
export { TURN_KICK } from './turn_kick.ts';
export { LEG_SWEEP } from './leg_sweep.ts';
export { COUNTER_MOVE, COUNTER_CLIPS } from './counter.ts';

export const MOVES: Move[] = [
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

export const MOVE_BY_KEY: Record<string, Move> = Object.fromEntries(MOVES.map(m => [m.key, m]));
