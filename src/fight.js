const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export const ROUNDS = 3;
export const ROUND_SECONDS = 20;
const ROUND_RECOVERY = 12; // corner work between rounds
const DMG_SCALE = 0.5; // Monte-Carlo tuned: ~half the fights reach the judges

// Each move maps to a real animation clip; impacts fire at normalized clip
// times. `range` = distance the attacker closes to before striking;
// `reach` = max distance at which an impact can actually land (air gate).
export const MOVES = [
  {
    key: 'punch_combo', label: 'punch combo', range: 1.05, reach: 1.3, heavy: false,
    impacts: [
      { at: 0.22, min: 5, max: 10 },
      { at: 0.45, min: 5, max: 10 },
      { at: 0.72, min: 6, max: 11 },
    ],
    w: f => 55 + f.stats.striking * 0.5,
  },
  {
    key: 'roundhouse', label: 'roundhouse kick', range: 1.3, reach: 1.55, heavy: true,
    impacts: [{ at: 0.5, min: 13, max: 21 }],
    w: f => 18 + f.stats.striking * 0.3,
  },
  {
    key: 'flying_kick', label: 'flying kick', range: 1.45, reach: 1.75, heavy: true,
    impacts: [{ at: 0.55, min: 16, max: 25 }],
    w: f => 8 + Math.max(0, f.stats.speed - 84) * 3,
  },
  {
    key: 'hook', label: 'left hook', range: 1.05, reach: 1.3, heavy: false,
    impacts: [{ at: 0.5, min: 8, max: 14 }],
    w: f => 25 + f.stats.striking * 0.3,
  },
  {
    key: 'uppercut', label: 'uppercut', range: 1.0, reach: 1.25, heavy: false,
    impacts: [{ at: 0.5, min: 10, max: 16 }],
    w: f => 15 + f.stats.striking * 0.25,
  },
  {
    key: 'punch_combo_2', label: 'blitz combo', range: 1.05, reach: 1.3, heavy: false,
    impacts: [
      { at: 0.23, min: 3, max: 6 },
      { at: 0.44, min: 3, max: 6 },
      { at: 0.6, min: 3, max: 7 },
      { at: 0.7, min: 4, max: 8 },
    ],
    w: f => 18 + Math.max(0, f.stats.speed - 84) * 1.5,
  },
  {
    key: 'punch_combo_4', label: 'body combo', range: 1.05, reach: 1.3, heavy: false,
    impacts: [
      { at: 0.22, min: 4, max: 7 },
      { at: 0.4, min: 3, max: 6 },
      { at: 0.59, min: 4, max: 7 },
      { at: 0.78, min: 4, max: 8 },
    ],
    w: f => 14 + f.stats.striking * 0.22,
  },
  // ---- second animation batch; impact `at` values sit on the clip's
  // rotational-energy peaks so strikes, dodges and blocks line up visually
  {
    key: 'double_kick', label: 'double kick', range: 1.35, reach: 1.6, heavy: true,
    impacts: [
      { at: 0.3, min: 7, max: 12 },
      { at: 0.46, min: 7, max: 12 },
    ],
    w: f => 6 + Math.max(0, f.stats.speed - 84) * 1.6,
  },
  {
    key: 'jumping_punch', label: 'jumping punch', range: 1.15, reach: 1.4, heavy: false,
    impacts: [{ at: 0.46, min: 9, max: 15 }],
    w: f => 9 + Math.max(0, f.stats.speed - 86) * 1.6,
  },
  {
    key: 'lunge_spin_kick', label: 'spinning kick', range: 1.35, reach: 1.6, heavy: true,
    impacts: [{ at: 0.63, min: 12, max: 19 }],
    w: f => 6 + f.stats.striking * 0.09,
  },
  {
    key: 'backflip_kick', label: 'backflip sweep kick', range: 1.4, reach: 1.65, heavy: true,
    impacts: [{ at: 0.74, min: 15, max: 23 }],
    w: f => 3 + Math.max(0, f.stats.speed - 86) * 1.2,
  },
  {
    key: 'knee_strike', label: 'step knee', range: 1.0, reach: 1.25, heavy: false,
    impacts: [{ at: 0.33, min: 9, max: 15 }],
    w: f => 6 + f.stats.grappling * 0.1,
  },
  {
    key: 'elbow_strike', label: 'elbow strike', range: 1.0, reach: 1.25, heavy: false,
    impacts: [{ at: 0.48, min: 9, max: 16 }],
    w: f => 6 + f.stats.striking * 0.1,
  },
  {
    key: 'lunge_roundhouse', label: 'lunging roundhouse', range: 1.4, reach: 1.65, heavy: true,
    impacts: [{ at: 0.66, min: 13, max: 21 }],
    w: f => 5 + f.stats.striking * 0.08,
  },
  {
    key: 'spartan_kick', label: 'spartan kick', range: 1.25, reach: 1.5, heavy: true,
    impacts: [{ at: 0.51, min: 12, max: 20 }],
    w: f => 5 + f.stats.striking * 0.08,
  },
  {
    key: 'sweeping_kick', label: 'sweeping kick', range: 1.3, reach: 1.55, heavy: true,
    impacts: [{ at: 0.53, min: 11, max: 17 }],
    w: f => 5 + Math.max(0, f.stats.speed - 84) * 1.2,
  },
  {
    key: 'kung_fu_punch', label: 'kung-fu flurry', range: 1.05, reach: 1.3, heavy: false,
    impacts: [
      { at: 0.16, min: 4, max: 7 },
      { at: 0.36, min: 4, max: 7 },
      { at: 0.58, min: 4, max: 8 },
      { at: 0.74, min: 5, max: 8 },
    ],
    w: f => 8 + f.stats.striking * 0.1,
  },
  {
    key: 'high_kick', label: 'step high kick', range: 1.3, reach: 1.55, heavy: true,
    impacts: [{ at: 0.66, min: 13, max: 20 }],
    w: f => 5 + f.stats.striking * 0.08,
  },
];

