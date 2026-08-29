import type { Weighable } from '../types.ts';

/** One blow within a move. Each impact rolls separately for hit/block/miss AND
 *  separately for a flash KO, so hit count is also the flash-KO ticket count. */
export interface Impact {
  /** normalized clip time (0-1), tuned to the clip's rotational-energy peak */
  at: number;
  min: number;
  max: number;
}

export interface Move {
  /** unique id; also the animation clip name and the filename */
  key: string;
  label: string;
  /** distance the attacker closes to before striking */
  range: number;
  /** air gate: max distance at which an impact can still land. Always > range. */
  reach: number;
  /** heavy strikes get 1.5x flash-KO chance */
  heavy: boolean;
  impacts: Impact[];
  /** relative share of a fighter's move budget — see moves/README.md */
  w: (f: Weighable) => number;
}

/** Reactive counter: fired when a strike is dodged, never chosen as an attack. */
export type CounterMove = Omit<Move, 'w'>;

export interface CounterClip {
  key: string;
  at: number;
}
