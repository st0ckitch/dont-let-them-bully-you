import * as H from '../src/tft/hex.js';

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('FAIL:', m); fail++; } };

// round-trip offset <-> axial for every cell
for (const { col, row } of H.allCells()) {
  const a = H.toAxial(col, row);
  const b = H.fromAxial(a.q, a.r);
  ok(b.col === col && b.row === row, `axial roundtrip ${col},${row} -> ${b.col},${b.row}`);
}

// worldToCell inverts cellToWorld exactly at centres
for (const { col, row } of H.allCells()) {
  const w = H.cellToWorld(col, row);
  const c = H.worldToCell(w.x, w.z);
  ok(c && c.col === col && c.row === row, `world roundtrip ${col},${row} -> ${c && c.col},${c && c.row}`);
}

// A cell centre must be the MOST stable point in the hex, not a knife edge.
// The picking path reaches a centre through a camera projection and a ray/plane
// intersection, so it arrives with a few ulps of error; an earlier version of
// worldToCell put every centre exactly on a .5 rounding boundary and survived
// the exact-float test above purely because Math.round(-0.5) is -0.
{
  let bad = 0;
  const eps = [1e-12, 1e-9, 1e-7, 1e-5];
  for (const { col, row } of H.allCells()) {
    const w = H.cellToWorld(col, row);
    for (const e of eps) {
      for (const [dx, dz] of [[e, 0], [-e, 0], [0, e], [0, -e], [e, e], [-e, -e], [e, -e], [-e, e]]) {
        const c = H.worldToCell(w.x + dx, w.z + dz);
        if (!c || c.col !== col || c.row !== row) {
          if (bad < 6) console.log(`  centre unstable: ${col},${row} +(${dx},${dz}) -> ${c ? c.col + ',' + c.row : 'null'}`);
          bad++;
        }
      }
    }
  }
  ok(bad === 0, `cell centres are stable under float noise (${bad} flips)`);
}

// and stable well inside the hex (inradius = SIZE*sqrt(3)/2)
{
  const inr = H.SIZE * Math.sqrt(3) / 2;
  let bad = 0;
  for (const { col, row } of H.allCells()) {
    const w = H.cellToWorld(col, row);
    for (let k = 0; k < 24; k++) {
      const ang = (k / 24) * Math.PI * 2;
      for (const frac of [0.3, 0.6, 0.85]) {
        const c = H.worldToCell(w.x + Math.cos(ang) * inr * frac, w.z + Math.sin(ang) * inr * frac);
        if (!c || c.col !== col || c.row !== row) bad++;
      }
    }
  }
  ok(bad === 0, `points inside the inradius resolve to their own cell (${bad} misses)`);
}

// neighbours are always distance 1, distance is symmetric
for (const { col, row } of H.allCells()) {
  for (const nb of H.neighbours(col, row)) {
    ok(H.distance({ col, row }, nb) === 1, `neighbour distance ${col},${row} -> ${nb.col},${nb.row}`);
    ok(H.distance(nb, { col, row }) === 1, 'symmetric');
  }
}
ok(H.neighbours(3, 3).length === 6, 'interior has 6 neighbours');
ok(H.neighbours(0, 0).length <= 4, 'corner has <=4');

// 180-degree board rotation must map to an exact world-space mirror — the
// combat sim relies on this for symmetric matchups
for (const { col, row } of H.allCells()) {
  const a = H.cellToWorld(col, row);
  const b = H.cellToWorld(H.COLS - 1 - col, H.ROWS - 1 - row);
  ok(Math.abs(a.x + b.x) < 1e-9 && Math.abs(a.z + b.z) < 1e-9,
    `rotation mirror ${col},${row}: (${a.x.toFixed(4)},${a.z.toFixed(4)}) vs (${b.x.toFixed(4)},${b.z.toFixed(4)})`);
}

// stepToward reaches the goal on an empty board, in exactly hex-distance steps
const none = () => false;
const dFar = H.distance({ col: 0, row: 0 }, { col: 6, row: 7 });
{
  let steps = 0, cur = { col: 0, row: 0 };
  const goal = { col: 6, row: 7 };
  // stepToward never steps ONTO the goal (its target stands there), so walk
  // until adjacent rather than until equal
  while (H.distance(cur, goal) > 1 && steps < 40) {
    const nx = H.stepToward(cur, goal, none);
    if (!nx) break;
    cur = nx; steps++;
  }
  ok(H.distance(cur, goal) <= 1, `stepToward closed to the goal (dist ${H.distance(cur, goal)}, ${steps} steps)`);
  ok(steps <= dFar, `path length ${steps} is no longer than hex distance ${dFar}`);
}

// routes around a wall without entering it
{
  const wall = (c, r) => c === 3 && r !== 0;
  let steps = 0, cur = { col: 0, row: 4 };
  const goal = { col: 6, row: 4 };
  while (H.distance(cur, goal) > 1 && steps < 60) {
    const nx = H.stepToward(cur, goal, wall);
    if (!nx) break;
    ok(!wall(nx.col, nx.row), `step entered a blocked cell ${nx.col},${nx.row}`);
    cur = nx; steps++;
  }
  ok(H.distance(cur, goal) <= 1, `routed around the wall (${steps} steps)`);
}

ok(H.stepToward({ col: 0, row: 0 }, { col: 6, row: 7 }, (c, r) => !(c === 0 && r === 0)) === null,
  'walled in returns null');

// Mirrored starts must produce mirrored paths, or lane contention favours one
// side and 6v6 mirror matches skew.
{
  let asym = 0;
  for (const [a, b] of [[{ col: 1, row: 6 }, { col: 5, row: 1 }], [{ col: 3, row: 7 }, { col: 3, row: 0 }]]) {
    const stepA = H.stepToward(a, b, none);
    const am = { col: H.COLS - 1 - a.col, row: H.ROWS - 1 - a.row };
    const bm = { col: H.COLS - 1 - b.col, row: H.ROWS - 1 - b.row };
    const stepB = H.stepToward(am, bm, none);
    const expect = { col: H.COLS - 1 - stepA.col, row: H.ROWS - 1 - stepA.row };
    if (stepB.col !== expect.col || stepB.row !== expect.row) {
      console.log(`  path asymmetry: ${a.col},${a.row}->${stepA.col},${stepA.row} but mirror gave ${stepB.col},${stepB.row}, expected ${expect.col},${expect.row}`);
      asym++;
    }
  }
  ok(asym === 0, `mirrored starts produce mirrored first steps (${asym} asymmetric)`);
}

console.log(`grid ${H.COLS}x${H.ROWS}  width=${H.gridWidth.toFixed(2)} depth=${H.gridDepth.toFixed(2)}  hexWidth=${H.WIDTH.toFixed(3)}`);
console.log(fail === 0 ? 'ALL HEX TESTS PASSED' : `${fail} FAILURES`);
process.exit(fail ? 1 : 0);
