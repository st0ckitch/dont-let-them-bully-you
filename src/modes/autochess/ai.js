// The AI opponent.
//
// It plays the SAME game the player does: it owns a roster, gold, XP and a
// level, rolls its own 5-card shop out of the shared pool, buys, merges, levels
// and fields its best units. Nothing here is privileged — no free stats, no
// invented star levels, no knowledge of the player's board.
//
// The previous version generated a fresh random board every round with no
// persistent state at all, which is exactly what it looked like: a different
// cast each round, duplicate 1-stars standing next to each other instead of
// merging, star levels that appeared by dice roll, and occasionally a single
// lonely fighter. Every one of those is a symptom of having no roster.

import { UNIT_BY_ID, sellValue, statsFor } from './units.js?v=202608281148';
import { Roster, Economy, SHOP_SIZE, REROLL_COST, XP_COST, XP_PER_ROUND, boardCapacity } from './shop.js?v=202608281148';
import * as Hex from './hex.js?v=202608281148';

let rng = Math.random;
export function setAiRng(fn) { rng = fn || Math.random; }

// Comp plans. The AI commits to one at game start and biases its shopping
// toward it, which is what makes its board read as a STRATEGY — the same core
// starring up game after game — rather than a drawer of parts. Every plan
// treats the 4/5-costs as its late-game payoff once the shop can offer them.
// Carries deliberately differ per plan so consecutive games feel different.
const COMPS = [
  { name: 'Executive Suite', carry: 'david', core: ['cotne', 'dato', 'davit'] },
  { name: 'Long Reach', carry: 'levan', core: ['gigi', 'cotne', 'davit'] },
  { name: 'Prodigy Rush', carry: 'soso', core: ['davit', 'dato', 'cotne'] },
  { name: 'System Control', carry: 'gigi', core: ['dato', 'cotne', 'soso'] },
];
const LATE_PAYOFF = ['merab', 'ilia'];

// ---- tuning knobs ----
// Difficulty lives here and ONLY here. Never give the AI stat bonuses: that
// breaks the pool-and-star-up logic the player is busy learning, and makes a
// lost round unreadable ("why did that 2-star lose to a 2-star?").
export const AI_TUNING = {
  // Level tempo of a competent player: 6 by the start of stage 3, 8 by the
  // late-mid game. Board slots are the strongest stat in the game, and the old
  // curve conceded a full level of tempo through the mid game.
  levelTempo: r => (r <= 2 ? 3 : r <= 4 ? 4 : r <= 7 ? 5 : r <= 10 ? 6 : r <= 14 ? 7 : r <= 18 ? 8 : 9),
  // Gold held back for interest. Banking climbs toward the 30s mid-game like a
  // real player, but the reserve is IGNORED when stabilising (low HP) — an AI
  // that saves while dying ends the game rich and dead.
  reserve: (r, hp) => (hp <= 50 ? 0 : r <= 3 ? 0 : r <= 8 ? 10 : 20),
  // Shop rolls per round once flush. Low HP or a big bank triggers a committed
  // roll-down — the single biggest brain upgrade: gold on the table converts
  // into stars exactly when the game is on the line.
  maxRolls: (r, hp, gold) => {
    let n = r <= 3 ? 1 : r <= 8 ? 3 : 5;
    if (hp <= 50) n += 3;             // stabilise: dig for upgrades NOW
    if (r >= 9 && gold >= 40) n += 2; // rich: convert the bank into a board
    return n;
  },
  // spare gold above the reserve needed before it will pay to reroll
  rollThreshold: 6,
};

// How much the AI wants a given shop card. Ordered so that finishing an upgrade
// always beats starting a new one — this is what stops it fielding three
// separate 1-star copies of the same fighter.
function wantScore(ai, unitId) {
  const unit = UNIT_BY_ID[unitId];
  const mine = ai.roster.entries.filter(e => e.unitId === unitId);
  const ones = mine.filter(e => e.star === 1).length;
  const twos = mine.filter(e => e.star === 2).length;
  const threes = mine.filter(e => e.star === 3).length;
  const copies = ones + 3 * twos + 9 * threes;

  // Already maxed, or holding enough for a 3-star. Further copies upgrade
  // nothing and only drain the shared pool — left unguarded the AI kept buying
  // past its own 3-stars and took 86% of a champion out of the game.
  if (threes > 0 || copies >= 9) return -1;

  // A 3-star needs THREE 2-stars, i.e. nine copies — not two 2-stars plus one.
  // Scoring that seventh copy as "completes a 3-star" made the AI break its
  // gold reserve for a card that merged nothing.
  if (ones === 2 && twos === 2) return 1200 + unit.cost; // 2-star now, cascades to 3
  if (ones >= 2) return 900 + unit.cost;                 // completes a 2-star now
  if (twos >= 1) return 700 + unit.cost;                 // real progress toward a 3-star
  if (ones >= 1) return 600 + unit.cost;                 // second copy
  // A fighter it does not own yet: comp members come first, then the 4/5-cost
  // payoff once the shop can realistically offer them, then raw cost. This is
  // the bias that turns "a drawer of parts" into a recognisable strategy.
  const short = ai.roster.entries.length < boardCapacity(ai.econ.level);
  let s = (short ? 300 : 120) + unit.cost * 45;
  if (unitId === ai.plan.carry) s += 190;
  else if (ai.plan.core.includes(unitId)) s += 130;
  if (ai.econ.level >= 7 && LATE_PAYOFF.includes(unitId)) s += 220;
  return s;
}

