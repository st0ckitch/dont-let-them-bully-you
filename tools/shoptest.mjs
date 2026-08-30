const L = '../src/modes/autochess/';
const S = await import(L + 'shop.ts');
const { UNIT_BY_ID, POOL_COPIES, sellValue } = await import(L + 'units.ts');

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL:', m); fail++; } else console.log('  ok:', m); };

console.log('=== merge cascade ===');
{
  const pool = new S.Pool();
  const r = new S.Roster(pool);
  for (let i = 0; i < 2; i++) r.add('soso');
  ok(r.entries.length === 2 && r.entries.every(e => e.star === 1), '2 copies stay as two 1-stars');
  const third = r.add('soso');
  ok(r.entries.length === 1 && r.entries[0].star === 2, '3rd copy merges to a single 2-star');
  ok(third.merged.length === 1 && third.merged[0].star === 2, 'merge reported');

  // nine total should cascade to one 3-star
  const p2 = new S.Pool(); const r2 = new S.Roster(p2);
  let lastMerges = [];
  for (let i = 0; i < 9; i++) lastMerges = r2.add('soso').merged;
  ok(r2.entries.length === 1 && r2.entries[0].star === 3, `9 copies cascade to one 3-star (got ${r2.entries.length} entries, star ${r2.entries[0]?.star})`);
  ok(lastMerges.some(m => m.star === 3), 'cascade reported the 3-star step');
}

console.log('\n=== merge keeps a board slot ===');
{
  const r = new S.Roster(new S.Pool());
  const a = r.add('davit').entry; a.cell = 17;      // on the board
  r.add('davit');                                    // bench
  const res = r.add('davit');                        // completes the trio
  ok(r.entries.length === 1, 'trio collapsed to one entry');
  ok(r.entries[0].star === 2, 'result is a 2-star');
  ok(r.entries[0].cell === 17, `upgrade inherited the board slot (cell=${r.entries[0].cell})`);
}

console.log('\n=== pool accounting ===');
{
  const pool = new S.Pool();
  const start = pool.countOf('ilia');
  ok(start === POOL_COPIES[5], `ilia starts with ${POOL_COPIES[5]} copies`);
  for (let i = 0; i < 3; i++) pool.take('ilia');
  ok(pool.countOf('ilia') === start - 3, 'taking 3 removes 3');

  const r = new S.Roster(pool);
  for (let i = 0; i < 3; i++) r.add('ilia');
  const twoStar = r.entries[0];
  r.remove(twoStar);
  ok(pool.countOf('ilia') === start, `selling a 2-star returns all 3 copies (${pool.countOf('ilia')} vs ${start})`);

  // pool cannot exceed its cap
  pool.give('ilia', 50);
  ok(pool.countOf('ilia') === POOL_COPIES[5], 'give() clamps at the cap');
}

console.log('\n=== shop odds respect level ===');
{
  S.setShopRng(Math.random);
  for (const level of [1, 3, 5, 7, 9]) {
    const pool = new S.Pool();
    const seen = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const id = pool.draw(level);
      if (id) seen[UNIT_BY_ID[id].cost]++;
    }
    const pct = c => (100 * seen[c] / N).toFixed(0).padStart(3);
    const expected = S.SHOP_ODDS[level].map(x => String(x).padStart(3)).join(' ');
    console.log(`  L${level} actual ${[1,2,3,4,5].map(pct).join(' ')}  expected ${expected}`);
    // level 1-2 must never show a 2-cost or above
    if (level <= 2) ok(seen[2] + seen[3] + seen[4] + seen[5] === 0, `L${level} shows only 1-costs`);
  }
}

console.log('\n=== economy ===');
{
  const e = new S.Economy();
  ok(e.gold === S.START_GOLD && e.hp === 100 && e.level === 1, 'starting state');

  e.gold = 0; e.streak = 0;
  ok(e.payout().total === 5, 'no savings, no streak -> 5 gold');
  e.gold = 50; e.streak = 0;
  ok(e.payout().total === 10, '50 banked -> 5 base + 5 interest');
  e.gold = 100; e.streak = 0;
  ok(e.payout().interest === 5, 'interest caps at 5');
  // Streak breakpoints: 2/3/4 -> +1, 5 -> +2, 6+ -> +3 (patch 14.8 restored the
  // 2-streak tier; the widely-published 3/4 -> +1 table is stale).
  const streakTable = [[0, 0], [1, 0], [2, 1], [3, 1], [4, 1], [5, 2], [6, 3], [9, 3]];
  for (const [n, want] of streakTable) {
    ok(S.streakBonus(n) === want, `win streak ${n} -> +${want}g (got ${S.streakBonus(n)})`);
    ok(S.streakBonus(-n) === want, `loss streak ${n} pays the same (+${want}g)`);
  }
  e.gold = 30; e.streak = 5;
  ok(e.payout().total === 5 + 3 + 2, '30 banked + 5 win streak -> 5 base + 3 interest + 2 streak');
  e.gold = 30; e.streak = -6;
  ok(e.payout().total === 5 + 3 + 3, '30 banked + 6 loss streak -> 5 + 3 + 3');

  // streak transitions
  const e2 = new S.Economy();
  e2.recordResult(true); e2.recordResult(true);
  ok(e2.streak === 2, 'two wins -> +2');
  e2.recordResult(false);
  ok(e2.streak === -1, 'a loss resets to -1, not 1');

  // levelling
  const e3 = new S.Economy();
  let spent = 0;
  while (e3.level < 9) { e3.gold = 100; e3.buyXp(); spent += S.XP_COST; }
  ok(e3.level === 9, `reaches max level (spent ~${spent}g on XP)`);
  ok(S.boardCapacity(e3.level) === 9, 'board capacity equals level');
  const e4 = new S.Economy();
  e4.gold = 0;
  ok(e4.buyXp() === false, 'cannot buy XP without gold');
}

console.log('\n=== sell values ===');
for (const cost of [1, 2, 3, 4, 5]) {
  console.log(`  cost ${cost}: 1★=${sellValue(cost,1)}  2★=${sellValue(cost,2)}  3★=${sellValue(cost,3)}`);
}
ok(sellValue(1, 2) === 3, '1-cost 2-star refunds full 3g');
ok(sellValue(3, 2) === 8, '3-cost 2-star refunds 9-1 = 8g');

console.log(fail === 0 ? '\nALL SHOP TESTS PASSED' : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
