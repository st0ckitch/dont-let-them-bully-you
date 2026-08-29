// Autochess battle resolution.
//
// Pure sim: no THREE, no DOM. The mode layer subscribes to `hooks` to drive
// animation and VFX, and a headless Monte-Carlo harness drives the exact same
// class to balance-check the roster — the same split fight.js uses between
// simFight() and Engine.
//
// Combat model follows TFT's evergreen rules: units acquire the nearest enemy,
// walk the hex grid toward it, auto-attack on an attack-speed cadence, build
// mana from attacking and from taking damage, and cast a signature ability the
// moment mana fills.

import * as Hex from './hex.ts';
import { statsFor, ATTACK_IMPACT_AT } from './units.ts';
import type { Unit, Ability, BoardSpec } from './types.ts';

export type Team = 'player' | 'enemy';
export type DamageType = 'physical' | 'magic';
type UnitState = 'idle' | 'move' | 'attack' | 'cast' | 'dead';
type Rng = () => number;

/** The mode layer subscribes to these to drive animation and VFX. The headless
 *  balance harness passes none, which is what keeps this file free of THREE. */
/** What the sim calls on a unit's visual. Structural on purpose: UnitView
 *  satisfies it, but this file stays free of THREE so it can run headless. */
export interface CombatView {
  setPosition(x: number, z: number): void;
  setBars(hpFrac: number, manaFrac: number): void;
  setBarsVisible(on: boolean): void;
  faceToward(x: number, z: number, dt: number, instant?: boolean): void;
  playIdle(): void;
  playWalk(): void;
  playAttack(clip: string, dur: number): void;
  playCast(clip: string, dur: number): void;
  castDuration(): number;
  flash(): void;
  hit(fromX: number, fromZ: number, strength: number): void;
  die(): void;
  /** world anchor the floating damage numbers track. Kept structural (plain
   *  x/y/z) so this file still has no THREE import. */
  readonly bars: { position: { x: number; y: number; z: number } };
}

export interface CombatHooks {
  castDuration?: (u: CombatUnit) => number;
  onMove?: (u: CombatUnit) => void;
  onArrive?: (u: CombatUnit) => void;
  onAttackStart?: (u: CombatUnit, tgt: CombatUnit | null, clip: string, dur: number) => void;
  onCastStart?: (u: CombatUnit, tgt: CombatUnit | null, ability: Ability, dur: number) => void;
  onAbility?: (u: CombatUnit, tgt: CombatUnit, ability: Ability) => void;
  onDamage?: (src: CombatUnit, tgt: CombatUnit, dealt: number, type: DamageType, crit: boolean) => void;
  onHeal?: (u: CombatUnit, amount: number) => void;
  onDeath?: (tgt: CombatUnit, src: CombatUnit) => void;
  onEnd?: (winner: Team | null, reason: string, survivors: CombatUnit[]) => void;
}

let rng: Rng = Math.random;
export function setCombatRng(fn: Rng | null): void { rng = fn || Math.random; }

// ---- tuning constants ----
export const ROUND_TIME = 30; // seconds before a battle is called
const MOVE_TIME = 0.42; // seconds to traverse one hex
const MANA_PER_ATTACK = 10;
// TFT grants mana for damage taken as a share of pre- and post-mitigation
// damage, capped per instance so one huge hit can't fully charge an ultimate.
// 7% post-mitigation is the universal Sets 5-14 rule, which is the right one
// here: the 3% figure belongs to Set 15+, where it applies to TANKS ONLY as
// part of a role-based system this mode doesn't have.
const MANA_PRE_MIT = 0.01;
const MANA_POST_MIT = 0.07;
const MANA_PER_HIT_CAP = 42.5;
// Units cannot gain mana from damage briefly after casting, so a unit being
// focused doesn't chain-cast.
const MANA_LOCK = 1.0;
const ATTACK_SPEED_CAP = 5.0;
const ABILITY_WINDUP = 0.45; // share of the cast clip before the hit lands

