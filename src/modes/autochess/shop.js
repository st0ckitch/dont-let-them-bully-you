// Shop, shared unit pool, economy and roster management.
//
// Follows TFT's evergreen economy: flat income plus interest on savings plus a
// streak bonus, XP bought in 4-gold chunks, a 5-card shop rolled against a
// per-level odds table, and three copies of a champion merging into the next
// star level (cascading, so nine 1-stars become a 3-star).

import { UNITS, UNITS_BY_COST, UNIT_BY_ID, POOL_COPIES } from './units.js?v=202608281148';

let rng = Math.random;
export function setShopRng(fn) { rng = fn || Math.random; }

export const SHOP_SIZE = 5;
export const REROLL_COST = 2;
export const XP_COST = 4;
export const XP_PER_BUY = 4;
export const XP_PER_ROUND = 2;
export const BENCH_SLOTS = 9;
export const MAX_LEVEL = 9;
export const START_GOLD = 2;
export const START_HP = 100;
export const BASE_INCOME = 5;
export const INTEREST_PER = 10;   // one gold per this much banked
export const MAX_INTEREST = 5;    // caps at 50 gold saved

// XP required to advance FROM this level to the next. Buying XP is the main
// alternative to rerolling, so the curve is what makes "level or roll" a real
// decision every round.
// The old top end (36/48/80) was tuned for a game that no longer exists: with
// games ending near round 14, level 8 was unreachable and the level-7+ shop
// odds for 4/5-costs were dead weight. This curve lands an engaged player at
// 7-8 by the late-teens rounds, which is where Ilia becomes a real decision.
export const XP_TO_NEXT = { 1: 2, 2: 2, 3: 6, 4: 10, 5: 18, 6: 26, 7: 34, 8: 48 };

// Board slots equal player level, exactly like TFT.
export const boardCapacity = level => level;

// Streak gold. Both win and loss streaks pay, which is what makes deliberate
// lose-streaking a legitimate economic strategy rather than just losing.
// Breakpoints are 2/3/4 -> +1, 5 -> +2, 6+ -> +3. Patch 14.8 restored the
// 2-streak tier; sources that still list 3/4 -> +1, 5 -> +2, 6+ -> +3 are stale.
export function streakBonus(streak) {
  const n = Math.abs(streak);
  if (n >= 6) return 3;
  if (n === 5) return 2;
  if (n >= 2) return 1;
  return 0;
}

export function interestOn(gold) {
  return Math.min(MAX_INTEREST, Math.floor(gold / INTEREST_PER));
}

// Shop odds by player level: [1-cost, 2-cost, 3-cost, 4-cost, 5-cost] percent.
// Low levels are almost pure 1-costs, so early rolling is how you 3-star a
// cheap unit; high-cost units only become realistically rollable at 7+.
export const SHOP_ODDS = {
  1: [100, 0, 0, 0, 0],
  2: [100, 0, 0, 0, 0],
  3: [75, 25, 0, 0, 0],
  4: [55, 30, 15, 0, 0],
  5: [45, 33, 20, 2, 0],
  6: [30, 40, 25, 5, 0],
  7: [19, 30, 33, 14, 4],
  8: [14, 20, 30, 29, 7],
  9: [10, 15, 23, 33, 19],
};

// ---- shared unit pool ----
// Every copy of every champion that exists. Buying removes one; selling puts
// them back. It is what stops everyone from 3-starring the same carry.
export class Pool {
  constructor() {
    this.counts = {};
    for (const u of UNITS) this.counts[u.id] = POOL_COPIES[u.cost];
  }

  countOf(id) { return this.counts[id] || 0; }

  take(id) {
    if (!this.counts[id]) return false;
    this.counts[id]--;
    return true;
  }

  give(id, n = 1) {
    this.counts[id] = Math.min(POOL_COPIES[UNIT_BY_ID[id].cost], (this.counts[id] || 0) + n);
  }

  // Draw one card: pick a cost tier by the level's odds, then a champion from
  // that tier weighted by how many copies remain. Falls back down the tiers if
  // the chosen tier is exhausted.
  draw(level) {
    const odds = SHOP_ODDS[Math.min(level, MAX_LEVEL)] || SHOP_ODDS[1];
    let r = rng() * 100;
    let tier = 1;
    for (let i = 0; i < odds.length; i++) {
      r -= odds[i];
      if (r <= 0) { tier = i + 1; break; }
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidates = UNITS_BY_COST[tier].filter(u => this.countOf(u.id) > 0);
      const total = candidates.reduce((s, u) => s + this.countOf(u.id), 0);
      if (total > 0) {
        let pick = rng() * total;
        for (const u of candidates) {
          pick -= this.countOf(u.id);
          if (pick <= 0) return u.id;
        }
        return candidates[candidates.length - 1].id;
      }
      tier = tier > 1 ? tier - 1 : tier + 1; // exhausted tier: try an adjacent one
    }
    return null;
  }

