// Primitives shared by both halves of the model. Kept here rather than in
// either folder because moves need a fighter's stats to weight themselves and
// fighters hold moves — putting these in one side would make that circular.

/** The five 0-100 axes every fighter has. Roster spans 78-98, so 90 is average. */
export interface Stats {
  striking: number;
  grappling: number;
  cardio: number;
  chin: number;
  speed: number;
}

/** Data, not a label — `STANCE_LABEL` in main.ts is its only display form. */
export type Stance = 'orthodox' | 'southpaw';

/** The shape a move's weight function needs. Narrower than Fighter on purpose:
 *  it keeps moves/ from importing fighters/. */
export interface Weighable {
  stats: Stats;
}