// Dodge clip timing: per-bone angular-velocity analysis puts the head
// furthest off-line ~1.25s into the dodge subclip; played at DODGE_SPEED the
// peak arrives DODGE_PEAK seconds after the clip starts.
const DODGE_SPEED = 1.4;
const DODGE_PEAK = 1.25 / DODGE_SPEED;

// Reactive move only: triggered when a strike is dodged, never picked as an attack.
export const COUNTER_MOVE = {
  key: 'counter', label: 'counter', range: 1.2, reach: 1.5, heavy: false,
  impacts: [{ at: 0.58, min: 9, max: 14 }],
};

// Two counter animations chosen at random: the dodge_counter flurry subclip
// and the dedicated Counterstrike clip. Damage math stays COUNTER_MOVE's —
// only the visuals and the impact moment (energy-peak fraction) differ.
const COUNTER_CLIPS = [
  { key: 'counter', at: 0.58 },
  { key: 'counterstrike', at: 0.67 },
];

// countering a strong grappler is risky — their frame resists the shot
export function counterBonus(victimStats) {
  return 0.18 - Math.max(0, victimStats.grappling - 88) * 0.012;
}

// ---- pure resolution math (shared by the live engine and the simulator) ----
export function pickAttackerProb(a, b) {
  return 0.5 + (a.speed - b.speed) * 0.006 + (a.cardio - b.cardio) * 0.0085;
}

export function pickMove(stats) {
  const ws = MOVES.map(m => m.w({ stats }));
  let r = Math.random() * ws.reduce((s, w) => s + w, 0);
  for (let i = 0; i < MOVES.length; i++) {
    r -= ws[i];
    if (r <= 0) return MOVES[i];
  }
  return MOVES[0];
}

// chance the defender abandons defense and swings at the same time
export function tradeProb(defStats) {
  return Math.min(0.35, 0.16 + (defStats.speed - 86) * 0.008 + (defStats.striking - 88) * 0.004);
}