  roll(level, n = SHOP_SIZE) {
    // cards are NOT removed from the pool until bought — the same champion can
    // legitimately appear twice in one shop
    return Array.from({ length: n }, () => this.draw(level));
  }
}

// ---- roster ----
// Bench and board hold the same entry shape: { uid, unitId, star, cell }.
// `cell` is null while benched.
let nextEntryUid = 1;
export const makeEntry = (unitId, star = 1) => ({ uid: nextEntryUid++, unitId, star, cell: null });

export class Roster {
  constructor(pool) {
    this.pool = pool;
    this.entries = [];
  }

  get bench() { return this.entries.filter(e => e.cell === null); }
  get board() { return this.entries.filter(e => e.cell !== null); }
  benchFull() { return this.bench.length >= BENCH_SLOTS; }
  at(cell) { return this.entries.find(e => e.cell === cell) || null; }

  // Add a bought/granted copy, then resolve any merges it completed.
  // Returns { entry, merged } where `merged` lists the star-ups that happened.
  add(unitId, star = 1) {
    const e = makeEntry(unitId, star);
    this.entries.push(e);
    const merged = [];
    this._resolveMerges(unitId, merged);
    // the original entry may have been consumed by a merge
    const survivor = this.entries.includes(e) ? e : merged.length ? merged[merged.length - 1].entry : null;
    return { entry: survivor, merged };
  }

  // Three copies of a champion at the same star become one at star+1, and the
  // result can itself complete a trio — nine 1-stars cascade to a 3-star.
  _resolveMerges(unitId, merged) {
    for (let star = 1; star <= 2; star++) {
      const same = this.entries.filter(e => e.unitId === unitId && e.star === star);
      if (same.length < 3) continue;
      const trio = same.slice(0, 3);
      // the upgrade inherits a board slot if any of the three held one, so a
      // merge never silently pulls a unit off the board
      const cell = trio.map(e => e.cell).find(c => c !== null) ?? null;
      this.entries = this.entries.filter(e => !trio.includes(e));
      const up = makeEntry(unitId, star + 1);
      up.cell = cell;
      this.entries.push(up);
      merged.push({ entry: up, star: star + 1 });
      this._resolveMerges(unitId, merged); // cascade
      return;
    }
  }

  // How many more copies until the next star-up (for shop card progress pips).
  copiesToward(unitId) {
    const ones = this.entries.filter(e => e.unitId === unitId && e.star === 1).length;
    const twos = this.entries.filter(e => e.unitId === unitId && e.star === 2).length;
    if (twos >= 1 && twos < 3) return { star: 3, have: twos, need: 3 };
    return { star: 2, have: ones % 3, need: 3 };
  }

  remove(entry) {
    this.entries = this.entries.filter(e => e !== entry);
    // every copy folded into this unit goes back to the shared pool
    this.pool.give(entry.unitId, entry.star === 1 ? 1 : entry.star === 2 ? 3 : 9);
  }
}

// ---- player economy ----
export class Economy {
  constructor() {
    this.gold = START_GOLD;
    this.hp = START_HP;
    this.level = 1;
    this.xp = 0;
    this.streak = 0; // positive = win streak, negative = loss streak
  }

  canAfford(n) { return this.gold >= n; }
  spend(n) { if (this.gold < n) return false; this.gold -= n; return true; }

  buyXp() {
    if (this.level >= MAX_LEVEL || !this.spend(XP_COST)) return false;
    this.grantXp(XP_PER_BUY);
    return true;
  }

  grantXp(n) {
    if (this.level >= MAX_LEVEL) return;
    this.xp += n;
    while (this.level < MAX_LEVEL && this.xp >= XP_TO_NEXT[this.level]) {
      this.xp -= XP_TO_NEXT[this.level];
      this.level++;
    }
    if (this.level >= MAX_LEVEL) this.xp = 0;
  }

  xpToNext() { return this.level >= MAX_LEVEL ? 0 : XP_TO_NEXT[this.level]; }

  // End-of-round payout. Returns the breakdown so the UI can show where the
  // gold came from — TFT players read that split constantly.
  payout() {
    const base = BASE_INCOME;
    const interest = interestOn(this.gold);
    const streak = streakBonus(this.streak);
    this.gold += base + interest + streak;
    return { base, interest, streak, total: base + interest + streak };
  }

  recordResult(won) {
    if (won) this.streak = this.streak >= 0 ? this.streak + 1 : 1;
    else this.streak = this.streak <= 0 ? this.streak - 1 : -1;
  }
}
