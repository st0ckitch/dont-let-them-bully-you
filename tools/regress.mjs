// The autochess work touched fighter3d.js (constructor options) and main.js.
// fight.js is untouched, but its balance depends on Fighter3D's arena clamp
// default, so re-run the Monte Carlo the project already used for tuning.
const L = '../src/';
const { simFight, setFightRng } = await import('../src/modes/octagon/fight.js');
const { FIGHTERS } = await import('../src/fighters/index.js');
setFightRng(null);
const N = 3000;
console.log(`simFight matrix, N=${N} per pairing (win% for the ROW fighter)\n`);
const ids = FIGHTERS.map(f => f.id);
process.stdout.write('        ' + ids.map(i => i.slice(0,5).padStart(6)).join('') + '\n');
const all = [];
for (const a of FIGHTERS) {
  let row = a.id.padEnd(8);
  for (const b of FIGHTERS) {
    if (a === b) { row += '     -'; continue; }
    let w = 0;
    for (let i = 0; i < N; i++) { const r = simFight(a, b); if (r === 'a' || r === 'a-dec') w++; }
    const pct = 100 * w / N;
    all.push(pct);
    row += (pct.toFixed(0) + '%').padStart(6);
  }
  console.log(row);
}
const min = Math.min(...all), max = Math.max(...all);
console.log(`\nspread: ${min.toFixed(1)}% - ${max.toFixed(1)}%  (README/config notes claim a 43-57 band)`);
// KO share
let ko = 0, dec = 0, draw = 0;
for (let i = 0; i < 4000; i++) {
  const a = FIGHTERS[i % 9], b = FIGHTERS[(i * 7 + 3) % 9];
  if (a === b) continue;
  const r = simFight(a, b);
  if (r === 'draw') draw++; else if (r.endsWith('-dec')) dec++; else ko++;
}
const tot = ko + dec + draw;
console.log(`finish mix over ${tot}: KO ${(100*ko/tot).toFixed(0)}%  decision ${(100*dec/tot).toFixed(0)}%  draw ${(100*draw/tot).toFixed(1)}%`);