// Fielding order: stars first, then cost. A human plays their best board, so
// two 1-star copies of a fighter never both make it on while a better unit sits
// on the bench.
const fieldRank = e => e.star * 1000 + UNIT_BY_ID[e.unitId].cost * 10;

export class AiOpponent {
  // `pool` is the SHARED pool — the AI's purchases really do remove copies the
  // player could otherwise have bought. That contest is the whole reason a
  // finite pool exists. It is safe here because the AI buys at most a handful
  // of cards a round and sells back everything it discards, and because it
  // concentrates on a few fighters rather than hoovering the board.
  constructor(pool) {
    this.pool = pool;
    this.roster = new Roster(pool);
    this.econ = new Economy();
    this.econ.level = 2;
    this.econ.gold = 3; // same opening stake the player gets — it was starting a gold down
    this.plan = COMPS[Math.floor(rng() * COMPS.length)];
    this.lastBoard = [];
  }

  // One planning phase of AI play, in the same order a person would do it.
  takeTurn(roundIndex) {
    const r = roundIndex;
    this.econ.grantXp(XP_PER_ROUND);
    // Late game a person trades scaffolding for payoff: benched 1-star 1-costs
    // that back nothing get sold to fund the merab/ilia rolls.
    if (this.econ.level >= 7) {
      for (const e of this.roster.bench.slice()) {
        const u = UNIT_BY_ID[e.unitId];
        if (e.star !== 1 || u.cost > 1) continue;
        const copies = this.roster.entries.filter(x => x.unitId === e.unitId).length;
        if (copies >= 2) continue;   // half of a pair — still scaffolding
        this.econ.gold += sellValue(u.cost, 1);
        this.roster.remove(e);
      }
    }
    this._levelUp(r);
    this._shopPhase(r);
    this._levelUp(r); // leftover gold after shopping can still buy tempo
    return this.buildBoard();
  }

  _levelUp(r) {
    const target = AI_TUNING.levelTempo(r);
    const reserve = AI_TUNING.reserve(r, this.econ.hp);
    while (this.econ.level < target && this.econ.gold - XP_COST >= reserve) {
      if (!this.econ.buyXp()) break;
    }
  }

  // Buy the opening shop out, then keep paying to reroll while it is genuinely
  // flush. Rolling AFTER a successful buy matters too — that is how a player
  // chains into the third copy of something they just paired.
  _shopPhase(r) {
    const reserve = AI_TUNING.reserve(r, this.econ.hp);
    let rolls = AI_TUNING.maxRolls(r, this.econ.hp, this.econ.gold);
    this._buyFrom(this.pool.roll(this.econ.level, SHOP_SIZE), r);
    while (rolls > 0 && this.econ.gold - REROLL_COST - reserve >= AI_TUNING.rollThreshold) {
      rolls--;
      this.econ.spend(REROLL_COST);
      this._buyFrom(this.pool.roll(this.econ.level, SHOP_SIZE), r);
    }
  }

  // Returns true if it bought at least one card this pass.
  _buyFrom(shop, r) {
    const reserve = AI_TUNING.reserve(r, this.econ.hp);
    const ranked = shop
      .map((id, i) => (id ? { id, i, score: wantScore(this, id) } : null))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    let bought = false;
    for (const c of ranked) {
      if (c.score < 0) continue; // maxed out or pool-capped
      const unit = UNIT_BY_ID[c.id];
      if (this.econ.gold < unit.cost) continue;
      // An upgrade is always worth breaking the reserve for; a speculative body
      // is not — UNLESS it is sitting on a pile. Once its own targets cap out
      // the AI has nothing high-scoring left to buy, and without this it banks
      // gold to the end of the game instead of converting it into board.
      const isUpgrade = c.score >= 900;
      const flush = this.econ.gold >= reserve + 20;
      if (!isUpgrade && !flush && this.econ.gold - unit.cost < reserve) continue;

      const completesMerge = this.roster.entries
        .filter(e => e.unitId === c.id && e.star === 1).length >= 2;
      if (this.roster.benchFull() && !completesMerge && !this._makeBenchRoom()) continue;
      if (!this.pool.take(c.id)) continue;

      this.econ.spend(unit.cost);
      this.roster.add(c.id);
      shop[c.i] = null;
      bought = true;
    }
    return bought;
  }

