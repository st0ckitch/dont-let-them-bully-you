// Does the AI opponent look like a person playing, or like dice?
//
// Each metric below targets one of the observed complaints: the cast changing
// every round, duplicate 1-star copies standing next to each other, boards that
// are sometimes a single fighter, and star levels that appear from nowhere.
const L = '../src/modes/autochess/';
const { AiOpponent, AI_TUNING } = await import(L + 'ai.ts');
const { Pool, boardCapacity } = await import(L + 'shop.ts');
const { UNIT_BY_ID } = await import(L + 'units.ts');

const ROUNDS = 20;
const GAMES = 300;

function playGame() {
  const pool = new Pool();
  const ai = new AiOpponent(pool);
  const boards = [];
  for (let r = 1; r <= ROUNDS; r++) {
    boards.push(ai.takeTurn(r).map(s => ({ ...s })));
    // alternate results so streak logic sees both, roughly an even matchup
    ai.settle(r % 2 === 0);
  }
  return { boards, ai };
}

const games = Array.from({ length: GAMES }, playGame);

// ---- metric 1: roster continuity ----
// share of a board's fighters that were also on the previous round's board
let contSum = 0, contN = 0;
for (const g of games) {
  for (let i = 1; i < g.boards.length; i++) {
    const prev = new Set(g.boards[i - 1].map(s => s.id));
    const cur = g.boards[i];
    if (!cur.length) continue;
    contSum += cur.filter(s => prev.has(s.id)).length / cur.length;
    contN++;
  }
}
const continuity = contSum / contN;

// ---- metric 2: duplicate copies fielded ----
// Three copies at the same star is IMPOSSIBLE once merging works (they combine
// on the third), so any stack is at most a pair being held while hunting the
// third copy — which is what a person actually does. What would be genuinely
// wrong is fielding a duplicate while a BETTER unit sits benched, so that is
// what the assertion below checks; the raw count is reported for eyeballing.
let dupBoards = 0, totalBoards = 0, dupUnits = 0, tripleStacks = 0, dupOverBetter = 0;
for (const g of games) {
  for (const b of g.boards) {
    totalBoards++;
    const byId = {};
    for (const s of b) if (s.star === 1) byId[s.id] = (byId[s.id] || 0) + 1;
    const extra = Object.values(byId).reduce((a, n) => a + Math.max(0, n - 1), 0);
    if (extra > 0) dupBoards++;
    dupUnits += extra;
    // a stack of 3+ at one star means merging silently failed
    const anyStar = {};
    for (const s of b) { const k = s.id + s.star; anyStar[k] = (anyStar[k] || 0) + 1; }
    if (Object.values(anyStar).some(n => n >= 3)) tripleStacks++;
  }
}
// did it ever bench a strictly better unit to field a duplicate?
for (const g of games) {
  const owned = g.ai.roster.entries;
  const fielded = new Set(g.ai.lastBoard.map(s => s.id + s.star));
  const benchBest = owned
    .filter(e => !fielded.has(e.unitId + e.star))
    .reduce((m, e) => Math.max(m, e.star * 1000 + UNIT_BY_ID[e.unitId].cost * 10), -1);
  const dupWorst = (() => {
    const seen = {};
    let worst = Infinity;
    for (const s of g.ai.lastBoard) {
      if (seen[s.id]) worst = Math.min(worst, s.star * 1000 + UNIT_BY_ID[s.id].cost * 10);
      seen[s.id] = true;
    }
    return worst;
  })();
  if (dupWorst < benchBest) dupOverBetter++;
}

// ---- metric 3: board size vs its own level cap ----
let underfilled = 0, sizeSum = 0, tinyBoards = 0;
for (const g of games) {
  for (let i = 0; i < g.boards.length; i++) {
    const b = g.boards[i];
    sizeSum += b.length;
    if (b.length <= 1 && i >= 3) tinyBoards++;
  }
}