// Armour and magic resist both use TFT's reciprocal curve: N resist means you
// take 100/(100+N) of the damage, so each point is worth progressively more
// effective HP and nothing ever reaches immunity. Resist is clamped at 0 —
// unlike League, TFT has no negative-resist amplification branch, so a shred
// that overshoots must bottom out at full damage rather than amplify it.
export const mitigate = (dmg: number, resist: number): number => dmg * (100 / (100 + Math.max(0, resist)));

let nextUid = 1;

export class CombatUnit {
  readonly uid: number;
  readonly unit: Unit;
  readonly star: number;
  readonly team: Team;
  col: number; row: number;
  /** hex being walked INTO. The unit stays on col/row for targeting until it
   *  arrives but reserves the destination so nobody else paths there. */
  resCol: number; resRow: number;
  maxHp: number; hp: number; ad: number; armor: number; mr: number;
  attackSpeed: number; maxMana: number; mana: number;
  critChance: number; critMult: number; abilityPower: number; range: number;
  state: UnitState;
  target: CombatUnit | null;
  atkCd: number; phaseT: number; phaseDur: number;
  impactFired: boolean; stun: number; manaLock: number;
  fromX: number; fromZ: number; toX: number; toZ: number;
  clip: string | null;
  x: number; z: number;
  /** attached by the mode layer; absent in headless runs */
  view?: CombatView | null;
  entryUid?: number;
  spec?: BoardSpec;

  constructor(unit: Unit, star: number, team: Team, col: number, row: number) {
    const s = statsFor(unit, star);
    this.uid = nextUid++;
    this.unit = unit;
    this.star = star;
    this.team = team; // 'player' | 'enemy'
    this.col = col;
    this.row = row;
    // Hex being walked into. A unit occupies its current hex for targeting and
    // range purposes until it actually arrives, but reserves the destination so
    // nobody else paths into it. Collapsing the two (advancing col/row at the
    // START of a step) meant the mover committed to a 0.42s traversal while its
    // opponent already measured the shortened distance and attacked for free —
    // which skewed every range-2 mirror match to ~90/10.
    this.resCol = col;
    this.resRow = row;
    this.maxHp = s.maxHp;
    this.hp = s.maxHp;
    this.ad = s.ad;
    this.armor = s.armor;
    this.mr = s.mr;
    this.attackSpeed = s.attackSpeed;
    this.maxMana = s.maxMana;
    this.mana = Math.min(s.startMana, s.maxMana);
    this.critChance = s.critChance;
    this.critMult = s.critMult;
    this.abilityPower = s.abilityPower;
    this.range = unit.range;

    this.state = 'idle';
    this.target = null;
    this.atkCd = rng() * 0.3; // stagger the opening volley
    this.phaseT = 0;
    this.phaseDur = 0;
    this.impactFired = false;
    this.stun = 0;
    this.manaLock = 0;
    this.fromX = 0; this.fromZ = 0; this.toX = 0; this.toZ = 0;
    this.clip = null;
    const w = Hex.cellToWorld(col, row);
    this.x = w.x; this.z = w.z;
  }

  get alive(): boolean { return this.hp > 0; }
  get cell(): { col: number; row: number } { return { col: this.col, row: this.row }; }
  // seconds one auto-attack occupies, from windup to recovery
  get attackInterval(): number { return 1 / Math.min(this.attackSpeed, ATTACK_SPEED_CAP); }
}

export class Combat {
  // `hooks` is optional; the headless harness passes none.
  readonly units: CombatUnit[];
  private readonly hooks: CombatHooks;
  t: number;
  tick: number;
  over: boolean;
  winner: Team | null;
  survivors: CombatUnit[] = [];
  private readonly _order: Uint16Array;

  constructor(units: CombatUnit[], hooks: CombatHooks = {}) {
    this.units = units;
    this.hooks = hooks;
    this.t = 0;
    this.tick = 0;
    this.over = false;
    this.winner = null;
    this._order = new Uint16Array(units.length); // reused per tick, no per-frame alloc
  }

