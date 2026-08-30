import type { Fighter } from '../../fighters/types.ts';

/** How an ability resolves. Drives the switch in combat.ts. */
export type AbilityKind = 'burst' | 'flurry' | 'cleave' | 'heal';

interface AbilityBase {
  name: string;
  /** animation clip; its real length sets the sim's cast window */
  clip: string;
  mana: number;
  hits: number;
  /** multiple of the unit's AD, so it inherits star scaling for free */
  dmg: number;
  stun?: number;
}

/** Discriminated on `kind` so `heal` is only reachable where it exists — the
 *  sustain is a multiple of AD, NOT of the ability's damage, because keying it
 *  off the damage let Merab out-heal what he was taking and stalemate mirrors. */
export type Ability =
  | (AbilityBase & { kind: 'burst' | 'flurry' | 'cleave' })
  | (AbilityBase & { kind: 'heal'; heal: number });

/** Base stats before star scaling. */
export interface UnitBase {
  hp: number;
  ad: number;
  attackSpeed: number;
  armor: number;
  mr: number;
  startMana: number;
  maxMana: number;
  critChance: number;
  critMult: number;
}

/** A roster fighter re-expressed as a TFT-style unit. */
export interface Unit {
  id: string;
  cfg: Fighter;
  /** loadAssets() returns models in FIGHTERS order; this indexes into that */
  modelIndex: number;
  cost: number;
  name: string;
  short: string;
  nick: string;
  rig: string;
  blurb: string;
  role: string;
  color: string;
  /** hexes; the two reach units pay for it in HP and AD */
  range: number;
  attackClips: string[];
  idleClip: string;
  ability: Ability;
  base: UnitBase;
}

/** Stats for one star level. */
export interface StarStats {
  maxHp: number;
  ad: number;
  attackSpeed: number;
  armor: number;
  mr: number;
  maxMana: number;
  startMana: number;
  critChance: number;
  critMult: number;
  abilityPower: number;
}

/** A bench/board entry. `cell` is null while benched. */
export interface Entry {
  uid: number;
  unitId: string;
  star: number;
  cell: number | null;
}

/** Wire format for one board slot in an online match: a single cell id, which
 *  is what both peers must agree on byte-for-byte. */
export interface BoardSpec {
  id: string;
  star: number;
  cell: number;
}

/** What the local AI hands the sim. Deliberately NOT BoardSpec — it addresses
 *  hexes as (col,row) and never goes over the wire. */
export interface AiBoardSpec {
  id: string;
  star: number;
  col: number;
  row: number;
}
