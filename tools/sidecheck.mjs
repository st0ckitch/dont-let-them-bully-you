// Is the player's 80% win rate a real strategy edge, or a side bias?
// Run the SAME AiOpponent policy on both sides and see if it's 50/50.
const L = '../src/tft/';
const { Combat, CombatUnit, setCombatRng, ROUND_TIME, playerDamage } = await import(L + 'combat.js');
const { UNIT_BY_ID } = await import(L + 'units.js');
const { Pool } = await import(L + 'shop.js');
const { AiOpponent } = await import(L + 'ai.js');
const Hex = await import(L + 'hex.js');
const STEP = 1/60;
const seeded = s0 => { let s=s0|0; return () => { s=(s+0x6D2B79F5)|0; let t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; };
const mirror = (c,r) => [Hex.COLS-1-c, Hex.ROWS-1-r];

// AI vs AI: identical policy both sides. Side A's board is used verbatim
// (it already sits on rows 0-1); side B gets it mirrored back to rows 6-7.
function game(seed) {
  setCombatRng(seeded(seed));
  const pool = new Pool();
  const a = new AiOpponent(pool), b = new AiOpponent(pool);
  let hpA = 100, hpB = 100, r = 1;
  for (; r <= 30 && hpA > 0 && hpB > 0; r++) {
    const sa = a.takeTurn(r), sb = b.takeTurn(r);
    // a plays as 'enemy' (its native rows); b is mirrored to be 'player'
    const ua = sa.map(s => new CombatUnit(UNIT_BY_ID[s.id], s.star, 'enemy', s.col, s.row));
    const ub = sb.map(s => { const [c,rr] = mirror(s.col, s.row); return new CombatUnit(UNIT_BY_ID[s.id], s.star, 'player', c, rr); });
    const c = new Combat([...ub, ...ua]);
    let g = Math.ceil((ROUND_TIME+5)/STEP); while(!c.over && g-->0) c.update(STEP);
    const stage = Math.min(8, 1 + Math.ceil(r/5));
    const bWon = c.winner === 'player';
    if (!bWon) hpB = Math.max(0, hpB - playerDamage(stage, c.living('enemy')));
    if (c.winner !== 'enemy') hpA = Math.max(0, hpA - playerDamage(stage, c.living('player')));
    a.settle(!bWon); b.settle(bWon);
  }
  return hpB > 0 && hpA <= 0 ? 'player-side' : hpA > 0 && hpB <= 0 ? 'enemy-side' : 'draw';
}
const N = +(process.argv[2]||300);
const rand = seeded(31337);
let p=0,e=0,d=0;
for (let i=0;i<N;i++){ const w = game((rand()*2**31)|0); if(w==='player-side')p++; else if(w==='enemy-side')e++; else d++; }
console.log(`identical AI policy on both sides, N=${N}`);
console.log(`  player-side (rows 6-7) wins: ${(100*p/N).toFixed(1)}%`);
console.log(`  enemy-side  (rows 0-1) wins: ${(100*e/N).toFixed(1)}%`);
console.log(`  draws: ${(100*d/N).toFixed(1)}%`);
console.log(p/N > 0.6 || e/N > 0.6 ? '  --> SIDE BIAS' : '  --> sides are fair; any win-rate gap is strategy quality');
