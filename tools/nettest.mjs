// Plays a full online match between two NetMatch peers over a mock transport,
// then checks the two sides computed byte-identical results. A desync here is
// invisible in normal play until the two players see different winners, so this
// asserts on the whole resolution, not just the outcome.
const L = '../src/tft/';
const { NetMatch, roundSeed, canonicalUnits } = await import(L + 'netmatch.js');
const { Combat, CombatUnit, setCombatRng, ROUND_TIME, playerDamage } = await import(L + 'combat.js');
const { UNIT_BY_ID, UNITS } = await import(L + 'units.js');
const Hex = await import(L + 'hex.js');

const STEP = 1 / 60;
const seeded = s0 => { let s = s0 | 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL: ' + m); fail++; } else console.log('  ok: ' + m); };

// ---- mock transport: two peers, optional latency/reordering ----
function link(opts = {}) {
  const q = [];
  const peers = {};
  const post = (to, msg) => q.push({ to, msg: JSON.parse(JSON.stringify(msg)) });
  const flush = () => {
    // deliver in a deliberately awkward order to prove ordering does not matter
    while (q.length) {
      const batch = q.splice(0, q.length);
      if (opts.reorder) batch.reverse();
      for (const { to, msg } of batch) peers[to].onMessage(msg);
    }
  };
  return { post, peers, flush };
}

// Resolve a round exactly the way the game will: canonical order, shared seed.
function resolveRound(round, hostBoard, guestBoard, seed, stage) {
  setCombatRng(seeded(seed));
  const mk = (s, team) => new CombatUnit(UNIT_BY_ID[s.id], s.star, team, Hex.idCol(s.cell), Hex.idRow(s.cell));
  const units = canonicalUnits(hostBoard, guestBoard, mk);
  const log = [];
  const c = new Combat(units, {
    onDamage: (src, tgt, d, ty, crit) => log.push(`${src.unit.id}>${tgt.unit.id}:${d.toFixed(6)}${crit ? '!' : ''}`),
    onDeath: u => log.push(`X${u.unit.id}`),
  });
  let g = Math.ceil((ROUND_TIME + 5) / STEP);
  while (!c.over && g-- > 0) c.update(STEP);
  const winner = c.winner;
  const survivors = winner ? c.living(winner) : [];
  return { winner, t: c.t.toFixed(6), dmg: winner ? playerDamage(stage, survivors) : 0, trace: log.join('|') };
}

// A peer: local roster + the shared protocol.
function makePeer(name, isHost, post, rand) {
  const state = { name, hp: 100, oppHp: 100, results: [], over: false };
  const nm = new NetMatch({
    isHost,
    send: msg => post(isHost ? 'guest' : 'host', msg),
    hooks: {
      onResolve: (round, hostBoard, guestBoard, seed) => {
        const stage = Math.min(8, 1 + Math.ceil(round / 5));
        const r = resolveRound(round, hostBoard, guestBoard, seed, stage);
        // host is 'player', guest is 'enemy' — canonical on BOTH peers
        const iAmHost = isHost;
        const iWon = r.winner === (iAmHost ? 'player' : 'enemy');
        const drawn = r.winner === null;
        if (!drawn) { if (iWon) state.oppHp -= r.dmg; else state.hp -= r.dmg; }
        state.hp = Math.max(0, state.hp); state.oppHp = Math.max(0, state.oppHp);
        // shared facts both peers MUST agree on, with no local perspective in them
        state.results.push(`r${round} ${r.winner ?? 'draw'} t=${r.t} dmg=${r.dmg}`);
        state.view = state.view || []; state.view.push(`hp=${state.hp}/${state.oppHp}`);
        state.traces = state.traces || []; state.traces.push(r.trace);
        if (state.hp <= 0 || state.oppHp <= 0) state.over = true;
      },
    },
  });
  state.nm = nm;
  // random-but-legal board on this peer's own half
  state.makeBoard = round => {
    const rows = isHost ? [6, 7] : [1, 0];
    const n = Math.min(6, 2 + Math.floor(round * 0.5));
    const out = [];
    const used = new Set();
    for (let i = 0; i < n; i++) {
      const u = UNITS[Math.floor(rand() * UNITS.length)];
      let col, row, id;
      do { col = Math.floor(rand() * Hex.COLS); row = rows[Math.floor(rand() * rows.length)]; id = Hex.cellId(col, row); } while (used.has(id));
      used.add(id);
      out.push({ id: u.id, star: rand() < 0.3 ? 2 : 1, cell: id });
    }
    return out;
  };
  return state;
}

console.log('=== full 12-round match over a mock transport ===');
{
  const { post, peers, flush } = link();
  const rand = seeded(20260827);
  const host = makePeer('host', true, post, rand);
  const guest = makePeer('guest', false, post, rand);
  peers.host = host.nm; peers.guest = guest.nm;

  host.nm.start(0x5eed1234); flush();
  ok(guest.nm.started && guest.nm.seed === host.nm.seed, `guest received the seed (${guest.nm.seed})`);

  for (let round = 1; round <= 12 && !host.over && !guest.over; round++) {
    host.nm.submitBoard(round, host.makeBoard(round));
    guest.nm.submitBoard(round, guest.makeBoard(round));
    flush();
  }
  ok(host.results.length === guest.results.length, `both resolved ${host.results.length} rounds`);
  const same = host.results.every((r, i) => r === guest.results[i]);
  ok(same, 'every round produced an identical result on both peers');
  const pair = v => v.replace('hp=', '').split('/').map(Number);
  ok(host.view.every((v, i) => { const [a, b] = pair(v), [c, d] = pair(guest.view[i]); return a === d && b === c; }),
     'each peer sees the same HP pair, mirrored to its own perspective');
  const tracesSame = host.traces.every((t, i) => t === guest.traces[i]);
  ok(tracesSame, 'every damage event matched, in order, on both peers');
  ok(host.hp === guest.oppHp && host.oppHp === guest.hp, `HP agrees: host ${host.hp}/${host.oppHp}, guest ${guest.hp}/${guest.oppHp}`);
  console.log('  last 3 rounds:');
  host.results.slice(-3).forEach((r, i) => console.log(`    ${r}  host sees ${host.view.slice(-3)[i]}, guest sees ${guest.view.slice(-3)[i]}`));
}

console.log('\n=== out-of-order delivery must not matter ===');
{
  const { post, peers, flush } = link({ reorder: true });
  const rand = seeded(99);
  const host = makePeer('host', true, post, rand);
  const guest = makePeer('guest', false, post, rand);
  peers.host = host.nm; peers.guest = guest.nm;
  host.nm.start(4242); flush();
  for (let round = 1; round <= 8; round++) {
    // guest answers before the host this time
    guest.nm.submitBoard(round, guest.makeBoard(round));
    host.nm.submitBoard(round, host.makeBoard(round));
    flush();
  }
  ok(host.results.length === 8 && guest.results.length === 8, 'both resolved 8 rounds');
  ok(host.results.every((r, i) => r === guest.results[i]), 'results identical despite reversed delivery');
}

console.log('\n=== a round only resolves when BOTH boards arrive ===');
{
  const { post, peers, flush } = link();
  const rand = seeded(7);
  const host = makePeer('host', true, post, rand);
  const guest = makePeer('guest', false, post, rand);
  peers.host = host.nm; peers.guest = guest.nm;
  host.nm.start(1); flush();
  host.nm.submitBoard(1, host.makeBoard(1)); flush();
  ok(host.results.length === 0, 'host waits with only its own board in');
  ok(host.nm.waitingFor(1), 'waitingFor(1) reports the stall');
  guest.nm.submitBoard(1, guest.makeBoard(1)); flush();
  ok(host.results.length === 1 && guest.results.length === 1, 'resolves once the second board lands');
}

console.log('\n=== duplicate submits are ignored ===');
{
  const { post, peers, flush } = link();
  const rand = seeded(11);
  const host = makePeer('host', true, post, rand);
  const guest = makePeer('guest', false, post, rand);
  peers.host = host.nm; peers.guest = guest.nm;
  host.nm.start(2); flush();
  const b = host.makeBoard(1);
  ok(host.nm.submitBoard(1, b) === true, 'first submit accepted');
  ok(host.nm.submitBoard(1, host.makeBoard(1)) === false, 'second submit for the same round refused');
  guest.nm.submitBoard(1, guest.makeBoard(1)); flush();
  ok(host.results.length === 1, 'still exactly one resolution');
}

console.log('\n=== round seeds decorrelate ===');
{
  const seeds = Array.from({ length: 8 }, (_, i) => roundSeed(12345, i + 1));
  ok(new Set(seeds).size === 8, `8 rounds produced 8 distinct seeds`);
  ok(roundSeed(1, 1) !== roundSeed(2, 1), 'different match seeds differ');
}

console.log(fail === 0 ? '\nONLINE AUTOCHESS STAYS IN SYNC' : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