  living(team: Team): CombatUnit[] {
    return this.units.filter(u => u.team === team && u.alive);
  }

  // A hex is unavailable if a living unit stands on it OR is walking into it.
  occupiedBy(col: number, row: number, self: CombatUnit): boolean {
    return this.units.some(u => u !== self && u.alive
      && ((u.col === col && u.row === row) || (u.resCol === col && u.resRow === row)));
  }

  // Nearest living enemy by hex distance. Ties break on lowest current HP and
  // then uid, so the sim is fully deterministic under a seeded rng.
  acquire(u: CombatUnit): CombatUnit | null {
    let best: CombatUnit | null = null, bestD = Infinity, bestHp = Infinity;
    for (const e of this.units) {
      if (e.team === u.team || !e.alive) continue;
      const d = Hex.distance(u.cell, e.cell);
      if (d < bestD || (d === bestD && (e.hp < bestHp || (e.hp === bestHp && best !== null && e.uid < best.uid)))) {
        best = e; bestD = d; bestHp = e.hp;
      }
    }
    return best;
  }

  update(dt: number): void {
    if (this.over) return;
    this.t += dt;

    // Units resolve sequentially within a tick, so whoever is visited first
    // acts on the freshest board and reserves contested hexes first. A fixed
    // array order hands that edge to the same team every tick; a cyclic
    // rotation is no better, because it preserves each pair's relative order.
    // A seeded shuffle turns the advantage into noise that averages out, and
    // stays deterministic for replays because rng is seeded.
    this.tick++;
    const order = this._order;
    const n = this.units.length;
    for (let i = 0; i < n; i++) order[i] = i;
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    for (let i = 0; i < n; i++) {
      const u = this.units[order[i]];
      if (!u.alive) continue;
      if (u.manaLock > 0) u.manaLock -= dt;
      if (u.stun > 0) {
        u.stun -= dt;
        // a stun interrupts whatever the unit was mid-way through. A move gets
        // snapped to its reserved hex rather than abandoned, so the unit never
        // ends up stranded visually between two cells.
        if (u.state === 'move') {
          u.col = u.resCol; u.row = u.resRow;
          const w = Hex.cellToWorld(u.col, u.row);
          u.x = w.x; u.z = w.z;
          u.state = 'idle';
          this.hooks.onArrive?.(u);
        } else if (u.state === 'attack') {
          u.state = 'idle';
        }
        continue;
      }
      this._stepUnit(u, dt);
      if (this.over) return;
    }

    if (this.t >= ROUND_TIME) this._finish('timeout');
  }

  private _stepUnit(u: CombatUnit, dt: number): void {
    // --- in-flight phases resolve first ---
    if (u.state === 'cast') return this._advanceCast(u, dt);
    if (u.state === 'attack') return this._advanceAttack(u, dt);
    if (u.state === 'move') return this._advanceMove(u, dt);

    // --- idle: decide ---
    if (u.mana >= u.maxMana) return this._beginCast(u);

    if (!u.target || !u.target.alive) u.target = this.acquire(u);
    const tgt = u.target;
    if (!tgt) return this._finish(u.team);

    if (Hex.distance(u.cell, tgt.cell) <= u.range) {
      u.atkCd -= dt;
      if (u.atkCd <= 0) this._beginAttack(u);
      return;
    }
    this._beginMove(u, tgt);
  }

  // ---- movement ----
  private _beginMove(u: CombatUnit, tgt: CombatUnit): void {
    const step = Hex.stepToward(u.cell, tgt.cell, (c, r) => this.occupiedBy(c, r, u));
    if (!step) return; // boxed in — hold position and keep trying next tick
    u.fromX = u.x; u.fromZ = u.z;
    const w = Hex.cellToWorld(step.col, step.row);
    u.toX = w.x; u.toZ = w.z;
    // reserve the destination (so nobody else paths into it) but stay logically
    // on the origin hex until arrival — see the note on resCol/resRow
    u.resCol = step.col; u.resRow = step.row;
    u.state = 'move';
    u.phaseT = 0;
    u.phaseDur = MOVE_TIME;
    this.hooks.onMove?.(u);
  }

