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

import { UNIT_BY_ID, UNITS, sellValue } from './units.js';
import { Pool, Roster, Economy, SHOP_SIZE, REROLL_COST, XP_COST, XP_PER_ROUND, BENCH_SLOTS, boardCapacity } from './shop.js';
import * as Hex from './hex.js';

let rng = Math.random;
export function setAiRng(fn) { rng = fn || Math.random; }

// ---- tuning knobs ----
// Difficulty lives here and ONLY here. Never give the AI stat bonuses: that
// breaks the pool-and-star-up logic the player is busy learning, and makes a
// lost round unreadable ("why did that 2-star lose to a 2-star?").
export const AI_TUNING = {
  // level it tries to reach by a given global round index
  levelTempo: r => (r <= 2 ? 3 : r <= 5 ? 4 : r <= 8 ? 5 : r <= 11 ? 6 : r <= 15 ? 7 : r <= 20 ? 8 : 9),
  // Gold it holds back for interest. Capped at 30 rather than climbing: a
  // player banks toward the 50-gold interest cap but still spends down to
  // stabilise, and an AI that only saves ends the game rich and dead.
  reserve: r => (r <= 3 ? 0 : r <= 8 ? 10 : 20),
  // Shop rolls per round once it is flush. This is the main lever that turns
  // banked gold into board strength — with it set too low the AI sat on a pile
  // of gold while its stars fell a full level behind the player's.
  maxRolls: r => (r <= 3 ? 0 : r <= 8 ? 2 : 4),
  // spare gold above the reserve needed before it will pay to reroll
  rollThreshold: 8,
};

// How much the AI wants a given shop card. Ordered so that finishing an upgrade
// always beats starting a new one — this is what stops it fielding three
// separate 1-star copies of the same fighter.
function wantScore(ai, unitId) {
  const unit = UNIT_BY_ID[unitId];
  const mine = ai.roster.entries.filter(e => e.unitId === unitId);
  const ones = mine.filter(e => e.star === 1).length;
  const twos = mine.filter(e => e.star === 2).length;

  if (twos >= 2) return 1000 + unit.cost;   // completes a 3-star
  if (ones >= 2) return 900 + unit.cost;    // completes a 2-star
  if (twos >= 1) return 700 + unit.cost;    // chasing a 3-star
  if (ones >= 1) return 600 + unit.cost;    // second copy, real progress
  // a fighter it does not own yet is worth taking mainly if it upgrades the
  // board — high cost, or it simply does not have enough bodies yet
  const short = ai.roster.entries.length < boardCapacity(ai.econ.level);
  return (short ? 300 : 100) + unit.cost * 20;
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
    this.econ.gold = 2;
    this.lastBoard = [];
  }

  // One planning phase of AI play, in the same order a person would do it.
  takeTurn(roundIndex) {
    const r = roundIndex;
    this.econ.grantXp(XP_PER_ROUND);
    this._levelUp(r);
    this._shopPhase(r);
    this._levelUp(r); // leftover gold after shopping can still buy tempo
    return this.buildBoard();
  }

  _levelUp(r) {
    const target = AI_TUNING.levelTempo(r);
    const reserve = AI_TUNING.reserve(r);
    while (this.econ.level < target && this.econ.gold - XP_COST >= reserve) {
      if (!this.econ.buyXp()) break;
    }
  }

  // Buy the opening shop out, then keep paying to reroll while it is genuinely
  // flush. Rolling AFTER a successful buy matters too — that is how a player
  // chains into the third copy of something they just paired.
  _shopPhase(r) {
    const reserve = AI_TUNING.reserve(r);
    let rolls = AI_TUNING.maxRolls(r);
    this._buyFrom(this.pool.roll(this.econ.level, SHOP_SIZE), r);
    while (rolls > 0 && this.econ.gold - REROLL_COST - reserve >= AI_TUNING.rollThreshold) {
      rolls--;
      this.econ.spend(REROLL_COST);
      this._buyFrom(this.pool.roll(this.econ.level, SHOP_SIZE), r);
    }
  }

  // Returns true if it bought at least one card this pass.
  _buyFrom(shop, r) {
    const reserve = AI_TUNING.reserve(r);
    const ranked = shop
      .map((id, i) => (id ? { id, i, score: wantScore(this, id) } : null))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    let bought = false;
    for (const c of ranked) {
      const unit = UNIT_BY_ID[c.id];
      if (this.econ.gold < unit.cost) continue;
      // an upgrade is always worth breaking the reserve for; a speculative
      // body is not
      const isUpgrade = c.score >= 900;
      if (!isUpgrade && this.econ.gold - unit.cost < reserve) continue;

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

  // Field the best `level` units it owns, melee forward and reach behind.
  buildBoard() {
    const cap = boardCapacity(this.econ.level);

    // Greedy pick with a small diversity tiebreak. Holding two 1-star copies
    // while hunting the third is normal play, but when the alternative is an
    // equally-ranked DIFFERENT fighter a person spreads out rather than
    // stacking. The penalty is deliberately smaller than one cost tier, so it
    // only ever breaks ties — it will never bench a genuinely better unit.
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

    // mirror of the player's preferred slots, so both sides build the same shape
    // Mark what is fielded vs benched. Roster.bench is "entries with no cell",
    // so leaving every entry cell-less made the AI look permanently bench-full
    // at 9 units — it then sold copies to make room instead of collecting them,
    // capping its roster while the player kept board + bench.
    for (const e of this.roster.entries) e.cell = null;

    const front = MIRROR_FRONT.slice();
    const back = MIRROR_BACK.slice();
    const specs = [];
    for (const e of chosen) {
      const unit = UNIT_BY_ID[e.unitId];
      const pool = unit.range > 1 ? (back.length ? back : front) : (front.length ? front : back);
      const slot = pool.shift();
      if (!slot) break;
      e.cell = Hex.cellId(slot.col, slot.row);
      specs.push({ id: e.unitId, star: e.star, col: slot.col, row: slot.row });
    }
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
