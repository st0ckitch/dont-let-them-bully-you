// Round synchronisation for online autochess.
//
// Unlike the octagon modes — where a whole fight replays from one seed — each
// player makes free choices during planning, so nothing about their board is
// derivable. What IS derivable is the battle: combat.js is bit-deterministic
// (tools/determinism.mjs proves it over 200 seeds), so peers only have to
// exchange BOARDS. Each side then runs the identical fight locally and reaches
// the same result without streaming a single frame of state.
//
// Two invariants make that work, and both are enforced here:
//   1. Canonical coordinates. The host's half is rows 4-7, the guest's is rows
//      0-3, on BOTH peers. The guest's screen is rotated instead of its data,
//      so no mirroring maths can drift between the two sides.
//   2. Canonical order. The units array is always [host..., guest...]; feeding
//      the same units in a different order produces a different fight.
//
// This module is deliberately transport-agnostic and free of THREE/DOM so a
// two-peer match can be played out headlessly in a test.

import type { BoardSpec } from './types.ts';

export const AC_PROTOCOL = 1;

type Side = 'host' | 'guest';
type Board = BoardSpec[];

export interface NetMatchHooks {
  onStart?: (seed: number) => void;
  onResolve?: (round: number, host: Board, guest: Board, seed: number) => void;
  onPeerLeft?: () => void;
  onVersionMismatch?: (v: unknown) => void;
}

export interface NetMatchOpts {
  isHost: boolean;
  send: (msg: unknown) => void;
  hooks?: NetMatchHooks;
}

/** Anything arriving over the wire. Narrowed in onMessage before use. */
interface NetMessage {
  t: string;
  v?: number;
  seed?: number;
  round?: number;
  board?: Board;
}

// Per-round seed derived from the match seed, so both peers agree without
// spending a message on it. Integer hash (xorshift-ish) to decorrelate
// neighbouring rounds — round+1 must not look like round.
export function roundSeed(matchSeed: number, round: number): number {
  let h = (matchSeed ^ Math.imul(round + 1, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}

export class NetMatch {
  // `send` posts an object to the peer. `hooks.onResolve(round, host, guest, seed)`
  // fires exactly once per round, on both peers, with identical arguments.
  readonly isHost: boolean;
  private readonly send: (msg: unknown) => void;
  private readonly hooks: NetMatchHooks;
  seed: number | null;
  round: number;
  started: boolean;
  over: boolean;
  private readonly _boards: Map<number, Partial<Record<Side, Board>>>;
  private readonly _resolved: Set<number>;
  private readonly _localSubmitted: Set<number>;

  constructor({ isHost, send, hooks = {} }: NetMatchOpts) {
    this.isHost = isHost;
    this.send = send;
    this.hooks = hooks;
    this.seed = null;
    this.round = 0;
    this.started = false;
    this.over = false;
    this._boards = new Map(); // round -> { host, guest }
    this._resolved = new Set();
    this._localSubmitted = new Set();
  }

  get side(): Side { return this.isHost ? 'host' : 'guest'; }

  // Host opens the match; the seed is the only thing that has to be agreed.
  start(seed: number): boolean {
    if (!this.isHost) return false;
    this.seed = seed | 0;
    this.started = true;
    this.round = 1;
    this.send({ t: 'ac-start', v: AC_PROTOCOL, seed: this.seed });
    this.hooks.onStart?.(this.seed);
    return true;
  }

  // Hand over this peer's board for `round`. Safe to call twice; the second
  // call is ignored so a timer expiring next to a READY press cannot double-send.
  submitBoard(round: number, board: Board): boolean {
    if (!this.started || this.over) return false;
    if (this._localSubmitted.has(round)) return false;
    this._localSubmitted.add(round);
    this._record(round, this.side, board);
    this.send({ t: 'ac-board', round, board });
    this._maybeResolve(round);
    return true;
  }

  onMessage(msg: NetMessage | null | undefined): void {
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'ac-start':
        if (this.isHost) return;                 // only the guest accepts a start
        if (msg.v !== AC_PROTOCOL) { this.hooks.onVersionMismatch?.(msg.v); return; }
        this.seed = (msg.seed ?? 0) | 0;
        this.started = true;
        this.round = 1;
        this.hooks.onStart?.(this.seed);
        return;
      case 'ac-board': {
        if (!this.started) return;
        // a board from the peer is, by definition, the OTHER side
        const from = this.isHost ? 'guest' : 'host';
        this._record(msg.round!, from, msg.board!);
        this._maybeResolve(msg.round!);
        return;
      }
      case 'ac-bye':
        this.over = true;
        this.hooks.onPeerLeft?.();
        return;
    }
  }

  private _record(round: number, side: Side, board: Board): void {
    const slot = this._boards.get(round) || {};
    if (slot[side]) return; // never let a duplicate overwrite a committed board
    slot[side] = board;
    this._boards.set(round, slot);
  }

  // Fires only when BOTH boards for the round are in hand — the exchange is the
  // barrier that keeps the two peers in lockstep without a clock message.
  private _maybeResolve(round: number): void {
    if (this.over || this._resolved.has(round)) return;
    const slot = this._boards.get(round);
    if (!slot?.host || !slot?.guest) return;
    this._resolved.add(round);
    this._boards.delete(round);
    this.round = round + 1;
    this.hooks.onResolve?.(round, slot.host, slot.guest, roundSeed(this.seed!, round));
  }

  // True once this peer has sent its board and is waiting on the opponent.
  waitingFor(round: number): boolean {
    return this._localSubmitted.has(round) && !this._resolved.has(round);
  }

  leave(): void {
    if (this.over) return;
    this.over = true;
    try { this.send({ t: 'ac-bye' }); } catch { /* connection already gone */ }
  }
}

// Build the canonical units array both peers must agree on. Kept here, beside
// the protocol, because getting the ORDER wrong silently desyncs the match
// rather than throwing.
export function canonicalUnits<T>(hostBoard: Board, guestBoard: Board,
  makeUnit: (spec: BoardSpec, team: 'player' | 'enemy') => T): T[] {
  return [
    ...hostBoard.map(s => makeUnit(s, 'player')),
    ...guestBoard.map(s => makeUnit(s, 'enemy')),
  ];
}
