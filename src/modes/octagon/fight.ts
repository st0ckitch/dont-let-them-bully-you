import { MOVES, COUNTER_MOVE, COUNTER_CLIPS } from '../../moves/index.ts';
import type { Move, Impact, CounterMove } from '../../moves/types.ts';
import type { Fighter } from '../../fighters/types.ts';
import type { Stats } from '../../types.ts';

type Rng = () => number;
export type Outcome = { kind: 'hit' | 'block' | 'miss'; dmg: number; crit: boolean };
export type FightResult = 'a' | 'b' | 'a-dec' | 'b-dec' | 'draw';

/** What the sim needs from a rendered fighter. Fighter3D satisfies it; the
 *  headless simFight() never touches one. Kept structural so this module stays
 *  independent of the 3D layer. */
export interface FighterActor {
  cfg: Fighter;
  stats: Stats;
  hp: number;
  state: string;
  currentKey: string | null;
  /** clip name -> AnimationAction; read to pick a counter variant the rig has */
  actions: Record<string, unknown>;
  pos: { x: number; y: number; z: number };
  startPos: { x: number; y: number; z: number };
  play(key: string, opts?: {
    once?: boolean; fade?: number; timeScale?: number; onDone?: (() => void) | null;
  }): void;
  clipDuration(key: string): number;
  scrub(key: string, frac: number): void;
  distanceTo(other: FighterActor): number;
  faceToward(point: { x: number; y: number; z: number }, dt: number, instant?: boolean): void;
  moveToward(point: { x: number; y: number; z: number }, speed: number, dt: number): void;
  knockback(fromPos: { x: number; y: number; z: number }, strength: number): void;
  defend(on: boolean): void;
  guardPulse(): void;
  evade(dur?: number): void;
  flash(): void;
  ko(): void;
  victory(): void;
  reset(): void;
  update(dt: number): void;
}

interface PlannedImpact { imp: Impact; out: Outcome; fired: boolean; }

interface ActiveStrike {
  atk: FighterActor;
  def: FighterActor;
  move: Move | CounterMove;
  dur: number;
  t: number;
  done: boolean;
  /** set when the dodger earns a counter; null means none this strike */
  counterAt: number | null;
  plan: PlannedImpact[];
}

/** The lightweight fighter stand-in simFight() runs on — no 3D, no animation. */
interface SimSide { hp: number; stats: Stats; counterSkill: number; powerKO: number; }

/** Everything the engine reports outward. main.ts supplies the implementation;
 *  the headless simFight() never uses one. */
export interface EngineCallbacks {
  onHP(): void;
  onLine(line: string): void;
  onRound(round: number, seconds: number): void;
  onRoundCard(text: string): void;
  onBell(): void;
  onImpact(heavy: boolean, crit: boolean, kind: 'punch' | 'kick'): void;
  onDamage(def: FighterActor, dmg: number, crit: boolean, atk: FighterActor, moveKey: string): void;
  onKO(winner: FighterActor, loser: FighterActor, info: { method: string; round: number }): void;
  onDecision(winner: FighterActor | null, loser: FighterActor | null, cards: string): void;
  /** fired only in TAKE CONTROL, where the visuals react to the player */
  onCrit?(atk: FighterActor): void;
  onDodge?(): void;
  onBlock?(heavy: boolean): void;
}