  private _advanceMove(u: CombatUnit, dt: number): void {
    u.phaseT += dt;
    const k = Math.min(1, u.phaseT / u.phaseDur);
    u.x = u.fromX + (u.toX - u.fromX) * k;
    u.z = u.fromZ + (u.toZ - u.fromZ) * k;
    if (k >= 1) {
      u.col = u.resCol;
      u.row = u.resRow;
      u.state = 'idle';
      this.hooks.onArrive?.(u);
    }
  }

  // ---- auto attacks ----
  private _beginAttack(u: CombatUnit): void {
    u.state = 'attack';
    u.phaseT = 0;
    u.phaseDur = u.attackInterval;
    u.impactFired = false;
    u.clip = u.unit.attackClips[Math.floor(rng() * u.unit.attackClips.length)];
    this.hooks.onAttackStart?.(u, u.target, u.clip, u.phaseDur);
  }

  private _advanceAttack(u: CombatUnit, dt: number): void {
    u.phaseT += dt;
    const at = ((u.clip ? ATTACK_IMPACT_AT[u.clip] : undefined) ?? 0.5) * u.phaseDur;
    if (!u.impactFired && u.phaseT >= at) {
      u.impactFired = true;
      const tgt = u.target;
      // the target may have died or walked out of reach during the windup
      if (tgt?.alive && Hex.distance(u.cell, tgt.cell) <= u.range) {
        const crit = rng() < u.critChance;
        const raw = u.ad * (crit ? u.critMult : 1);
        this._damage(u, tgt, raw, 'physical', crit);
        // deliberately NOT clamped to maxMana — the surplus is what _beginCast
        // carries over into the next cycle
        u.mana = Math.min(u.maxMana * 2, u.mana + MANA_PER_ATTACK);
      }
    }
    if (u.phaseT >= u.phaseDur) {
      u.state = 'idle';
      u.atkCd = 0;
    }
  }

  // ---- abilities ----
  private _beginCast(u: CombatUnit): void {
    u.state = 'cast';
    u.phaseT = 0;
    u.impactFired = false;
    // Overflow carries rather than resetting to zero (patch 14.15): a unit that
    // banked 140 of a 100-mana bar starts the next cycle at 40. Capped at one
    // cast's worth so a huge burst can't queue several casts at once.
    u.mana = Math.min(u.maxMana, Math.max(0, u.mana - u.maxMana));
    u.manaLock = MANA_LOCK;
    if (!u.target || !u.target.alive) u.target = this.acquire(u);
    const dur = this.hooks.castDuration?.(u) ?? 1.1;
    u.phaseDur = dur;
    this.hooks.onCastStart?.(u, u.target, u.unit.ability, dur);
  }

  private _advanceCast(u: CombatUnit, dt: number): void {
    u.phaseT += dt;
    if (!u.impactFired && u.phaseT >= u.phaseDur * ABILITY_WINDUP) {
      u.impactFired = true;
      this._resolveAbility(u);
      if (this.over) return;
    }
    if (u.phaseT >= u.phaseDur) {
      u.state = 'idle';
      u.atkCd = 0;
    }
  }

