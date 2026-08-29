// Hex grid math for the autochess board.
//
// Layout matches TFT: pointy-top hexes in odd-r offset rows (odd rows pushed
// half a hex to the right), 7 columns x 8 rows. Rows 0-3 are the enemy half
// (far side, -Z), rows 4-7 are the player's half (near side, +Z).
//
// Offset (col,row) is the canonical cell id — it's what the UI and save state
// speak. Axial (q,r) is derived on demand for distance/neighbour/path queries,
// because hex distance is only cheap in cube space.

/** Offset (col,row) is the canonical cell id; axial (q,r) is derived on demand. */
export interface Cell { col: number; row: number; }
export interface Axial { q: number; r: number; }
export interface Point { x: number; z: number; }

export const COLS = 7;
export const ROWS = 8;
export const HALF = ROWS / 2; // rows per side

// centre->corner. Tuned against the cage model: at board scale 10 the octagon's
// flat floor is ~8.4 across, and 0.58 keeps all 7 columns clear of the fence
// while leaving a 1.0-unit hex width for a 1.8m fighter to stand in.
export const SIZE = 0.58;
export const WIDTH = Math.sqrt(3) * SIZE; // hex width, = column pitch
export const ROW_PITCH = 1.5 * SIZE; // row-to-row depth

export const cellId = (col: number, row: number): number => row * COLS + col;
export const idCol = (id: number): number => id % COLS;
export const idRow = (id: number): number => Math.floor(id / COLS);
export const inBounds = (col: number, row: number): boolean => col >= 0 && col < COLS && row >= 0 && row < ROWS;
export const isPlayerHalf = (row: number): boolean => row >= HALF;

// ---- offset <-> axial ----
export function toAxial(col: number, row: number): Axial {
  return { q: col - ((row - (row & 1)) >> 1), r: row };
}

export function fromAxial(q: number, r: number): Cell {
  return { col: q + ((r - (r & 1)) >> 1), row: r };
}

// Cube distance. Axial (q,r) maps to cube (q, -q-r, r); the cube distance is
// half the L1 norm of the difference.
export function distance(a: Cell, b: Cell): number {
  const A = toAxial(a.col, a.row);
  const B = toAxial(b.col, b.row);
  const dq = A.q - B.q;
  const dr = A.r - B.r;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

const AXIAL_DIRS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

// The six neighbours of a cell, clipped to the board.
export function neighbours(col: number, row: number): Cell[] {
  const { q, r } = toAxial(col, row);
  const out: Cell[] = [];
  for (const [dq, dr] of AXIAL_DIRS) {
    const c = fromAxial(q + dq, r + dr);
    if (inBounds(c.col, c.row)) out.push(c);
  }
  return out;
}

// ---- world space ----
// The grid is centred on the board origin; callers add the floor height.
const X0 = -((COLS - 1) * WIDTH + WIDTH / 2) / 2;
const Z0 = -((ROWS - 1) * ROW_PITCH) / 2;

export function cellToWorld(col: number, row: number, out: Point = { x: 0, z: 0 }): Point {
  out.x = X0 + col * WIDTH + (row & 1 ? WIDTH / 2 : 0);
  out.z = Z0 + row * ROW_PITCH;
  return out;
}

export const gridWidth = COLS * WIDTH + WIDTH / 2;
export const gridDepth = (ROWS - 1) * ROW_PITCH + 2 * SIZE;

// Nearest cell to a world point, or null if the point is outside every hex.
// Uses cube rounding (round each cube axis, then fix up the one that drifted
// most) — picking the nearest centre by Euclidean distance is wrong near the
// shared corners where three hexes meet.
export function worldToCell(x: number, z: number): Cell | null {
  // Inverse of cellToWorld. Substituting col = q + (r - (r&1))/2 into that
  // function collapses the odd-row half-hex shift into the r/2 term:
  //   x = X0 + WIDTH * (q + r/2)   =>   q = (x - X0)/WIDTH - r/2
  // Subtracting an extra WIDTH/2 here (as an earlier version did) offsets q by
  // exactly half a hex, which puts every CELL CENTRE precisely on a .5 rounding
  // boundary. That still round-trips exact float input by luck — Math.round(-0.5)
  // is -0 — but a centre reached via raycast carries a few ulps of noise and
  // flips to the neighbouring column, so clicks landed one hex off.
  const r = (z - Z0) / ROW_PITCH;
  const q = (x - X0) / WIDTH - r / 2;
  let cq = Math.round(q);
  let cr = Math.round(r);
  const cs = Math.round(-q - r);
  const dq = Math.abs(cq - q);
  const dr = Math.abs(cr - r);
  const ds = Math.abs(cs - (-q - r));
  if (dq > dr && dq > ds) cq = -cr - cs;
  else if (dr > ds) cr = -cq - cs;
  const cell = fromAxial(cq, cr);
  return inBounds(cell.col, cell.row) ? cell : null;
}

// All cells, in row-major order.
export function allCells(): Cell[] {
  const out: Cell[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) out.push({ col, row });
  }
  return out;
}

// Breadth-first step toward `goal` that avoids occupied cells.
// `blocked(col,row)` reports cells holding (or reserved by) another living
// unit. Returns the first cell on a shortest free path, or null when walled in.
//
// TFT units re-path every time they finish a step rather than following a
// cached route, so this runs per-step and stays cheap on a 56-cell board.
//
// The flood runs FROM the goal so every cell learns its true distance, and the
// first step is chosen by (distance, then Euclidean closeness to the goal).
// Walking a BFS parent chain instead inherits AXIAL_DIRS' fixed scan order as
// the tie-break — which is not mirror-symmetric, so two mirrored armies drifted
// the same absolute direction and one side systematically won the lane
// contention. That alone skewed 6v6 mirror matches to 8%/92%.
export function stepToward(from: Cell, goal: Cell, blocked: (col: number, row: number) => boolean): Cell | null {
  if (from.col === goal.col && from.row === goal.row) return null;
  const N = COLS * ROWS;
  const dist = new Int16Array(N).fill(-1);
  const goalId = cellId(goal.col, goal.row);
  dist[goalId] = 0;

  let frontier: Cell[] = [goal];
  while (frontier.length) {
    const next: Cell[] = [];
    for (const cur of frontier) {
      const d = dist[cellId(cur.col, cur.row)];
      for (const nb of neighbours(cur.col, cur.row)) {
        const id = cellId(nb.col, nb.row);
        if (dist[id] !== -1) continue;
        if (blocked(nb.col, nb.row)) continue;
        dist[id] = d + 1;
        next.push(nb);
      }
    }
    frontier = next;
  }

  const gw = cellToWorld(goal.col, goal.row, { x: 0, z: 0 });
  const w = { x: 0, z: 0 };
  let best: Cell | null = null, bestD = Infinity, bestE = Infinity;
  for (const nb of neighbours(from.col, from.row)) {
    const id = cellId(nb.col, nb.row);
    if (id === goalId) continue; // the goal hex holds the target itself
    const d = dist[id];
    if (d === -1) continue; // blocked or unreachable
    cellToWorld(nb.col, nb.row, w);
    const e = (w.x - gw.x) * (w.x - gw.x) + (w.z - gw.z) * (w.z - gw.z);
    if (d < bestD || (d === bestD && e < bestE)) {
      best = nb; bestD = d; bestE = e;
    }
  }
  return best;
}
