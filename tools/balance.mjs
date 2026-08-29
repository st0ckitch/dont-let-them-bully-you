// Team-level balance harness.
//
// A 1v1 between two same-cost units is a near-deterministic damage race, so it
// goes bimodal (0% or 100%) on a few points of stat difference and is useless
// as a tuning target. TFT balances a unit by what it contributes to a BOARD,
// so that is what this measures: build many random boards, run them against
// each other, and report each unit's win rate across the games it appeared in.
//
// Targets:
//   * within a cost tier, units should sit close together
//   * across tiers, win rate should climb with cost (that IS the cost ladder)
const L = '../src/modes/autochess/';
const { Combat, CombatUnit, setCombatRng, ROUND_TIME } = await import(L + 'combat.ts');
const { UNITS, UNIT_BY_ID } = await import(L + 'units.ts');
const Hex = await import(L + 'hex.ts');

const STEP = 1 / 60;
const seeded = s0 => {
  let s = s0 | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Front two rows get the melee, back row the reach units — the placement a
// real player would use, so reach is measured doing its actual job.
const FRONT = [{ col: 2, row: 6 }, { col: 3, row: 6 }, { col: 4, row: 6 }, { col: 1, row: 6 }, { col: 5, row: 6 }];
const BACK = [{ col: 3, row: 7 }, { col: 2, row: 7 }, { col: 4, row: 7 }, { col: 1, row: 7 }, { col: 5, row: 7 }];

function place(specs, team) {
  const front = [...FRONT], back = [...BACK];
  return specs.map(({ id, star }) => {
    const u = UNIT_BY_ID[id];
    const pool = u.range > 1 ? (back.length ? back : front) : (front.length ? front : back);
    const s = pool.shift();
    const col = team === 'player' ? s.col : Hex.COLS - 1 - s.col;
    const row = team === 'player' ? s.row : Hex.ROWS - 1 - s.row;
    return new CombatUnit(u, star, team, col, row);
  });
}

function battle(aSpecs, bSpecs, seed) {
  setCombatRng(seeded(seed));
  const c = new Combat([...place(aSpecs, 'player'), ...place(bSpecs, 'enemy')]);
  let g = Math.ceil((ROUND_TIME + 5) / STEP);
  while (!c.over && g-- > 0) c.update(STEP);
  return { winner: c.winner, t: c.t, timeout: c.t >= ROUND_TIME - 0.05 };
}

// Random board of `k` units. Duplicates allowed (you can field two of a champ),
// star levels weighted toward 1 like a real mid-game board.
function randomBoard(rand, k) {
  const out = [];
  for (let i = 0; i < k; i++) {
    const u = UNITS[Math.floor(rand() * UNITS.length)];
    const r = rand();
    const star = r < 0.72 ? 1 : r < 0.97 ? 2 : 3;
    out.push({ id: u.id, star });
  }
  return out;
}

const N = +(process.argv[2] || 6000);
const K = +(process.argv[3] || 6);
const rand = seeded(20260820);

const stat = {};
for (const u of UNITS) stat[u.id] = { games: 0, wins: 0, byStar: { 1: { g: 0, w: 0 }, 2: { g: 0, w: 0 }, 3: { g: 0, w: 0 } } };
let timeouts = 0, draws = 0, tSum = 0;

for (let i = 0; i < N; i++) {
  const a = randomBoard(rand, K);
  const b = randomBoard(rand, K);
  const r = battle(a, b, (rand() * 2 ** 31) | 0);
  tSum += r.t;
  if (r.timeout) timeouts++;
  if (!r.winner) draws++;
  for (const [specs, team] of [[a, 'player'], [b, 'enemy']]) {
    const won = r.winner === team;
    // count a champion once per board, so fielding three copies doesn't
    // triple-weight that board's result
    const seen = new Set();
    for (const s of specs) {
      const rec = stat[s.id];
      rec.byStar[s.star].g++;
      if (won) rec.byStar[s.star].w++;
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      rec.games++;
      if (won) rec.wins++;
    }
  }
}

const pct = (w, g) => g ? (100 * w / g) : NaN;
console.log(`${N} boards of ${K} units each — avg fight ${(tSum / N).toFixed(1)}s, timeouts ${(100 * timeouts / N).toFixed(1)}%, draws ${(100 * draws / N).toFixed(2)}%\n`);

const rows = UNITS.map(u => ({ u, wr: pct(stat[u.id].wins, stat[u.id].games), g: stat[u.id].games }))
  .sort((x, y) => x.u.cost - y.u.cost || y.wr - x.wr);

console.log('unit     cost  games   winrate   by star (1 / 2 / 3)');
let lastCost = null;
for (const { u, wr, g } of rows) {
  if (lastCost !== null && u.cost !== lastCost) console.log('        ---');
  lastCost = u.cost;
  const bs = stat[u.id].byStar;
  const s = [1, 2, 3].map(k => (bs[k].g > 40 ? pct(bs[k].w, bs[k].g).toFixed(0).padStart(3) + '%' : '  - ')).join(' / ');
  console.log(`${u.id.padEnd(8)} ${String(u.cost).padEnd(5)} ${String(g).padStart(5)}   ${wr.toFixed(1).padStart(5)}%   ${s}`);
}

console.log('\ntier averages (should climb with cost):');
for (const cost of [1, 2, 3, 4, 5]) {
  const tier = rows.filter(r => r.u.cost === cost);
  const avg = tier.reduce((s, r) => s + r.wr, 0) / tier.length;
  const spread = Math.max(...tier.map(r => r.wr)) - Math.min(...tier.map(r => r.wr));
  console.log(`  cost ${cost}: ${avg.toFixed(1)}%   in-tier spread ${spread.toFixed(1)} pts${spread > 10 ? '  <-- WIDE' : ''}`);
}
