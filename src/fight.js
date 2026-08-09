const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

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
];

// Reactive move only: triggered when a strike is dodged, never picked as an attack.
export const COUNTER_MOVE = {
  key: 'counter', label: 'counter', range: 1.2, reach: 1.5, heavy: false,
  impacts: [{ at: 0.58, min: 9, max: 14 }],
};

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

export function resolveImpactMath(move, impact, atkStats, defStats, bonus = 0) {
  const p = Math.min(0.9, Math.max(0.3,
    0.58 + bonus + (atkStats.striking - 88) * 0.008 - (defStats.speed - 88) * 0.005));
  const r = Math.random();
  if (r < p) {
    let dmg = rand(impact.min, impact.max);
    const crit = Math.random() < 0.12;
    if (crit) dmg *= 1.6;
    dmg *= (182 - defStats.chin) / 92;
    return { kind: 'hit', dmg: Math.max(1, Math.round(dmg)), crit };
  }
  if (r < p + 0.22) return { kind: 'block', dmg: Math.round(rand(1, 3)), crit: false };
  return { kind: 'miss', dmg: 0, crit: false };
}

// Headless Monte Carlo of the same decision math (no animation timing).
export function simFight(cfgA, cfgB) {
  const a = { hp: 100, ...cfgA }, b = { hp: 100, ...cfgB };
  for (let guard = 0; guard < 500; guard++) {
    const aAtt = Math.random() < pickAttackerProb(a.stats, b.stats);
    const atk = aAtt ? a : b;
    const def = aAtt ? b : a;
    const move = pickMove(atk.stats);
    let missRolled = false;
    for (const imp of move.impacts) {
      const r = resolveImpactMath(move, imp, atk.stats, def.stats);
      def.hp -= r.dmg;
      if (def.hp <= 0) return def === a ? 'b' : 'a';
      // mirror the live engine: only the FIRST miss of an exchange can trigger a counter
      if (r.kind === 'miss' && !missRolled && (missRolled = true) && Math.random() < (def.counterSkill || 0)) {
        const c = resolveImpactMath(COUNTER_MOVE, COUNTER_MOVE.impacts[0], def.stats, atk.stats, counterBonus(atk.stats));
        atk.hp -= c.dmg;
        if (atk.hp <= 0) return atk === a ? 'b' : 'a';
        break; // counter interrupts the rest of the combo
      }
    }
  }
  return a.hp >= b.hp ? 'a' : 'b';
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

// ---- live engine: cooldown → approach → strike (→ counter) → cooldown ----
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
  }

  start() {
    this.tasks = [];
    this.a.reset();
    this.b.reset();
    this.a.faceToward(this.b.pos, 0, true);
    this.b.faceToward(this.a.pos, 0, true);
    this.state = 'fighting';
    this.phase = 'cooldown';
    this.wait = 1.2;
    this.cb.onHP();
    this.cb.onLine('🔔 Here we go — Merab vs Ilia!');
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
  }

  _endExchange(waitMin = 0.5, waitMax = 1.2) {
    this.phase = 'cooldown';
    this.wait = rand(waitMin, waitMax);
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

  _beginStrike() {
    this.phase = 'strike';
    this.strikeT = 0;
    this.strikeDur = this.atk.clipDuration(this.move.key);
    // pre-roll every impact so the defense can animate in anticipation
    this.plan = this.move.impacts.map(imp => ({
      imp,
      out: resolveImpactMath(this.move, imp, this.atk.stats, this.def.stats),
      fired: false,
    }));
    this.counterAt = null;

    const firstMiss = this.plan.find(p => p.out.kind === 'miss');
    if (firstMiss) {
      const missT = firstMiss.imp.at * this.strikeDur;
      // start the head-slip just before the strike arrives
      this.after(Math.max(0, missT - 0.35), () => {
        if (this.phase === 'strike' && this.state === 'fighting' && this.def.state !== 'ko') {
          this.def.play('dodge', {
            once: true, fade: 0.28,
            onDone: () => {
              if (this.state === 'fighting' && this.def.state === 'idle') this.def.play('idle');
            },
          });
        }
      });
      // the dodger may fire back — this is Ilia's specialty (cfg.counterSkill)
      if (Math.random() < (this.def.cfg.counterSkill || 0)) {
        this.counterAt = missT + 0.12;
      }
    }

    this.atk.play(this.move.key, {
      once: true,
      fade: 0.25,
      onDone: () => {
        if (this.state !== 'fighting' || this.phase !== 'strike') return;
        this.atk.play('idle');
        this._endExchange();
      },
    });
  }

  _strike(dt) {
    this.strikeT += dt;
    // track the target so strikes stay in contact range
    const d = this.atk.distanceTo(this.def);
    if (d > this.move.range * 0.8) this.atk.moveToward(this.def.pos, 1.0, dt);

    for (const p of this.plan) {
      if (!p.fired && this.strikeT >= p.imp.at * this.strikeDur) {
        p.fired = true;
        this._applyOutcome(this.move, p.imp, p.out, this.atk, this.def);
        if (this.state !== 'fighting') return;
      }
    }

    // dodged strike gets punished: interrupt into the counter
    if (this.counterAt !== null && this.strikeT >= this.counterAt) {
      this.counterAt = null;
      this.plan.forEach(p => (p.fired = true));
      this._beginCounter();
      return;
    }

    // watchdog: never trust the animation-finished callback alone
    if (this.strikeT > this.strikeDur + 0.6) {
      this.atk.play('idle');
      this._endExchange();
    }
  }

  _beginCounter() {
    this.phase = 'counter';
    this.counterT = 0;
    this.counterDur = this.def.clipDuration('counter');
    this.counterFired = false;
    this.cb.onLine(`⚡ ${this.def.cfg.short} slips it and fires back!`);
    this.atk.play('idle', { fade: 0.3 });
    this.def.play('counter', {
      once: true,
      fade: 0.3,
      onDone: () => {
        if (this.state !== 'fighting' || this.phase !== 'counter') return;
        if (this.def.state === 'idle') this.def.play('idle');
        this._endExchange();
      },
    });
  }

  _counter(dt) {
    this.counterT += dt;
    const d = this.def.distanceTo(this.atk);
    if (d > COUNTER_MOVE.range * 0.8) this.def.moveToward(this.atk.pos, 1.0, dt);

    if (!this.counterFired && this.counterT >= COUNTER_MOVE.impacts[0].at * this.counterDur) {
      this.counterFired = true;
      // roles swap: the original attacker is recovering, so the counter hits often
      const out = resolveImpactMath(COUNTER_MOVE, COUNTER_MOVE.impacts[0], this.def.stats, this.atk.stats, counterBonus(this.atk.stats));
      this._applyOutcome(COUNTER_MOVE, COUNTER_MOVE.impacts[0], out, this.def, this.atk);
    }
    if (this.counterT > this.counterDur + 0.6) {
      this.def.play('idle');
      this._endExchange();
    }
  }

  _applyOutcome(move, impact, out, atk, def) {
    if (this.state !== 'fighting') return;
    // air gate: whatever was rolled, a strike from out of reach touches nothing
    if (atk.distanceTo(def) > move.reach) {
      if (out.kind === 'hit') this.cb.onLine(`${atk.cfg.short}'s ${move.label} finds nothing but air!`);
      return;
    }
    if (out.kind === 'hit') {
      def.hp = Math.max(0, def.hp - out.dmg);
      const heavy = move.heavy || out.dmg >= 16;
      def.flash();
      def.knockback(atk.pos, out.crit ? 1.1 : heavy ? 0.8 : 0.45);
      this.cb.onImpact(heavy, out.crit, move.key.includes('kick') ? 'kick' : 'punch');
      this.cb.onDamage(def, out.dmg, out.crit);
      this.cb.onHP();
      this.cb.onLine(move === COUNTER_MOVE
        ? `🔥 ${atk.cfg.short} MAKES HIM PAY! Counter lands! −${out.dmg}`
        : hitLine(move, atk, def, out.dmg, out.crit));
      if (def.hp <= 0) this._ko(atk, def);
    } else if (out.kind === 'block') {
      def.hp = Math.max(0, def.hp - out.dmg);
      def.knockback(atk.pos, 0.25);
      this.cb.onHP();
      this.cb.onLine(pick([
        `🛡️ ${def.cfg.short} blocks the ${move.label}!`,
        `🛡️ ${def.cfg.short} catches it on the guard.`,
      ]));
      if (def.hp <= 0) this._ko(atk, def);
    } else {
      this.cb.onLine(pick([
        `${def.cfg.short} slips the ${move.label}!`,
        `${atk.cfg.short} swings and misses!`,
      ]));
    }
  }

  _ko(winner, loser) {
    this.state = 'ko';
    loser.ko();
    winner.defend(false);
    this.cb.onLine(`😵 ${loser.cfg.short} IS DOWN! IT'S ALL OVER!`);
    this.after(0.9, () => winner.play('idle'));
    this.after(1.4, () => winner.victory());
    this.after(2.0, () => this.cb.onKO(winner, loser));
  }
}
