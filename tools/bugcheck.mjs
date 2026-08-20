const L = '../src/tft/';
const { Pool, Roster } = await import(L + 'shop.js');
const { POOL_COPIES } = await import(L + 'units.js');
const { AiOpponent } = await import(L + 'ai.js');

console.log('B2: does a 3rd copy complete a 3-star when you hold two 2-stars?');
{
  const r = new Roster(new Pool());
  for (let i = 0; i < 6; i++) r.add('soso');          // -> two 2-stars
  console.log('   after 6 copies:', r.entries.map(e => `★${e.star}`).join(','));
  r.add('soso');                                       // the "completes a 3-star" buy
  console.log('   after 7 copies:', r.entries.map(e => `★${e.star}`).join(','), '   <- no 3-star; needs THREE 2-stars (9 copies)');
  r.add('soso'); r.add('soso');
  console.log('   after 9 copies:', r.entries.map(e => `★${e.star}`).join(','));
}

console.log('\nB3: does the AI keep buying a champion it has already 3-starred?');
{
  const pool = new Pool();
  const ai = new AiOpponent(pool);
  for (let r = 1; r <= 25; r++) { ai.takeTurn(r); ai.settle(r % 2 === 0); }
  const owned = {};
  for (const e of ai.roster.entries) owned[e.unitId] = (owned[e.unitId] || 0) + (e.star === 1 ? 1 : e.star === 2 ? 3 : 9);
  const threes = ai.roster.entries.filter(e => e.star === 3).map(e => e.unitId);
  console.log('   3-starred:', threes.join(',') || 'none');
  for (const id of threes) console.log(`   copies of ${id} held: ${owned[id]}  (9 = exactly one 3-star, >9 = still buying)`);
  console.log('   pool drain:');
  for (const [id, n] of Object.entries(pool.counts)) {
    const cap = POOL_COPIES[({soso:1,davit:1,cotne:1,gigi:2,dato:2,levan:3,david:3,merab:4,ilia:5})[id]];
    const used = cap - n;
    if (used > 0) console.log(`     ${id.padEnd(6)} ${used}/${cap} taken (${(100*used/cap).toFixed(0)}%)`);
  }
}
