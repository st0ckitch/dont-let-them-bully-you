import type { Stats, Stance } from '../types.ts';
import type { Move } from '../moves/types.ts';

/** Read by anim.ts, fighter3d.ts and the autochess unit view. */
export interface Visual {
  body: string;
  /** skeleton family; fighters sharing a rig share one retargeting bind pose */
  rig: string;
  /** metres — scales the model on load */
  height: number;
  /** clip shipped INSIDE the body GLB: the signature dance or stance */
  idle: string;
  victory: string;
}

export interface Voice {
  win: string | null;
  /** ring-announcer walk-out line at the opening bell */
  announce: string | null;
}

/** The three control-mode buttons. Holds real Move objects, not key strings,
 *  so a typo is a module-load error rather than a dead button mid-fight. */
export interface Kit {
  light: Move;
  heavy: Move;
  special: Move;
}

export interface Fighter {
  id: string;
  short: string;
  name: string;
  nick: string;
  flag: string;
  /** display only — decorative, not simulated */
  record: string;
  stance: Stance;
  visual: Visual;
  voice: Voice;
  stats: Stats;
  /** 0-1: chance to fire a free counter when the opponent's strike misses */
  counterSkill: number;
  /** multiplier on flash-KO chance per landed hit; 1 is neutral, roster runs to 4.
   *  A flash KO ends the fight outright, so this is worth more than it looks. */
  powerKO: number;
  kit: Kit;
}
