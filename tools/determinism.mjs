// Multiplayer autochess exchanges BOARDS, not per-frame state: both peers run
// the identical battle locally from a shared seed. That only works if combat.js
// is bit-deterministic. This proves it, and pins down what the protocol must
// guarantee (unit construction order).
const L = '../src/modes/autochess/';
const { Combat, CombatUnit, setCombatRng, ROUND_TIME } = await import(L + 'combat.js');
const { UNIT_BY_ID } = await import(L + 'units.js');
const Hex = await import(L + 'hex.js');
const STEP = 1/60;
const seeded = s0 => { let s = s0|0; return () => { s=(s+0x6D2B79F5)|0; let t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; };

const A = [['cotne',2,2,6],['soso',1,3,6],['gigi',2,3,7],['merab',1,4,6]];
const B = [['davit',2,2,6],['dato',1,3,6],['levan',2,3,7],['ilia',1,4,6]];
const mirror = (c,r) => [Hex.COLS-1-c, Hex.ROWS-1-r];

// Full trace of a battle: every damage event, in order.
function trace(seed, reverseOrder = false) {
  setCombatRng(seeded(seed));
  const mine = A.map(([id,star,c,r]) => new CombatUnit(UNIT_BY_ID[id], star, 'player', c, r));
  const theirs = B.map(([id,star,c,r]) => { const [mc,mr] = mirror(c,r); return new CombatUnit(UNIT_BY_ID[id], star, 'enemy', mc, mr); });
  const units = reverseOrder ? [...theirs, ...mine] : [...mine, ...theirs];
  const log = [];
  const c = new Combat(units, {
    onDamage: (src, tgt, dealt, type, crit) =>
      log.push(`${src.unit.id}>${tgt.unit.id} ${dealt.toFixed(6)} ${type}${crit?'!':''}`),
    onDeath: u => log.push(`DEAD ${u.unit.id}`),
  });
  let g = Math.ceil((ROUND_TIME+5)/STEP);
  while (!c.over && g-- > 0) c.update(STEP);
  return { winner: c.winner, t: c.t.toFixed(6), events: log.length, hash: log.join('|') };
}

let fail = 0;
const ok = (c,m) => { if (!c) { console.log('FAIL: '+m); fail++; } else console.log('  ok: '+m); };

console.log('=== same seed, same order -> identical trace (this is what MP needs) ===');
for (const seed of [1, 12345, 987654321, -42]) {
  const a = trace(seed), b = trace(seed);
  ok(a.hash === b.hash && a.winner === b.winner && a.t === b.t,
     `seed ${seed}: ${a.events} events, winner=${a.winner}, t=${a.t}`);
}

console.log('\n=== different seeds diverge (proves the seed is actually used) ===');
const s1 = trace(1), s2 = trace(2);
ok(s1.hash !== s2.hash, `seed 1 vs 2 differ (${s1.winner}/${s1.t} vs ${s2.winner}/${s2.t})`);

console.log('\n=== unit ARRAY ORDER changes the result -> protocol must fix it ===');
const fwd = trace(777, false), rev = trace(777, true);
console.log(`  forward: winner=${fwd.winner} t=${fwd.t} events=${fwd.events}`);
console.log(`  reversed: winner=${rev.winner} t=${rev.t} events=${rev.events}`);
console.log(rev.hash === fwd.hash
  ? '  order-independent (nice, but do not rely on it)'
  : '  ORDER MATTERS -> both peers must build the array identically (host units first)');

console.log('\n=== long run: 200 seeds, replayed twice each ===');
let mismatches = 0;
for (let i = 0; i < 200; i++) {
  const s = (i * 2654435761) | 0;
  if (trace(s).hash !== trace(s).hash) mismatches++;
}
ok(mismatches === 0, `200 seeds replayed identically (${mismatches} mismatches)`);

console.log(fail === 0 ? '\nCOMBAT IS DETERMINISTIC — board-exchange multiplayer is viable' : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