// ---- metric 4: star progression ----
// stars should climb over the game because copies were collected, not rolled
const starByRound = Array.from({ length: ROUNDS }, () => ({ sum: 0, n: 0, max: 0 }));
for (const g of games) {
  g.boards.forEach((b, i) => {
    for (const s of b) { starByRound[i].sum += s.star; starByRound[i].n++; starByRound[i].max = Math.max(starByRound[i].max, s.star); }
  });
}

// ---- metric 5: comp concentration ----
// how many DISTINCT fighters a game touches; a human commits to a few
const distinct = games.map(g => new Set(g.boards.flat().map(s => s.id)).size);
const avgDistinct = distinct.reduce((a, b) => a + b, 0) / distinct.length;

const pct = x => (100 * x).toFixed(1) + '%';
console.log(`${GAMES} games x ${ROUNDS} rounds\n`);
console.log('metric                                  value        human target        random baseline');
console.log(`roster continuity round-to-round        ${pct(continuity).padStart(6)}       >70%                ~25% (uniform of 9)`);
console.log(`boards with duplicate 1-star copies     ${pct(dupBoards / totalBoards).padStart(6)}       ~0%                 high`);
console.log(`  duplicate 1-star units per board      ${(dupUnits / totalBoards).toFixed(2).padStart(6)}       pairs OK (hunting 3rd)`);
console.log(`boards with 3+ copies at one star       ${String(tripleStacks).padStart(6)}       0 (merging must fire)`);
console.log(`dup fielded over a better benched unit  ${String(dupOverBetter).padStart(6)}       0`);
console.log(`boards of <=1 unit after round 3        ${pct(tinyBoards / totalBoards).padStart(6)}       0%`);
console.log(`avg board size                          ${(sizeSum / totalBoards).toFixed(2).padStart(6)}`);
console.log(`distinct fighters used per game         ${avgDistinct.toFixed(1).padStart(6)}       3-6 of 9            ~9 of 9`);

console.log('\nstar level by round (avg / max seen):');
starByRound.forEach((s, i) => {
  if (!s.n) return;
  const bar = '#'.repeat(Math.round((s.sum / s.n - 1) * 24));
  console.log(`  r${String(i + 1).padStart(2)}  ${(s.sum / s.n).toFixed(2)}  max${s.max}  ${bar}`);
});

console.log('\nAI economy at end of game (first 3 games):');
for (const g of games.slice(0, 3)) {
  const s = g.ai.snapshot();
  console.log(`  lv${s.level} gold=${s.gold}`);
  console.log(`    owns:  ${s.owned.join(', ')}`);
  console.log(`    board: ${s.board.join(', ')}`);
}

console.log('\nsample: one game round by round');
games[0].boards.forEach((b, i) => {
  if (i % 3 !== 0 && i !== games[0].boards.length - 1) return;
  console.log(`  r${String(i + 1).padStart(2)}: ${b.map(s => s.id + '★' + s.star).join(', ') || '(empty)'}`);
});

let fail = 0;
const check = (c, m) => { if (!c) { console.log('FAIL: ' + m); fail++; } };
check(continuity > 0.7, `roster continuity ${pct(continuity)} should exceed 70%`);
check(tripleStacks === 0, `${tripleStacks} boards had 3+ copies at one star — merging is not firing`);
check(dupOverBetter === 0, `${dupOverBetter} final boards fielded a duplicate while a better unit sat benched`);
check(tinyBoards === 0, `${tinyBoards} boards of <=1 unit after round 3`);
check(avgDistinct <= 6.5, `uses ${avgDistinct.toFixed(1)} distinct fighters; a committed comp should be <=6.5`);
check(starByRound[ROUNDS - 1].sum / starByRound[ROUNDS - 1].n > 1.5, 'late boards should average above 1.5 stars');
console.log(fail === 0 ? '\nAI BEHAVES LIKE A PLAYER' : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