// small chance any clean hit ends it on the spot — better chins resist it.
// `power` is the attacker's cfg.powerKO (one-punch-power fighters like Cotne
// carry >1); everyone else defaults to 1.
export function flashKOProb(move, out, defStats, power = 1) {
  const base = (out.crit ? 0.03 : 0.008) * (move.heavy ? 1.5 : 1) * power;
  return Math.max(0.002, base * (105 - defStats.chin) / 15);
}

export function resolveImpactMath(move, impact, atkStats, defStats, bonus = 0) {
  const p = Math.min(0.9, Math.max(0.3,
    0.58 + bonus + (atkStats.striking - 88) * 0.008 - (defStats.speed - 88) * 0.005));
  const r = Math.random();
  if (r < p) {
    let dmg = rand(impact.min, impact.max);
    const crit = Math.random() < 0.12;
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
export function simFight(cfgA, cfgB) {
  const mk = c => ({ hp: 100, stats: c.stats, counterSkill: c.counterSkill, powerKO: c.powerKO || 1 });
  const a = mk(cfgA), b = mk(cfgB);
  const totals = { a: 0, b: 0 };
  let pa = 0, pb = 0;
  const koWin = f => (f === a ? 'a' : 'b');
  for (let round = 1; round <= ROUNDS; round++) {
    const rd = { a: 0, b: 0 };
    let tLeft = ROUND_SECONDS;
    while (tLeft > 0) {
      tLeft -= 2 + Math.random() * 1.5;
      const aAtt = Math.random() < pickAttackerProb(a.stats, b.stats);
      const atk = aAtt ? a : b, def = aAtt ? b : a;
      const akey = aAtt ? 'a' : 'b', dkey = aAtt ? 'b' : 'a';
      const trade = Math.random() < tradeProb(def.stats);
      const move = pickMove(atk.stats);
      let missRolled = false;
      for (const imp of move.impacts) {
        const r = resolveImpactMath(move, imp, atk.stats, def.stats, trade ? 0.15 : 0);
        def.hp -= r.dmg;
        rd[akey] += r.dmg;
        totals[akey] += r.dmg;
        if (def.hp > 0 && r.kind === 'hit' && Math.random() < flashKOProb(move, r, def.stats, atk.powerKO)) def.hp = 0;
        if (def.hp <= 0) return koWin(atk);
        // mirror the live engine: only the FIRST miss of an exchange can counter, never in a trade
        if (!trade && r.kind === 'miss' && !missRolled && (missRolled = true) && Math.random() < (def.counterSkill || 0)) {
          const c = resolveImpactMath(COUNTER_MOVE, COUNTER_MOVE.impacts[0], def.stats, atk.stats, counterBonus(atk.stats));
          atk.hp -= c.dmg;
          rd[dkey] += c.dmg;
          totals[dkey] += c.dmg;
          if (atk.hp > 0 && c.kind === 'hit' && Math.random() < flashKOProb(COUNTER_MOVE, c, atk.stats, def.powerKO)) atk.hp = 0;
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
          if (atk.hp > 0 && r.kind === 'hit' && Math.random() < flashKOProb(move2, r, atk.stats, def.powerKO)) atk.hp = 0;
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

function hitLine(move, atk, def, dmg, crit) {
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
  constructor(a, b, cb) {
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
  }

  start() {
    this.tasks = [];
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

  after(sec, fn) {
    this.tasks.push({ t: sec, fn });
  }

  update(dt) {
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
    this.activeStrikes = [];
    this.a.defend(false);
    this.b.defend(false);
  }

  _drift(dt) {
    // lazy circling so the fighters never stand still
    this.strafe.t -= dt;
    if (this.strafe.t <= 0) {
      this.strafe.t = rand(1.5, 3.5);
      if (Math.random() < 0.5) this.strafe.a *= -1;
      if (Math.random() < 0.5) this.strafe.b *= -1;
    }
    for (const [f, dir] of [[this.a, this.strafe.a], [this.b, this.strafe.b]]) {
      const tx = -(f.pos.z) * dir, tz = f.pos.x * dir;
      const len = Math.hypot(tx, tz) || 1;
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
    const pA = pickAttackerProb(this.a.stats, this.b.stats);
    this.atk = Math.random() < pA ? this.a : this.b;
    this.def = this.atk === this.a ? this.b : this.a;
    this.move = pickMove(this.atk.stats);
    this.phase = 'approach';
    this.approachT = 0;
    this.def.defend(true); // defender sees it coming: guard up
  }

  _approach(dt) {
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
  _launchStrike(atk, def, move, { bonus = 0, defense = true } = {}) {
    const dur = atk.clipDuration(move.key);
    const strike = {
      atk, def, move, dur,
      t: 0,
      done: false,
      counterAt: null,
      plan: move.impacts.map(imp => ({
        imp,
        out: resolveImpactMath(move, imp, atk.stats, def.stats, bonus),
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
        const useClip = missT >= DODGE_PEAK && Math.random() < 0.5;
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
        // the dodger may fire back — counter specialists thrive here
        if (Math.random() < (def.cfg.counterSkill || 0)) {
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
    // the defender may abandon defense and let one fly at the same time
    const trade = def.state === 'idle' && Math.random() < tradeProb(def.stats);
    if (trade) {
      def.defend(false);
      this._launchStrike(atk, def, this.move, { bonus: 0.15, defense: false });
      this._launchStrike(def, atk, pickMove(def.stats), { bonus: 0.15, defense: false });
      this.cb.onLine(`⚔️ ${atk.cfg.short} and ${def.cfg.short} throw at the same time!`);
    } else {
      this._launchStrike(atk, def, this.move);
    }
  }

  _strike(dt) {
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

  _beginCounter(counterer, victim) {
    this.phase = 'counter';
    this.counterer = counterer;
    this.victim = victim;
    this.counterT = 0;
    const variants = COUNTER_CLIPS.filter(v => counterer.actions[v.key]);
    const v = variants.length ? variants[Math.floor(Math.random() * variants.length)] : COUNTER_CLIPS[0];
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
        if (this.counterer.state === 'idle') this.counterer.play('idle');
        this._endExchange();
      },
    });
  }

  _counter(dt) {
    this.counterT += dt;
    const d = this.counterer.distanceTo(this.victim);
    if (d > COUNTER_MOVE.range * 0.8) this.counterer.moveToward(this.victim.pos, 1.0, dt);

    if (!this.counterFired && this.counterT >= this.counterAt * this.counterDur) {
      this.counterFired = true;
      // roles swap: the original attacker is recovering, so the counter hits often
      const out = resolveImpactMath(COUNTER_MOVE, COUNTER_MOVE.impacts[0], this.counterer.stats, this.victim.stats, counterBonus(this.victim.stats));
      this._applyOutcome(COUNTER_MOVE, COUNTER_MOVE.impacts[0], out, this.counterer, this.victim);
    }
    if (this.counterT > this.counterDur + 0.6) {
      this.counterer.play('idle');
      this._endExchange();
    }
  }

  _applyOutcome(move, impact, out, atk, def) {
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
      this.cb.onDamage(def, out.dmg, out.crit);
      this.cb.onHP();
      this.cb.onLine(move === COUNTER_MOVE
        ? `🔥 ${atk.cfg.short} MAKES HIM PAY! Counter lands! −${out.dmg}`
        : hitLine(move, atk, def, out.dmg, out.crit));
      if (def.hp <= 0) {
        this._ko(atk, def, 'ko');
        return;
      }
      // the equalizer: any clean shot can switch the lights off
      if (Math.random() < flashKOProb(move, out, def.stats, atk.cfg.powerKO || 1)) {
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

  _ko(winner, loser, method) {
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