  // Sell the least useful thing it owns to free a bench slot: a lone 1-star of
  // the cheapest fighter that is not part of a pair it is chasing.
  _makeBenchRoom() {
    const counts = {};
    for (const e of this.roster.entries) counts[e.unitId] = (counts[e.unitId] || 0) + 1;
    const junk = this.roster.bench
      .filter(e => e.star === 1 && counts[e.unitId] === 1)
      .sort((a, b) => UNIT_BY_ID[a.unitId].cost - UNIT_BY_ID[b.unitId].cost)[0];
    if (!junk) return false;
    this.econ.gold += sellValue(UNIT_BY_ID[junk.unitId].cost, junk.star);
    this.roster.remove(junk);
    return true;
  }

  // Field the best `level` units it owns, and place them like a person would:
  // the beefiest bodies take the centre of the front line where the enemy
  // collapses in, ranged units sit behind them, and fragile Carry-role melee
  // hide in the back corners — the longest walk for whatever wants to kill them.
  buildBoard() {
    const cap = boardCapacity(this.econ.level);
    const remaining = [...this.roster.entries];
    const picked = {};
    const chosen = [];
    while (chosen.length < cap && remaining.length) {
      let bestI = 0, bestV = -Infinity;
      remaining.forEach((e, i) => {
        let v = fieldRank(e);
        if (e.star === 1 && picked[e.unitId]) v -= 5;
        if (v > bestV) { bestV = v; bestI = i; }
      });
      const e = remaining.splice(bestI, 1)[0];
      picked[e.unitId] = (picked[e.unitId] || 0) + 1;
      chosen.push(e);
    }

    for (const e of this.roster.entries) e.cell = null;

    const front = MIRROR_FRONT.slice();   // its row nearest the centre line
    const back = MIRROR_BACK.slice();     // its home row

    const info = e => {
      const u = UNIT_BY_ID[e.unitId];
      const st = statsFor(u, e.star);
      return { e, u, hp: st.maxHp };
    };
    const all = chosen.map(info);
    const reach = all.filter(x => x.u.range > 1);
    // EVERY melee unit fights on the front line — benching a melee carry in a
    // back corner cost it four seconds of walking while its front line died,
    // and that alone swung full games by ~25 points. Tanks take the centre
    // (where the enemy collapses in), damage dealers slot outward from there.
    const line = all.filter(x => x.u.range === 1)
      .sort((a, b) => b.hp - a.hp); // tankiest centre-first, carries at the edges

    const specs = [];
    const put = (x, slot) => {
      if (!slot) return false;
      x.e.cell = Hex.cellId(slot.col, slot.row);
      specs.push({ id: x.e.unitId, star: x.e.star, col: slot.col, row: slot.row });
      return true;
    };
    const anywhere = () => front.shift() || back.shift();

    for (const x of line) put(x, front.shift() || anywhere());
    for (const x of reach) put(x, back.shift() || anywhere());

    this.lastBoard = specs;
    return specs;
  }

  // End-of-round bookkeeping so its economy tracks the player's.
  settle(won) {
    this.econ.recordResult(won);
    this.econ.payout();
  }

  snapshot() {
    return {
      level: this.econ.level,
      gold: this.econ.gold,
      owned: this.roster.entries.map(e => `${e.unitId}★${e.star}`),
      board: this.lastBoard.map(s => `${s.id}★${s.star}`),
    };
  }
}

// Player prefers rows 6 (front) and 7 (back); the AI takes the 180-degree
// rotation of those, which is an exact world-space mirror.
const mirror = (col, row) => ({ col: Hex.COLS - 1 - col, row: Hex.ROWS - 1 - row });
const MIRROR_FRONT = [[3, 6], [2, 6], [4, 6], [1, 6], [5, 6], [0, 6], [6, 6]].map(([c, r]) => mirror(c, r));
const MIRROR_BACK = [[3, 7], [2, 7], [4, 7], [1, 7], [5, 7], [0, 7], [6, 7]].map(([c, r]) => mirror(c, r));
