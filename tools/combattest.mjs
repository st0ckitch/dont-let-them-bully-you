// Headless Monte Carlo of the autochess battle sim.
// Checks the engine terminates, that mirror matches are ~50/50, that star
// level and cost tier both actually matter, and reports typical fight length.
const L = '../src/modes/autochess/';
const { Combat, CombatUnit, setCombatRng, ROUND_TIME, playerDamage, mitigate } = await import(L + 'combat.js');
const { UNITS, UNIT_BY_ID, statsFor } = await import(L + 'units.js');
const Hex = await import(L + 'hex.js');

const STEP = 1 / 60;

function seeded(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Place a team on its half, mirroring the enemy through the board centre.
// (col,row) -> (COLS-1-col, ROWS-1-row) is an exact 180 degree rotation in
// world space, which naive row-flipping is NOT: odd-r rows are offset half a
// hex, so flipping only the row leaves the two sides misaligned and any
// "mirror match" measures that skew instead of the engine.
const SLOTS = [
  { col: 3, row: 6 }, { col: 2, row: 6 }, { col: 4, row: 6 },
  { col: 3, row: 7 }, { col: 1, row: 6 }, { col: 5, row: 6 },
  { col: 2, row: 7 }, { col: 4, row: 7 },
];

function place(specs, team) {
  return specs.map(({ id, star }, i) => {
    const s = SLOTS[i % SLOTS.length];
    const col = team === 'player' ? s.col : Hex.COLS - 1 - s.col;
    const row = team === 'player' ? s.row : Hex.ROWS - 1 - s.row;
    return new CombatUnit(UNIT_BY_ID[id], star, team, col, row);
  });
}

function runBattle(aSpecs, bSpecs, seed) {
  setCombatRng(seeded(seed));
  const units = [...place(aSpecs, 'player'), ...place(bSpecs, 'enemy')];
  const c = new Combat(units);
  let guard = Math.ceil((ROUND_TIME + 5) / STEP);
  while (!c.over && guard-- > 0) c.update(STEP);
  return { winner: c.winner, t: c.t, over: c.over, survivors: c.survivors || [], hung: guard <= 0 };
}

function rate(aSpecs, bSpecs, n = 400, seed0 = 1) {
  let a = 0, b = 0, draw = 0, tSum = 0, timeouts = 0, hung = 0;
  for (let i = 0; i < n; i++) {
    const r = runBattle(aSpecs, bSpecs, seed0 + i * 7919);
    if (r.hung) hung++;
    if (r.winner === 'player') a++;
    else if (r.winner === 'enemy') b++;
    else draw++;
    tSum += r.t;
    if (r.t >= ROUND_TIME - 0.05) timeouts++;
  }
  return { a, b, draw, n, pct: (100 * a / n).toFixed(1), avgT: (tSum / n).toFixed(1), timeouts, hung };
}

const one = id => [{ id, star: 1 }];
const team = (ids, star = 1) => ids.map(id => ({ id, star }));

console.log('=== sanity: damage mitigation curve ===');
for (const r of [0, 20, 40, 60, 100]) console.log(`  armor ${String(r).padStart(3)} -> ${(100 * mitigate(1, r)).toFixed(1)}% damage taken`);

console.log('\n=== mirror matches should be ~50% (asymmetry would mean a positional bug) ===');
let mirrorBad = 0;
for (const u of UNITS) {
  const r = rate(one(u.id), one(u.id), 200, 5);
  const off = Math.abs(+r.pct - 50);
  if (off > 12) mirrorBad++;
  console.log(`  ${u.id.padEnd(7)} ${r.pct}%  avg ${r.avgT}s  draws=${r.draw} timeouts=${r.timeouts} hung=${r.hung}${off > 12 ? '   <-- SKEWED' : ''}`);
}

console.log('\n=== star level must dominate (2-star vs 1-star of the same unit) ===');
for (const u of UNITS) {
  const r = rate([{ id: u.id, star: 2 }], one(u.id), 150, 11);
  console.log(`  ${u.id.padEnd(7)} 2★ beats 1★ ${r.pct}%  avg ${r.avgT}s`);
}

console.log('\n=== cost tier must matter (each unit vs a 1-cost baseline: davit) ===');
for (const u of UNITS) {
  const r = rate(one(u.id), one('davit'), 200, 23);
  console.log(`  ${u.id.padEnd(7)} (cost ${u.cost}) vs davit(1): ${r.pct}%  avg ${r.avgT}s`);
}

// NOTE: there is deliberately no within-tier 1v1 round robin here. A duel
// between two same-cost units is a near-deterministic damage race, so it goes
// bimodal (0% or 100%) on a handful of stat points and reports healthy rosters
// as broken. Roster balance is measured at board level by tools/balance.mjs,
// which is what TFT actually tunes. This file checks STRUCTURE: symmetry,
// termination, and that star level and cost tier both move the needle.

console.log('\n=== full boards: 6v6 mirror + level advantage ===');
const six = ['cotne', 'merab', 'soso', 'levan', 'gigi', 'ilia'];
console.log('  6v6 mirror:', JSON.stringify(rate(team(six), team(six), 200, 31)));
console.log('  6 units vs 4 units:', JSON.stringify(rate(team(six), team(six.slice(0, 4)), 200, 37)));
console.log('  6x2star vs 6x1star:', JSON.stringify(rate(team(six, 2), team(six, 1), 150, 41)));

console.log('\n=== player damage on loss ===');
for (const stage of [2, 3, 4, 5]) {
  for (const [n, star] of [[2, 1], [4, 2], [6, 2]]) {
    const surv = Array.from({ length: n }, () => ({ star }));
    console.log(`  stage ${stage}, ${n} survivors at ${star}★ -> ${playerDamage(stage, surv)} damage`);
  }
}