// All sim randomness flows through rng() so multiplayer can seed it: both
// clients replay the identical fight (decisions, damage, commentary) from a
// shared 32-bit seed. Unseeded local play keeps Math.random. Determinism also
// requires the fixed-step engine updates in main.js — variable dt would let
// clients consume the stream at different sim times.
let rng: Rng = Math.random;
export function setFightRng(fn: Rng | null): void { rng = fn || Math.random; }
export function seededRng(seed: number): Rng {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = (a: number, b: number): number => a + rng() * (b - a);
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

export const ROUNDS = 3;
export const ROUND_SECONDS = 30;
const ROUND_RECOVERY = 18; // corner work between rounds — scaled with the longer rounds
const DMG_SCALE = 0.38; // Monte-Carlo tuned for 30s rounds: most fights finish, a solid minority reaches the judges

// Dodge clip timing: per-bone angular-velocity analysis puts the head
// furthest off-line ~1.25s into the dodge subclip; played at DODGE_SPEED the
// peak arrives DODGE_PEAK seconds after the clip starts.
const DODGE_SPEED = 1.4;
const DODGE_PEAK = 1.25 / DODGE_SPEED;

// countering a strong grappler is risky — their frame resists the shot
export function counterBonus(victimStats: Stats): number {
  return 0.18 - Math.max(0, victimStats.grappling - 88) * 0.012;
}

// ---- pure resolution math (shared by the live engine and the simulator) ----
export function pickAttackerProb(a: Stats, b: Stats): number {
  return 0.5 + (a.speed - b.speed) * 0.006 + (a.cardio - b.cardio) * 0.0085;
}

export function pickMove(stats: Stats): Move {
  const ws = MOVES.map(m => m.w({ stats }));
  let r = rng() * ws.reduce((s, w) => s + w, 0);
  for (let i = 0; i < MOVES.length; i++) {
    r -= ws[i];
    if (r <= 0) return MOVES[i];
  }
  return MOVES[0];
}

// chance the defender abandons defense and swings at the same time
export function tradeProb(defStats: Stats): number {
  return Math.min(0.35, 0.16 + (defStats.speed - 86) * 0.008 + (defStats.striking - 88) * 0.004);
}

// small chance any clean hit ends it on the spot — better chins resist it.
// `power` is the attacker's cfg.powerKO (one-punch-power fighters like Cotne
// carry >1); everyone else defaults to 1.
export function flashKOProb(move: Move | CounterMove, out: Outcome, defStats: Stats, power = 1): number {
  const base = (out.crit ? 0.03 : 0.008) * (move.heavy ? 1.5 : 1) * power;
  return Math.max(0.002, base * (105 - defStats.chin) / 15);
}

export function resolveImpactMath(_move: Move | CounterMove, impact: Impact, atkStats: Stats, defStats: Stats, bonus = 0): Outcome {
  const p = Math.min(0.9, Math.max(0.3,
    0.58 + bonus + (atkStats.striking - 88) * 0.008 - (defStats.speed - 88) * 0.005));
  const r = rng();
  if (r < p) {
    let dmg = rand(impact.min, impact.max);
    const crit = rng() < 0.12;
    if (crit) dmg *= 1.6;
    dmg *= (182 - defStats.chin) / 92;
    dmg *= DMG_SCALE;
    return { kind: 'hit', dmg: Math.max(1, Math.round(dmg)), crit };
  }
  if (r < p + 0.22) return { kind: 'block', dmg: Math.round(rand(1, 3)), crit: false };
  return { kind: 'miss', dmg: 0, crit: false };
}

// Headless Monte Carlo of the full ruleset: rounds, trades, flash KOs,
// scorecards. Returns 'a'/'b' (KO), 'a-dec'/'b-dec' (decision), or 'draw'.
export function simFight(cfgA: Fighter, cfgB: Fighter): FightResult {
  const mk = (c: Fighter): SimSide => ({ hp: 100, stats: c.stats, counterSkill: c.counterSkill, powerKO: c.powerKO });
  const a = mk(cfgA), b = mk(cfgB);
  const totals = { a: 0, b: 0 };
  let pa = 0, pb = 0;
  const koWin = (f: SimSide): FightResult => (f === a ? 'a' : 'b');
  for (let round = 1; round <= ROUNDS; round++) {
    const rd = { a: 0, b: 0 };
    let tLeft = ROUND_SECONDS;
    while (tLeft > 0) {
      tLeft -= 2 + rng() * 1.5;
      const aAtt = rng() < pickAttackerProb(a.stats, b.stats);
      const atk = aAtt ? a : b, def = aAtt ? b : a;
      const akey = aAtt ? 'a' : 'b', dkey = aAtt ? 'b' : 'a';
      const trade = rng() < tradeProb(def.stats);
      const move = pickMove(atk.stats);
      let missRolled = false;
      for (const imp of move.impacts) {
        const r = resolveImpactMath(move, imp, atk.stats, def.stats, trade ? 0.15 : 0);
        def.hp -= r.dmg;
        rd[akey] += r.dmg;
        totals[akey] += r.dmg;
        if (def.hp > 0 && r.kind === 'hit' && rng() < flashKOProb(move, r, def.stats, atk.powerKO)) def.hp = 0;
        if (def.hp <= 0) return koWin(atk);
        // mirror the live engine: only the FIRST miss of an exchange can counter, never in a trade
        if (!trade && r.kind === 'miss' && !missRolled && (missRolled = true) && rng() < (def.counterSkill || 0)) {
          const c = resolveImpactMath(COUNTER_MOVE, COUNTER_MOVE.impacts[0], def.stats, atk.stats, counterBonus(atk.stats));
          atk.hp -= c.dmg;
          rd[dkey] += c.dmg;
          totals[dkey] += c.dmg;
          if (atk.hp > 0 && c.kind === 'hit' && rng() < flashKOProb(COUNTER_MOVE, c, atk.stats, def.powerKO)) atk.hp = 0;
          if (atk.hp <= 0) return koWin(def);
          break;
        }
      }
      if (trade) {
        const move2 = pickMove(def.stats);
        for (const imp of move2.impacts) {
          const r = resolveImpactMath(move2, imp, def.stats, atk.stats, 0.15);
          atk.hp -= r.dmg;
          rd[dkey] += r.dmg;
          totals[dkey] += r.dmg;
          if (atk.hp > 0 && r.kind === 'hit' && rng() < flashKOProb(move2, r, atk.stats, def.powerKO)) atk.hp = 0;
          if (atk.hp <= 0) return koWin(def);
        }
      }
    }
    if (Math.abs(rd.a - rd.b) < 2) { pa += 10; pb += 10; }
    else if (rd.a > rd.b) { pa += 10; pb += 9; }
    else { pb += 10; pa += 9; }
    a.hp = Math.min(100, a.hp + ROUND_RECOVERY);
    b.hp = Math.min(100, b.hp + ROUND_RECOVERY);
  }
  if (pa !== pb) return pa > pb ? 'a-dec' : 'b-dec';
  if (Math.abs(totals.a - totals.b) > 3) return totals.a > totals.b ? 'a-dec' : 'b-dec';
  return 'draw';
}

function hitLine(move: Move | CounterMove, atk: FighterActor, def: FighterActor, dmg: number, crit: boolean): string {
  const A = atk.cfg.short, B = def.cfg.short;
  if (crit) return `💥 HUGE ${move.label.toUpperCase()} from ${A}! −${dmg}`;
  return pick([
    `🥊 ${A} lands the ${move.label}! −${dmg}`,
    `🥊 ${move.label} connects for ${A}! −${dmg}`,
    `🥊 ${A} tags ${B}! −${dmg}`,
  ]);
}

// ---- live engine ----
// rounds ⟶ exchanges ⟶ strikes; a strike list (not a single slot) so both
// fighters can have live strikes at once when they trade.
export class Engine {
  readonly a: FighterActor;
  readonly b: FighterActor;
  readonly cb: EngineCallbacks;
  /** the fighter under player control in TAKE CONTROL; null in auto-sim */
  ctl: FighterActor | null = null;
  ctlGuard = false;
  state: string;
  phase: string;
  round!: number;
  roundClock!: number;
  roundSeconds: number;
  roundEnding!: boolean;
  roundDmg!: { a: number; b: number };
  totalDmg!: { a: number; b: number };
  scores!: { a: number; b: number }[];
  atk!: FighterActor;
  def!: FighterActor;
  move!: Move;
  approachT!: number;
  activeStrikes: ActiveStrike[];
  tasks: { t: number; fn: () => void }[];
  wait: number;
  strafe: { a: number; b: number; t: number };
  counterer: FighterActor | null = null;
  victim: FighterActor | null = null;
  counterAt = 0;
  counterDur = 0;
  counterT = 0;
  counterFired = false;

  constructor(a: FighterActor, b: FighterActor, cb: EngineCallbacks) {
    this.a = a;
    this.b = b;
    this.cb = cb;
    this.state = 'idle';
    this.phase = 'cooldown';
    this.tasks = [];
    this.wait = 0;
    this.strafe = { a: 1, b: -1, t: 3 };
    this.roundSeconds = ROUND_SECONDS;
    this.activeStrikes = [];
    // player-control mode (solo only — NEVER set in multiplayer). Every hook
    // below is gated on this.ctl so the auto path consumes the rng stream
    // byte-identically to a build without controls.
    this.ctl = null;
    this.ctlGuard = false;
  }

  // ---- player-control API ----
  setControlled(f: FighterActor) {
    this.ctl = f;
  }

  playerGuard(held: boolean) {
    if (!this.ctl) return;
    this.ctlGuard = held;
    if (this.state === 'fighting' && this.ctl.state === 'idle') this.ctl.defend(held);
  }

  // trigger your own exchange — mirrors _beginExchange minus the rng picks
  playerStrike(move: Move) {
    if (!this.ctl || this.state !== 'fighting' || this.phase !== 'cooldown' || this.roundEnding) return false;
    if (!move) return false;
    this.atk = this.ctl;
    this.def = this.ctl === this.a ? this.b : this.a;
    this.move = move;
    this.phase = 'approach';
    this.approachT = 0;
    this.def.defend(true);
    return true;
  }

  // timed reactive dodge: converts incoming pre-rolled hits landing within the
  // next 0.45s into misses, and punishes with the existing counter machinery
  playerDodge() {
    if (!this.ctl || this.state !== 'fighting') return false;
    let dodged = false;
    for (const s of this.activeStrikes) {
      if (s.done || s.def !== this.ctl) continue;
      let hitAny = false;
      for (const p of s.plan) {
        if (p.fired || p.out.kind !== 'hit') continue;
        const eta = p.imp.at * s.dur - s.t;
        if (eta >= 0 && eta <= 0.45) {
          p.out = { kind: 'miss', dmg: 0, crit: false };
          hitAny = true;
        }
      }
      if (hitAny && s.counterAt === null) s.counterAt = s.t + 0.15;
      dodged = dodged || hitAny;
    }
    this.ctl.evade(dodged ? 0.8 : 0.5);
    return dodged;
  }

  start() {
    this.tasks = [];
    // strafe must re-seed exactly like the constructor: it is the ONE piece of
    // sim state a rematch would otherwise carry over, and _drift consumes rng
    // when strafe.t expires — a mid-fight rematch (reachable now that skip/4x
    // let clients' clocks diverge) would fork the seeded stream between peers
    this.strafe = { a: 1, b: -1, t: 3 };
    this.a.reset();
    this.b.reset();
    this.a.faceToward(this.b.pos, 0, true);
    this.b.faceToward(this.a.pos, 0, true);
    this.state = 'fighting';
    this.phase = 'cooldown';
    this.wait = 1.4;
    this.round = 1;
    this.roundClock = this.roundSeconds;
    this.roundDmg = { a: 0, b: 0 };
    this.totalDmg = { a: 0, b: 0 };
    this.scores = [];
    this.roundEnding = false;
    this.activeStrikes = [];
    this.cb.onHP();
    this.cb.onRound(1, this.roundSeconds);
    this.cb.onRoundCard('ROUND 1');
    this.cb.onLine(`🔔 Round 1 — ${this.a.cfg.short} vs ${this.b.cfg.short}!`);
  }

  after(sec: number, fn: () => void) {
    this.tasks.push({ t: sec, fn });
  }

  update(dt: number) {
    for (const task of [...this.tasks]) {
      task.t -= dt;
      if (task.t <= 0) {
        this.tasks.splice(this.tasks.indexOf(task), 1);
        task.fn();
      }
    }
    if (this.state !== 'fighting') return;

    // round clock
    this.roundClock -= dt;
    this.cb.onRound(this.round, Math.max(0, this.roundClock));
    if (this.roundClock <= 0) this.roundEnding = true;
    if (this.roundEnding && this.phase === 'cooldown') {
      this._endRound();
      return;
    }
    if (this.roundClock < -5) {
      // failsafe: an exchange refused to finish — force the round to end
      this.activeStrikes.forEach(s => (s.done = true));
      this._endExchange();
      this._endRound();
      return;
    }

    // both fighters always square up (the KO'd/victory states never reach here)
    this.a.faceToward(this.b.pos, dt);
    this.b.faceToward(this.a.pos, dt);

    if (this.phase === 'cooldown') {
      this._drift(dt);
      this.wait -= dt;
      if (this.wait <= 0) this._beginExchange();
    } else if (this.phase === 'approach') {
      this._approach(dt);
    } else if (this.phase === 'strike') {
      this._strike(dt);
    } else if (this.phase === 'counter') {
      this._counter(dt);
    }
    this._separate();
  }

  // hard body-collision floor: strike tracking and knockback may not push the
  // fighters inside each other (reaches are ≥1.2, so hits still land)
  _separate() {
    const MIN_D = 0.88;
    const d = this.a.distanceTo(this.b);
    if (d > 1e-4 && d < MIN_D) {
      const push = (MIN_D - d) / 2;
      const dx = (this.b.pos.x - this.a.pos.x) / d;
      const dz = (this.b.pos.z - this.a.pos.z) / d;
      this.a.pos.x -= dx * push; this.a.pos.z -= dz * push;
      this.b.pos.x += dx * push; this.b.pos.z += dz * push;
    }
  }

  _endExchange(waitMin = 0.5, waitMax = 1.2) {
    this.phase = 'cooldown';
    this.wait = rand(waitMin, waitMax);
    if (this.ctl) this.wait += 0.7; // controlled fights: the AI gives you room to work
    this.activeStrikes = [];
    this.a.defend(false);
    this.b.defend(false);
    if (this.ctl && this.ctlGuard) this.ctl.defend(true); // player's held guard survives
  }

  _drift(dt: number) {
    // lazy circling so the fighters never stand still
    this.strafe.t -= dt;
    if (this.strafe.t <= 0) {
      this.strafe.t = rand(1.5, 3.5);
      if (rng() < 0.5) this.strafe.a *= -1;
      if (rng() < 0.5) this.strafe.b *= -1;
    }
    const drifting: [FighterActor, number][] = [[this.a, this.strafe.a], [this.b, this.strafe.b]];
    for (const [f, dir] of drifting) {
      const tx = -(f.pos.z) * dir, tz = f.pos.x * dir;
      // sqrt not hypot: hypot is implementation-approximated and may differ
      // by an ulp across JS engines — positions feed range/reach decisions,
      // and seeded multiplayer replays must stay bit-identical cross-device
      const len = Math.sqrt(tx * tx + tz * tz) || 1;
      f.pos.x += (tx / len) * 0.22 * dt;
      f.pos.z += (tz / len) * 0.22 * dt;
    }
    // spacing spring
    const d = this.a.distanceTo(this.b);
    if (d < 1.05) {
      const push = (1.05 - d) * dt * 2;
      const dx = (this.b.pos.x - this.a.pos.x) / d, dz = (this.b.pos.z - this.a.pos.z) / d;
      this.a.pos.x -= dx * push; this.a.pos.z -= dz * push;
      this.b.pos.x += dx * push; this.b.pos.z += dz * push;
    }
  }

  _beginExchange() {
    if (this.ctl) {
      // the player initiates their own exchanges via playerStrike; the auto
      // scheduler only ever drives the AI side
      this.atk = this.ctl === this.a ? this.b : this.a;
      this.def = this.ctl;
      this.move = pickMove(this.atk.stats);
      this.phase = 'approach';
      this.approachT = 0;
      return; // the player manages their own guard
    }
    const pA = pickAttackerProb(this.a.stats, this.b.stats);
    this.atk = rng() < pA ? this.a : this.b;
    this.def = this.atk === this.a ? this.b : this.a;
    this.move = pickMove(this.atk.stats);
    this.phase = 'approach';
    this.approachT = 0;
    this.def.defend(true); // defender sees it coming: guard up
  }

  _approach(dt: number) {
    this.approachT += dt;
    const d = this.atk.distanceTo(this.def);
    if (d <= this.move.range) {
      this._beginStrike();
      return;
    }
    const speed = d > 2.3 ? 2.4 : 1.15;
    this.atk.play(speed > 2 ? 'run' : 'walk');
    this.atk.moveToward(this.def.pos, speed, dt);
    if (this.approachT > 3) {
      this.atk.play('idle');
      this.cb.onLine(`${this.def.cfg.short} circles away.`);
      this._endExchange(0.3, 0.8);
    }
  }

  // Launch one strike. With defense enabled the defender pre-plans visible
  // reactions: a head-slip/lean for the first dodged impact, a guard snap
  // right before each blocked impact, and possibly a counter.
  _launchStrike(atk: FighterActor, def: FighterActor, move: Move, { bonus = 0, defense = true } = {}) {
    const dur = atk.clipDuration(move.key);
    // a held player guard blunts incoming shots (more blocks/misses)
    const guardAdj = this.ctl && def === this.ctl && this.ctlGuard ? -0.18 : 0;
    const strike: ActiveStrike = {
      atk, def, move, dur,
      t: 0,
      done: false,
      counterAt: null,
      plan: move.impacts.map(imp => ({
        imp,
        out: resolveImpactMath(move, imp, atk.stats, def.stats, bonus + guardAdj),
        fired: false,
      })),
    };

    if (defense) {
      const firstMiss = strike.plan.find(p => p.out.kind === 'miss');
      if (firstMiss) {
        const missT = firstMiss.imp.at * dur;
        // Pick the reaction that can PEAK exactly when the strike whiffs:
        // the head-slip clip needs DODGE_PEAK of lead time, so early impacts
        // fall back to the procedural lean-back (peaks 0.4s after trigger).
        const useClip = missT >= DODGE_PEAK && rng() < 0.5;
        this.after(Math.max(0, missT - (useClip ? DODGE_PEAK : 0.4)), () => {
          if (this.phase !== 'strike' || this.state !== 'fighting' || def.state === 'ko') return;
          if (def.currentKey && !['idle', 'walk', 'run'].includes(def.currentKey)) return;
          if (useClip) {
            def.play('dodge', {
              once: true, fade: 0.2, timeScale: DODGE_SPEED,
              onDone: () => {
                if (this.state === 'fighting' && def.state === 'idle') def.play('idle', { fade: 0.35 });
              },
            });
          } else {
            def.evade(0.8); // whole-body lean-back, sine peak at impact
          }
        });
        // the dodger may fire back — counter specialists thrive here.
        // A CONTROLLED defender earns counters only through manual dodges.
        if (def !== this.ctl && rng() < (def.cfg.counterSkill || 0)) {
          strike.counterAt = missT + 0.12;
        }
      }
      // live blocking: the guard pulse envelope peaks 0.18s in, so schedule
      // 0.18s early — the tighten lands exactly as each blocked shot arrives
      for (const p of strike.plan) {
        if (p.out.kind === 'block') {
          this.after(Math.max(0, p.imp.at * dur - 0.18), () => {
            if (this.phase === 'strike' && this.state === 'fighting' && def.state !== 'ko') def.guardPulse();
          });
        }
      }
    }

    atk.play(move.key, {
      once: true,
      fade: 0.25,
      onDone: () => {
        strike.done = true;
        if (this.state !== 'fighting' || this.phase !== 'strike') return;
        if (atk.state === 'idle') atk.play('idle');
        if (this.activeStrikes.every(s => s.done)) this._endExchange();
      },
    });
    this.activeStrikes.push(strike);
    return strike;
  }

  _beginStrike() {
    this.phase = 'strike';
    this.activeStrikes = [];
    const { atk, def } = this;
    // the defender may abandon defense and let one fly at the same time —
    // except a CONTROLLED defender, who trades only by choosing to swing
    const trade = def !== this.ctl && def.state === 'idle' && rng() < tradeProb(def.stats);
    if (trade) {
      def.defend(false);
      this._launchStrike(atk, def, this.move, { bonus: 0.15, defense: false });
      this._launchStrike(def, atk, pickMove(def.stats), { bonus: 0.15, defense: false });
      this.cb.onLine(`⚔️ ${atk.cfg.short} and ${def.cfg.short} throw at the same time!`);
    } else {
      this._launchStrike(atk, def, this.move);
    }
  }

  _strike(dt: number) {
    let counterStrike = null;
    for (const s of this.activeStrikes) {
      if (s.done) continue;
      s.t += dt;
      // track the target so strikes stay in contact range — but never chase
      // closer than the body-collision floor allows
      if (s.t < s.dur * 0.75) {
        const d = s.atk.distanceTo(s.def);
        if (d > Math.max(s.move.range * 0.8, 0.95)) s.atk.moveToward(s.def.pos, 1.0, dt);
      }
      for (const p of s.plan) {
        if (!p.fired && s.t >= p.imp.at * s.dur) {
          p.fired = true;
          this._applyOutcome(s.move, p.imp, p.out, s.atk, s.def);
          if (this.state !== 'fighting') return;
        }
      }
      if (s.counterAt !== null && s.t >= s.counterAt) {
        s.counterAt = null;
        counterStrike = s;
      }
      // watchdog: never trust the animation-finished callback alone
      if (s.t > s.dur + 0.6) {
        s.done = true;
        if (s.atk.state === 'idle') s.atk.play('idle');
      }
    }

    if (counterStrike) {
      // dodged strike gets punished: cancel everything, interrupt into the counter
      this.activeStrikes.forEach(s => {
        s.plan.forEach(p => (p.fired = true));
        s.done = true;
      });
      this._beginCounter(counterStrike.def, counterStrike.atk);
      return;
    }
    if (this.activeStrikes.every(s => s.done)) this._endExchange();
  }

  _beginCounter(counterer: FighterActor, victim: FighterActor) {
    this.phase = 'counter';
    this.counterer = counterer;
    this.victim = victim;
    this.counterT = 0;
    const variants = COUNTER_CLIPS.filter(v => counterer.actions[v.key]);
    const v = variants.length ? variants[Math.floor(rng() * variants.length)] : COUNTER_CLIPS[0];
    this.counterAt = v.at;
    this.counterDur = counterer.clipDuration(v.key);
    this.counterFired = false;
    this.cb.onLine(`⚡ ${counterer.cfg.short} slips it and fires back!`);
    victim.play('idle', { fade: 0.3 });
    counterer.play(v.key, {
      once: true,
      fade: 0.3,
      onDone: () => {
        if (this.state !== 'fighting' || this.phase !== 'counter') return;
        if (this.counterer?.state === 'idle') this.counterer.play('idle');
        this._endExchange();
      },
    });
  }

  _counter(dt: number) {
    const counterer = this.counterer, victim = this.victim;
    if (!counterer || !victim) return;   // only reachable via _beginCounter, which sets both
    this.counterT += dt;
    const d = counterer.distanceTo(victim);
    if (d > COUNTER_MOVE.range * 0.8) counterer.moveToward(victim.pos, 1.0, dt);

    if (!this.counterFired && this.counterT >= this.counterAt * this.counterDur) {
      this.counterFired = true;
      // roles swap: the original attacker is recovering, so the counter hits often
      const out = resolveImpactMath(COUNTER_MOVE, COUNTER_MOVE.impacts[0], counterer.stats, victim.stats, counterBonus(victim.stats));
      this._applyOutcome(COUNTER_MOVE, COUNTER_MOVE.impacts[0], out, counterer, victim);
    }
    if (this.counterT > this.counterDur + 0.6) {
      counterer.play('idle');
      this._endExchange();
    }
  }

  _applyOutcome(move: Move | CounterMove, _impact: Impact, out: Outcome, atk: FighterActor, def: FighterActor) {
    if (this.state !== 'fighting') return;
    // air gate: whatever was rolled, a strike from out of reach touches nothing
    if (atk.distanceTo(def) > move.reach) {
      if (out.kind === 'hit') this.cb.onLine(`${atk.cfg.short}'s ${move.label} finds nothing but air!`);
      this.cb.onDodge?.();
      return;
    }
    const dmgKey = atk === this.a ? 'a' : 'b';
    if (out.kind === 'hit') {
      def.hp = Math.max(0, def.hp - out.dmg);
      this.roundDmg[dmgKey] += out.dmg;
      const heavy = move.heavy || out.dmg >= 14;
      def.flash();
      def.knockback(atk.pos, out.crit ? 1.1 : heavy ? 0.8 : 0.45);
      this.cb.onImpact(heavy, out.crit, /kick|roundhouse|knee/.test(move.key) ? 'kick' : 'punch');
      if (out.crit) this.cb.onCrit?.(atk);
      this.cb.onDamage(def, out.dmg, out.crit, atk, move.key); // atk+move feed the broadcast stat counters
      this.cb.onHP();
      this.cb.onLine(move === COUNTER_MOVE
        ? `🔥 ${atk.cfg.short} MAKES HIM PAY! Counter lands! −${out.dmg}`
        : hitLine(move, atk, def, out.dmg, out.crit));
      if (def.hp <= 0) {
        this._ko(atk, def, 'ko');
        return;
      }
      // the equalizer: any clean shot can switch the lights off
      if (rng() < flashKOProb(move, out, def.stats, atk.cfg.powerKO)) {
        def.hp = 0;
        this.cb.onHP();
        this.cb.onImpact(true, true, /kick|roundhouse|knee/.test(move.key) ? 'kick' : 'punch');
        this._ko(atk, def, 'flash');
      }
    } else if (out.kind === 'block') {
      def.hp = Math.max(0, def.hp - out.dmg);
      this.roundDmg[dmgKey] += out.dmg;
      def.knockback(atk.pos, 0.25);
      this.cb.onBlock?.(!!move.heavy);
      this.cb.onHP();
      this.cb.onLine(pick([
        `🛡️ ${def.cfg.short} blocks the ${move.label}!`,
        `🛡️ ${def.cfg.short} catches it on the guard.`,
      ]));
      if (def.hp <= 0) this._ko(atk, def, 'ko');
    } else {
      this.cb.onDodge?.();
      this.cb.onLine(pick([
        `${def.cfg.short} slips the ${move.label}!`,
        `${atk.cfg.short} swings and misses!`,
      ]));
    }
  }

  _ko(winner: FighterActor, loser: FighterActor, method: string) {
    this.state = 'ko';
    this.activeStrikes.forEach(s => (s.done = true));
    loser.ko();
    winner.defend(false);
    this.cb.onLine(method === 'flash'
      ? `😵 ONE SHOT — ${loser.cfg.short} IS OUT COLD!`
      : `😵 ${loser.cfg.short} IS DOWN! IT'S ALL OVER!`);
    // let the fall play out: victory starts as the loser crumples, the banner
    // waits until he's flat on the canvas
    const fall = loser.clipDuration('knock_down');
    this.after(0.9, () => winner.play('idle'));
    this.after(fall ? 1.7 : 1.4, () => winner.victory());
    this.after(fall ? Math.min(Math.max(fall - 0.4, 2.0), 2.9) : 2.0,
      () => this.cb.onKO(winner, loser, { method, round: this.round }));
  }

  _endRound() {
    const rd = this.roundDmg;
    let cardA, cardB;
    if (Math.abs(rd.a - rd.b) < 2) [cardA, cardB] = [10, 10];
    else [cardA, cardB] = rd.a > rd.b ? [10, 9] : [9, 10];
    this.scores.push({ a: cardA, b: cardB });
    this.totalDmg.a += rd.a;
    this.totalDmg.b += rd.b;
    this.cb.onBell();

    if (this.round >= ROUNDS) {
      this._decision();
      return;
    }

    this.state = 'break';
    this.a.play('idle');
    this.b.play('idle');
    this.a.defend(false);
    this.b.defend(false);
    const rNum = this.round;
    this.cb.onLine(`🔔 End of round ${rNum} — judges have it ${cardA}–${cardB}.`);
    this.after(1.2, () => {
      this.a.hp = Math.min(100, this.a.hp + ROUND_RECOVERY);
      this.b.hp = Math.min(100, this.b.hp + ROUND_RECOVERY);
      this.cb.onHP();
    });
    this.after(2.4, () => this.cb.onRoundCard(`ROUND ${rNum + 1}`));
    this.after(3.4, () => {
      this.round++;
      this.roundClock = this.roundSeconds;
      this.roundDmg = { a: 0, b: 0 };
      this.roundEnding = false;
      this.state = 'fighting';
      this.phase = 'cooldown';
      this.wait = 0.9;
      this.cb.onBell();
      this.cb.onRound(this.round, this.roundSeconds);
      this.cb.onLine(`🔔 Round ${this.round} — here we go!`);
    });
  }

  _decision() {
    this.state = 'over';
    const pa = this.scores.reduce((s, r) => s + r.a, 0);
    const pb = this.scores.reduce((s, r) => s + r.b, 0);
    const cards = `${pa}–${pb}`;
    let winner = null;
    if (pa > pb) winner = this.a;
    else if (pb > pa) winner = this.b;
    else if (Math.abs(this.totalDmg.a - this.totalDmg.b) > 3) {
      winner = this.totalDmg.a > this.totalDmg.b ? this.a : this.b;
    }
    const loser = winner === null ? null : winner === this.a ? this.b : this.a;
    this.cb.onLine(`📋 We go to the judges' scorecards…`);
    if (winner) {
      this.after(1.2, () => winner.victory());
      this.after(2.0, () => this.cb.onDecision(winner, loser, cards));
    } else {
      this.after(2.0, () => this.cb.onDecision(null, null, cards));
    }
  }
}
