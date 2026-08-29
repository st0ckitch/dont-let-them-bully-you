// The complaint: "4 level merab does not feel like it". Concretely: a 1-star
// 4-cost must beat a 2-star 1-cost (TFT's tier feel), and a 1-star 5-cost
// should beat a 2-star 2-cost.
const L = '../src/modes/autochess/';
const { Combat, CombatUnit, setCombatRng, ROUND_TIME } = await import(L + 'combat.ts');
const { UNIT_BY_ID } = await import(L + 'units.ts');
const seeded = s0 => { let s = s0|0; return () => { s=(s+0x6D2B79F5)|0; let t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; };
const duel = (aId, aStar, bId, bStar, n = 300) => {
  let w = 0;
  for (let i = 0; i < n; i++) {
    setCombatRng(seeded(1000 + i * 7919));
    const c = new Combat([
      new CombatUnit(UNIT_BY_ID[aId], aStar, 'player', 3, 6),
      new CombatUnit(UNIT_BY_ID[bId], bStar, 'enemy', 3, 1),
    ]);
    let g = Math.ceil((ROUND_TIME + 5) / 60 * 60); g = 60 * 40;
    while (!c.over && g-- > 0) c.update(1 / 60);
    if (c.winner === 'player') w++;
  }
  return Math.round(100 * w / n);
};
console.log(`merab★1 vs davit★2 : ${duel('merab',1,'davit',2)}%  (want >60)`);
console.log(`merab★1 vs cotne★2 : ${duel('merab',1,'cotne',2)}%  (want >55)`);
console.log(`merab★1 vs dato★2  : ${duel('merab',1,'dato',2)}%  (want ~50+, dato is 2-cost)`);
console.log(`ilia★1  vs dato★2  : ${duel('ilia',1,'dato',2)}%  (want >60)`);
console.log(`ilia★1  vs david★1 : ${duel('ilia',1,'david',1)}%  (5 vs 3 cost, want >70)`);
console.log(`merab★2 vs davit★3 : ${duel('merab',2,'davit',3)}%  (2* 4-cost vs 3* 1-cost — should be close)`);