  private _resolveAbility(u: CombatUnit): void {
    const ab = u.unit.ability;
    const tgt = u.target?.alive ? u.target : this.acquire(u);
    if (!tgt) return;
    // `ad` already carries the star multiplier, so ability damage scales with
    // star level without a second factor.
    const base = u.ad * ab.dmg;
    this.hooks.onAbility?.(u, tgt, ab);

    if (ab.kind === 'cleave') {
      const victims = [tgt, ...this.units.filter(e =>
        e.team !== u.team && e.alive && e !== tgt && Hex.distance(e.cell, tgt.cell) === 1)];
      for (const v of victims) {
        this._damage(u, v, base, 'magic', false);
        if (ab.stun) v.stun = Math.max(v.stun, ab.stun);
        if (this.over) return;
      }
      return;
    }

    if (ab.kind === 'flurry') {
      // the flurry's hits all land on the impact frame; splitting them across
      // the clip would let the target die mid-animation and waste the rest
      for (let i = 0; i < ab.hits; i++) {
        if (!tgt.alive) break;
        this._damage(u, tgt, base / ab.hits, 'magic', false);
        if (this.over) return;
      }
      return;
    }

    if (ab.kind === 'heal') {
      // heal is a multiple of AD, deliberately independent of the damage roll
      const healed = Math.min(u.maxHp - u.hp, u.ad * ab.heal);
      u.hp += healed;
      if (healed > 0) this.hooks.onHeal?.(u, healed);
      this._damage(u, tgt, base, 'magic', false);
      return;
    }

    // burst
    this._damage(u, tgt, base, 'magic', false);
    if (ab.stun) tgt.stun = Math.max(tgt.stun, ab.stun);
  }

  // ---- damage ----
  private _damage(src: CombatUnit, tgt: CombatUnit, raw: number, type: DamageType, crit: boolean): void {
    if (!tgt.alive) return;
    const resist = type === 'magic' ? tgt.mr : tgt.armor;
    const dealt = mitigate(raw, resist);
    tgt.hp -= dealt;

    if (tgt.manaLock <= 0) {
      const gain = Math.min(MANA_PER_HIT_CAP, raw * MANA_PRE_MIT + dealt * MANA_POST_MIT);
      tgt.mana = Math.min(tgt.maxMana * 2, tgt.mana + gain);
    }

    this.hooks.onDamage?.(src, tgt, dealt, type, crit);

    if (tgt.hp <= 0) {
      tgt.hp = 0;
      tgt.state = 'dead';
      tgt.target = null;
      this.hooks.onDeath?.(tgt, src);
      // anyone who was chasing the corpse re-acquires next tick
      for (const o of this.units) if (o.target === tgt) o.target = null;
      if (!this.living(tgt.team).length) this._finish(src.team);
    }
  }

  private _finish(reason: string): void {
    if (this.over) return;
    this.over = true;
    const pl = this.living('player');
    const en = this.living('enemy');
    const p = pl.length, e = en.length;
    // Timeouts break on units left, then on remaining health as a fraction of
    // max — a true double-KO is the only honest draw, so board-wide stalemates
    // still produce a result instead of stacking up "draw" rounds.
    const frac = (arr: CombatUnit[]): number => arr.reduce((s, u) => s + u.hp / u.maxHp, 0);
    this.winner = p && !e ? 'player'
      : e && !p ? 'enemy'
        : p !== e ? (p > e ? 'player' : 'enemy')
          : p === 0 ? null
            : frac(pl) === frac(en) ? null : (frac(pl) > frac(en) ? 'player' : 'enemy');
    this.survivors = this.winner ? this.living(this.winner) : [];
    this.hooks.onEnd?.(this.winner, reason, this.survivors);
  }
}

// Damage dealt to the losing player: a flat amount for how deep the game is,
// plus a per-survivor toll that scales with star level. Mirrors TFT, where
// losing to a wide board hurts far more than losing to a lone carry.
// Softer than before on both axes. The old curve (base up to 26, survivors
// worth 2/4/6 by star) ended the average game around round 14 — stage 3 — so
// the 4-and-5-cost endgame the shop odds gate behind level 7+ effectively did
// not exist: nobody ever met an Ilia. A stage-3 loss now costs ~12 HP instead
// of ~20, which stretches the arc into the levels where the premium roster
// actually comes online.
const STAGE_DAMAGE: number[] = [0, 0, 2, 4, 6, 8, 11, 14, 17];
const SURVIVOR_DAMAGE: Record<number, number> = { 1: 1, 2: 2, 3: 3 };

export function playerDamage(stage: number, survivors: CombatUnit[]): number {
  const base = STAGE_DAMAGE[Math.min(stage, STAGE_DAMAGE.length - 1)];
  return base + survivors.reduce((s, u) => s + (SURVIVOR_DAMAGE[u.star] || 2), 0);
}
