// Autochess mode: round flow, opponent generation, and the bridge between the
// pure combat sim and the 3D board.
//
// Phase loop mirrors TFT: PLANNING (buy, position, level) -> COMBAT (hands off,
// the sim resolves) -> RESOLVE (damage, gold, streak) -> next round.

import * as THREE from 'three';
import * as Hex from './hex.ts';
import { Board3D } from './board3d.ts';
import { UnitView } from './unitview.ts';
import { UNIT_BY_ID, sellValue, statsFor, abilityText } from './units.ts';
import { AiOpponent } from './ai.ts';
import { NetMatch, canonicalUnits } from './netmatch.ts';
import { Combat, CombatUnit, setCombatRng, ROUND_TIME, playerDamage } from './combat.ts';
import { seededRng } from '../octagon/fight.ts';
import {
  Pool, Roster, Economy, setShopRng,
  SHOP_SIZE, REROLL_COST, XP_PER_ROUND, BENCH_SLOTS, boardCapacity,
} from './shop.ts';

import type { Entry, Unit, StarStats, BoardSpec, AiBoardSpec, Ability } from './types.ts';
import type { Team, CombatHooks, DamageType } from './combat.ts';
import type { Highlight } from './board3d.ts';
import type { LoadedAssets } from '../../anim.ts';
import type { Payout } from './shop.ts';

export const PHASE = { PLANNING: 'planning', COMBAT: 'combat', RESOLVE: 'resolve', OVER: 'over' } as const;
export type Phase = typeof PHASE[keyof typeof PHASE];

/** Sound + music hooks the mode calls; main.ts supplies the real FX object. */
export interface ModeFx {
  impact?: (kind: 'punch' | 'kick', heavy: boolean, crit: boolean) => void;
  critVoice?: (cfg: Unit['cfg']) => void;
  duckMusic?: () => void;
  startMusic?: () => void;
  stopMusic?: () => void;
  bell?: () => void;
}

/** What the HUD implements. Kept structural so mode.ts never imports ui.ts. */
export interface ModeUi {
  onState(s: Snapshot): void;
  onToast(msg: string): void;
  onRoundEnd(r: RoundResult): void;
  onGameOver(s: Snapshot): void;
  onMerge(m: { entry: Entry; star: number }): void;
  onCast(u: CombatUnit): void;
  onFloatDamage?: (u: CombatUnit, amount: number, crit: boolean, type: DamageType) => void;
  onFloatHeal?: (u: CombatUnit, amount: number) => void;
}

export interface ModeOpts {
  scene: THREE.Scene;
  camera: THREE.Camera;
  assets: LoadedAssets;
  fx: ModeFx | null;
  ui: ModeUi | null;
}

/** Transport handed in when playing online; omitted for solo vs the AI. */
export interface NetTransport { isHost: boolean; send: (msg: unknown) => void; }

export interface RoundResult {
  won: boolean; dmg: number; aiDmg: number; pay: Payout; draw: boolean; aiHp: number;
}

export interface ShopCard {
  id: string;
  unit: Unit;
  progress: { star: number; have: number; need: number };
  /** the star level buying this card would complete right now, or null */
  upgrade: number | null;
  affordable: boolean;
}

export interface EnemyRow {
  unit: Unit; star: number; hp: number; maxHp: number;
  frac: number; mana: number; alive: boolean;
}

export interface Detail {
  entry: Entry | null;
  unit: Unit;
  star: number;
  stats: StarStats;
  ability: Ability;
  abilityText: string;
  sellFor: number | null;
  onBoard: boolean;
}

export interface Snapshot {
  phase: Phase; timer: number; stage: number; round: number; label: string;
  gold: number; hp: number; level: number; xp: number; xpNext: number; streak: number;
  capacity: number; onBoard: number; frozen: boolean;
  shop: (ShopCard | null)[];
  bench: { entry: Entry; unit: Unit; star: number }[];
  board: { entry: Entry; unit: Unit; star: number; cell: number | null }[];
  selected: Entry | null;
  detail: Detail | null;
  enemy: EnemyRow[];
  aiHp: number; aiLevel: number;
  online: boolean; waitingForPeer: boolean; aiGold: number; victory: boolean;
}

export const PLANNING_TIME = 30;   // seconds to shop and position
export const RESOLVE_TIME = 3.2;   // beat between the last death and the next planning phase
const STAGE1_ROUNDS = 3;
const STAGE_ROUNDS = 5;

export class AutochessMode {
  // `assets` is the loadAssets() result plus a per-rig lookup.
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly assets: LoadedAssets;
  readonly fx: ModeFx | null;
  ui: ModeUi | null;
  readonly board: Board3D;
  active: boolean;
  phase: Phase;
  /** entry.uid -> view */
  readonly views: Map<number, UnitView>;
  enemyViews: UnitView[];
  combat: Combat | null;
  highlights: Map<number, Highlight>;
  paused: boolean;
  private _hover: number | null = null;

  net: NetTransport | null = null;
  netMatch: NetMatch | null = null;
  isHost = true;
  myTeam: Team = 'player';
  oppTeam: Team = 'enemy';
  oppHp = 100;
  myRows: number[] = [];
  waitingForPeer = false;
  pool!: Pool;
  roster!: Roster;
  ai: AiOpponent | null = null;
  econ!: Economy;
  stage = 1;
  round = 1;
  roundIndex = 1;
  timer = 0;
  selected: Entry | null = null;
  frozen = false;
  victory = false;
  shop: (string | null)[] = [];
  dmgRound: Record<string, number> = {};
  dmgTotal: Record<string, number> = {};
  lastResult?: RoundResult;

  constructor({ scene, camera, assets, fx, ui }: ModeOpts) {
    this.scene = scene;
    this.camera = camera;
    this.assets = assets;
    this.fx = fx;
    this.ui = ui;

    this.board = new Board3D(scene);
    this.active = false;
    this.phase = PHASE.PLANNING;
    this.views = new Map();   // entry.uid -> UnitView
    this.enemyViews = [];
    this.combat = null;
    this.highlights = new Map();
    // Freezes the phase clock and the battle sim without tearing anything
    // down — used by the pause control and by scripted testing, where rounds
    // would otherwise advance between one inspection and the next.
    this.paused = false;
  }

  async load(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    await this.board.load(onProgress);
  }

  // ---- lifecycle ----
  // `net` is { isHost, send } when playing online; omit it for solo vs the AI.
  start(net: NetTransport | null = null): void {
    setCombatRng(null);
    setShopRng(null);

    // Canonical coordinates: the HOST always owns rows 4-7 and the guest rows
    // 0-3, on both peers. The guest's SCREEN is rotated instead of its data, so
    // there is no mirroring maths that could drift between the two sides.
    this.net = net;
    this.isHost = !net || net.isHost;
    this.myTeam = this.isHost ? 'player' : 'enemy';
    this.oppTeam = this.isHost ? 'enemy' : 'player';
    this.oppHp = 100;
    this.myRows = this.isHost ? [4, 5, 6, 7] : [0, 1, 2, 3];
    this.board.setFlipped(!this.isHost);
    this.netMatch = net ? new NetMatch({
      isHost: net.isHost,
      send: net.send,
      hooks: {
        onResolve: (round, hostBoard, guestBoard, seed) => this._runNetRound(round, hostBoard, guestBoard, seed),
        onPeerLeft: () => { this.ui?.onToast('Opponent left'); this.phase = PHASE.OVER; this.ui?.onGameOver(this.snapshot()); },
      },
    }) : null;
    this.waitingForPeer = false;
    this.pool = new Pool();
    this.roster = new Roster(this.pool);
    // shares the pool: the AI's purchases really do remove copies the player
    // could have bought, which is what makes a finite pool mean anything
    this.ai = net ? null : new AiOpponent(this.pool);
    this.econ = new Economy();
    this.econ.level = 2;      // TFT hands you a unit and a level before 1-1
    this.econ.gold = 3;
    this.stage = 1;
    this.round = 1;
    this.roundIndex = 1;
    this.selected = null;
    this.frozen = false;
    this.victory = false;
    // damage dealt by MY fighters, keyed by unitId: per-fight and whole-game.
    // Kept by champion rather than by roster entry — entries merge and sell,
    // but "how much has Cotne done for me" survives all of that.
    this.dmgRound = {};
    this.dmgTotal = {};
    this.active = true;
    this.board.setVisible(true);
    this.clearAll();
    this.shop = this.pool.roll(this.econ.level, SHOP_SIZE);
    this.beginPlanning();
  }

  stop(): void {
    this.active = false;
    this.board.setVisible(false);
    this.clearAll();
  }

  clearAll(): void {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    for (const v of this.enemyViews) v.dispose();
    this.enemyViews = [];
    this.combat = null;
  }

  isMyHalf(row: number): boolean { return this.myRows ? this.myRows.includes(row) : Hex.isPlayerHalf(row); }

  // My board in the wire format the peer expects.
  myBoardSpecs(): BoardSpec[] {
    return this.roster.board.map(e => ({ id: e.unitId, star: e.star, cell: e.cell as number }));
  }

  // Online: hand the board over and wait. The exchange is the barrier that
  // keeps both peers in lockstep, so there is no clock message to drift.
  submitNetBoard(): boolean {
    if (!this.netMatch) return false;
    const round = this.roundIndex;
    if (!this.roster.board.length) {
      this.ui?.onToast('Place at least one fighter on the board');
      return false;
    }
    if (this.netMatch.submitBoard(round, this.myBoardSpecs())) {
      this.waitingForPeer = true;
      this.phase = PHASE.COMBAT;   // locked in; no more shopping
      this.timer = ROUND_TIME;
      this.ui?.onToast('Waiting for your opponent…');
      this.ui?.onState(this.snapshot());
      return true;
    }
    return false;
  }

  // Both peers land here with identical arguments and run the identical fight.
  private _runNetRound(_round: number, hostBoard: BoardSpec[], guestBoard: BoardSpec[], seed: number): void {
    this.waitingForPeer = false;
    this.dmgRound = {};
    setCombatRng(seededRng(seed));
    this.phase = PHASE.COMBAT;
    this.timer = ROUND_TIME;

    const mk = (spec: BoardSpec, team: Team): CombatUnit => {
      const u = new CombatUnit(UNIT_BY_ID[spec.id], spec.star, team,
        Hex.idCol(spec.cell), Hex.idRow(spec.cell));
      u.spec = spec;
      return u;
    };
    const units = canonicalUnits(hostBoard, guestBoard, mk);

    // reuse my own views where the entry still exists; spawn throwaways for the
    // opponent's board exactly as the solo mode does for the AI
    for (const v of this.enemyViews) v.dispose();
    this.enemyViews = [];
    for (const cu of units) {
      const mine = cu.team === this.myTeam;
      if (mine) {
        const e = this.roster.board.find(x => x.cell === cu.spec!.cell && x.unitId === cu.spec!.id);
        cu.view = e ? this.views.get(e.uid) : null;
      }
      if (!cu.view) {
        const v = this.makeView(cu.unit, cu.star, mine ? 'player' : 'enemy');
        v.setPosition(cu.x, cu.z);
        v.faceToward(0, mine ? -6 : 6, 0, true);
        cu.view = v;
        this.enemyViews.push(v);
      }
      cu.view.setBarsVisible(true);
      cu.view.playIdle();
    }

    this.combat = new Combat(units, this.combatHooks());
    this.board.setGridMode(false);
    this.fx?.startMusic?.();
    this.ui?.onState(this.snapshot());
  }

  // ---- phases ----
  beginPlanning(): void {
    this.phase = PHASE.PLANNING;
    this.timer = PLANNING_TIME;
    this.combat = null;
    for (const v of this.enemyViews) v.dispose();
    this.enemyViews = [];

    // solo only: the AI shops and re-forms its board before the player acts.
    // It is handed its own life total first — its stabilise/roll-down logic
    // keys off HP, and a bot that thinks it is healthy saves while it dies.
    if (this.ai) { this.ai.econ.hp = this.oppHp; this.ai.takeTurn(this.roundIndex); }

    this.econ.grantXp(XP_PER_ROUND);
    this.syncViews();
    this.board.setGridMode(true);
    for (const e of this.roster.board) {
      const v = this.views.get(e.uid);
      if (!v) continue;
      v.showPlanningPlate();
      v.playSignature();
      v.faceToward(0, this.isHost ? -6 : 6, 0, true); // square up at the opponent
    }
    this.refreshHighlights();
    this.ui?.onState(this.snapshot());
  }

  beginCombat(): void {
    if (this.phase !== PHASE.PLANNING) return;
    if (this.netMatch) return void this.submitNetBoard();
    const placed = this.roster.board;
    if (!placed.length) {
      this.ui?.onToast('Place at least one fighter on the board');
      this.timer = Math.max(this.timer, 4);
      return;
    }
    this.phase = PHASE.COMBAT;
    this.timer = ROUND_TIME;
    this.dmgRound = {}; // the meter's ROUND tab covers the current/last fight

    const enemySpecs = this.previewEnemy();
    const playerUnits = placed.map(e => {
      const cell = e.cell as number;   // placed entries always hold one
      const u = new CombatUnit(UNIT_BY_ID[e.unitId], e.star, 'player', Hex.idCol(cell), Hex.idRow(cell));
      u.entryUid = e.uid;
      return u;
    });
    const enemyUnits = enemySpecs.map(s =>
      new CombatUnit(UNIT_BY_ID[s.id], s.star, 'enemy', s.col, s.row));

    // spawn enemy visuals
    for (const cu of enemyUnits) {
      const v = this.makeView(cu.unit, cu.star, 'enemy');
      v.setPosition(cu.x, cu.z);
      v.faceToward(0, 6, 0, true);
      cu.view = v;
      this.enemyViews.push(v);
    }
    for (const cu of playerUnits) {
      cu.view = (cu.entryUid !== undefined ? this.views.get(cu.entryUid) : undefined) ?? null;
    }

    this.combat = new Combat([...playerUnits, ...enemyUnits], this.combatHooks());
    for (const cu of [...playerUnits, ...enemyUnits]) {
      cu.view?.setBarsVisible(true);
      cu.view?.playIdle();
    }
    this.board.setGridMode(false);
    this.fx?.startMusic?.();
    this.ui?.onState(this.snapshot());
  }

  endCombat(winner: Team | null): void {
    if (this.phase !== PHASE.COMBAT) return;
    this.phase = PHASE.RESOLVE;
    this.timer = RESOLVE_TIME;
    // A draw (both boards wiped) is neutral: nobody takes damage and nobody
    // banks a streak. Treating `!won` as "the AI won" charged the player a loss
    // AND paid the AI a win off the same result.
    const draw = winner === null;
    const won = winner === this.myTeam;
    if (!draw) {
      this.econ.recordResult(won);
      this.ai?.settle(!won); // the AI banks its own income and streak too
    } else {
      this.econ.streak = 0;
      if (this.ai) { this.ai.econ.streak = 0; this.ai.econ.payout(); }
    }

    // Damage is symmetric: whoever loses the round takes it, from the winner's
    // surviving units. Without this the opponent was literally immortal and the
    // mode had no win condition at all — you could only ever lose.
    let dmg = 0, aiDmg = 0;
    if (!draw) {
      const survivors = this.combat ? this.combat.living(won ? this.myTeam : this.oppTeam) : [];
      const hit = playerDamage(this.stage, survivors);
      if (won) {
        aiDmg = hit;
        this.oppHp = Math.max(0, this.oppHp - hit);
        if (this.ai) this.ai.econ.hp = this.oppHp;
      } else {
        dmg = hit;
        this.econ.hp = Math.max(0, this.econ.hp - hit);
      }
    }
    const pay = this.econ.payout();
    this.lastResult = { won, dmg, aiDmg, pay, draw, aiHp: this.oppHp };
    this.ui?.onRoundEnd(this.lastResult);
    this.fx?.stopMusic?.();
    this.fx?.bell?.();
    if (this.econ.hp <= 0 || this.oppHp <= 0) {
      this.phase = PHASE.OVER;
      this.victory = this.oppHp <= 0 && this.econ.hp > 0;
      this.ui?.onGameOver(this.snapshot());
    }
    this.ui?.onState(this.snapshot());
  }

  nextRound(): void {
    this.roundIndex++;
    this.round++;
    const perStage = this.stage === 1 ? STAGE1_ROUNDS : STAGE_ROUNDS;
    if (this.round > perStage) { this.stage++; this.round = 1; }
    // A frozen shop survives the round transition, empty slots included — that
    // is the point: you hold a pair you cannot afford yet through to next round.
    if (!this.frozen) this.shop = this.pool.roll(this.econ.level, SHOP_SIZE);
    this.beginPlanning();
  }

  // The AI commits to its board once, at the start of planning, so the player
  // can scout a board that will not change under them. With a single opponent
  // there is no reason to hide it, and a board you cannot see is a board you
  // cannot counter.
  previewEnemy(): AiBoardSpec[] {
    return this.ai?.lastBoard || [];
  }

  toggleFreeze(): boolean {
    if (this.phase !== PHASE.PLANNING) return false;
    this.frozen = !this.frozen;
    this.ui?.onState(this.snapshot());
    return this.frozen;
  }

  // ---- opponent ----
  // The AI owns a roster, gold and a level and plays the same loop the player
  // does (see ai.js). Its board is therefore whatever it has actually managed
  // to buy and merge — it persists, concentrates on a few fighters, and climbs
  // its own level ladder rather than being conjured to match the player.

  // ---- combat <-> visuals ----
  combatHooks(): CombatHooks {
    return {
      castDuration: u => u.view?.castDuration() ?? 1.1,

      onMove: u => u.view?.playWalk(),
      onArrive: u => { if (u.state === 'idle') u.view?.playIdle(); },

      onAttackStart: (u, tgt, clip, dur) => {
        if (!u.view) return;
        if (tgt) u.view.faceToward(tgt.x, tgt.z, 0, true);
        u.view.playAttack(clip, dur);
      },

      onCastStart: (u, tgt, ability, dur) => {
        if (!u.view) return;
        if (tgt) u.view.faceToward(tgt.x, tgt.z, 0, true);
        u.view.playCast(ability.clip, dur);
        this.ui?.onCast(u);
      },

      onDamage: (src, tgt, dealt, type, crit) => {
        if (src.team === this.myTeam) {
          this.dmgRound[src.unit.id] = (this.dmgRound[src.unit.id] || 0) + dealt;
          this.dmgTotal[src.unit.id] = (this.dmgTotal[src.unit.id] || 0) + dealt;
        }
        tgt.view?.flash();
        tgt.view?.hit(src.x, src.z, crit ? 0.5 : 0.28);
        this.fx?.impact?.(type === 'magic' ? 'kick' : 'punch', dealt > tgt.maxHp * 0.12, crit);
        // the fighters have voice lines in the other modes; autochess had none
        // wired at all. critVoice throttles itself, so a busy board stays sane.
        if (crit && src.team === 'player') {
          this.fx?.critVoice?.(src.unit.cfg);
          this.fx?.duckMusic?.();
        }
        this.ui?.onFloatDamage?.(tgt, Math.round(dealt), crit, type);
      },

      onHeal: (u, amount) => this.ui?.onFloatHeal?.(u, Math.round(amount)),

      onDeath: unit => unit.view?.die(),

      onEnd: winner => this.endCombat(winner),
    };
  }

  makeView(unit: Unit, star: number, team: Team, entry: Entry | null = null): UnitView {
    const rig = unit.rig;
    const assets = {
      model: this.assets.models[unit.modelIndex],
      clips: this.assets.clipSets[rig],
      bindDelta: this.assets.overlayDeltas[rig],
    };
    return new UnitView(entry, unit, star, team, assets, this.board.unitRoot, this.scene);
  }

  // Bring UnitViews in line with the roster: create views for newly bought
  // units, drop views for sold ones, and park each one on its hex.
  syncViews(): void {
    const seen = new Set();
    for (const e of this.roster.entries) {
      seen.add(e.uid);
      let v: UnitView | undefined = this.views.get(e.uid);
      if (v && v.star !== e.star) { v.dispose(); this.views.delete(e.uid); v = undefined; }
      if (!v) {
        v = this.makeView(UNIT_BY_ID[e.unitId], e.star, 'player', e);
        this.views.set(e.uid, v);
      }
      // A unit that died last round keeps its roster entry, so its view comes
      // back still faded out and sunk under the floor. Revive before
      // positioning — reset() snaps the fighter to its start position.
      v.revive();
      if (e.cell === null) {
        v.setVisible(false);
      } else {
        v.setVisible(true);
        const w = Hex.cellToWorld(Hex.idCol(e.cell), Hex.idRow(e.cell));
        v.setPosition(w.x, w.z);
        v.faceToward(w.x, w.z - 6, 0, true);
      }
      // Board units carry their plate in both phases (star pips are the only
      // on-board read of star level); benched ones are hidden entirely.
      if (e.cell !== null && this.phase !== PHASE.COMBAT) v.showPlanningPlate();
    }
    for (const [uid, v] of [...this.views]) {
      if (!seen.has(uid)) { v.dispose(); this.views.delete(uid); }
    }
  }

  // ---- player actions ----
  buy(index: number): boolean {
    if (this.phase !== PHASE.PLANNING) return false;
    const id = this.shop[index];
    if (!id) return false;
    const unit = UNIT_BY_ID[id];
    if (!this.econ.canAfford(unit.cost)) { this.ui?.onToast('Not enough gold'); return false; }
    // a purchase that completes a merge is allowed even with a full bench,
    // because it does not actually consume a new slot
    const completesMerge = this.roster.entries.filter(e => e.unitId === id && e.star === 1).length >= 2;
    if (this.roster.benchFull() && !completesMerge) { this.ui?.onToast('Bench is full'); return false; }
    if (!this.pool.take(id)) { this.ui?.onToast('None left in the pool'); return false; }
    this.econ.spend(unit.cost);
    this.shop[index] = null;
    const { merged } = this.roster.add(id);
    this.syncViews();
    if (merged.length) this.ui?.onMerge(merged[merged.length - 1]);
    this.ui?.onState(this.snapshot());
    return true;
  }

  reroll(): boolean {
    if (this.phase !== PHASE.PLANNING) return false;
    if (!this.econ.spend(REROLL_COST)) { this.ui?.onToast('Not enough gold'); return false; }
    this.frozen = false; // paying to reroll obviously means you want new cards
    this.shop = this.pool.roll(this.econ.level, SHOP_SIZE);
    this.ui?.onState(this.snapshot());
    return true;
  }

  buyXp(): boolean {
    if (this.phase !== PHASE.PLANNING) return false;
    if (!this.econ.buyXp()) { this.ui?.onToast('Not enough gold'); return false; }
    this.ui?.onState(this.snapshot());
    return true;
  }

  sell(entry: Entry | null): boolean {
    if (this.phase !== PHASE.PLANNING || !entry) return false;
    this.econ.gold += sellValue(UNIT_BY_ID[entry.unitId].cost, entry.star);
    this.roster.remove(entry);
    if (this.selected === entry) this.selected = null;
    this.syncViews();
    this.refreshHighlights();
    this.ui?.onState(this.snapshot());
    return true;
  }

  // Move a roster entry onto a hex (or back to the bench with cell === null).
  place(entry: Entry | null, cell: number | null): boolean {
    if (this.phase !== PHASE.PLANNING || !entry) return false;
    if (cell !== null) {
      const row = Hex.idRow(cell);
      if (!this.isMyHalf(row)) { this.ui?.onToast('You can only place on your half'); return false; }
      const occupant = this.roster.at(cell);
      if (occupant && occupant !== entry) {
        // swap rather than reject — repositioning is constant in TFT
        occupant.cell = entry.cell;
        entry.cell = cell;
      } else {
        if (entry.cell === null && this.roster.board.length >= boardCapacity(this.econ.level)) {
          this.ui?.onToast(`Level ${this.econ.level} allows ${boardCapacity(this.econ.level)} on the board`);
          return false;
        }
        entry.cell = cell;
      }
    } else {
      if (this.roster.bench.length >= BENCH_SLOTS && entry.cell !== null) {
        this.ui?.onToast('Bench is full');
        return false;
      }
      entry.cell = null;
    }
    // Drop the unit once it lands. Holding on to it meant the NEXT tap on any
    // hex moved the same fighter again instead of picking up the one you
    // tapped, so selecting a different unit took two taps.
    this.selected = null;
    this.syncViews();
    this.refreshHighlights();
    this.ui?.onState(this.snapshot());
    return true;
  }

  select(entry: Entry | null): void {
    this.selected = this.selected === entry ? null : entry;
    this.refreshHighlights();
    this.ui?.onState(this.snapshot());
  }

  setHover(cell: number | null): void {
    if (this._hover === cell) return;
    this._hover = cell;
    this.refreshHighlights();
  }

  refreshHighlights(): void {
    const h = new Map<number, Highlight>();
    if (this.phase === PHASE.PLANNING) {
      if (this.selected) {
        for (const { col, row } of Hex.allCells()) {
          if (!this.isMyHalf(row)) continue;
          const id = Hex.cellId(col, row);
          h.set(id, this.roster.at(id) ? 'occupied' : 'valid');
        }
      }
      if (this._hover != null && this.isMyHalf(Hex.idRow(this._hover))) h.set(this._hover, 'hover');
    }
    this.highlights = h;
    this.board.setHighlights(h);
  }

  // ---- frame ----
  update(dt: number): void {
    if (!this.active || this.paused) return;

    if (this.phase === PHASE.PLANNING) {
      this.timer -= dt;
      if (this.timer <= 0) this.beginCombat();
    } else if (this.phase === PHASE.COMBAT) {
      this.timer -= dt;
      this.combat?.update(dt);
      if (this.combat) {
        for (const cu of this.combat.units) {
          if (!cu.view) continue;
          cu.view.setPosition(cu.x, cu.z);
          cu.view.setBars(cu.hp / cu.maxHp, cu.maxMana ? cu.mana / cu.maxMana : 0);
          if (cu.alive && cu.target) cu.view.faceToward(cu.target.x, cu.target.z, dt);
        }
      }
    } else if (this.phase === PHASE.RESOLVE) {
      this.timer -= dt;
      if (this.timer <= 0) this.nextRound();
    }

    for (const v of this.views.values()) v.update(dt, this.camera);
    for (const v of this.enemyViews) v.update(dt, this.camera);
  }

  // Rows for the damage meter, sorted hardest-hitting first.
  damageRows(which: 'round' | 'total'): { id: string; unit: Unit; dmg: number }[] {
    const src = which === 'total' ? this.dmgTotal : this.dmgRound;
    return Object.entries(src)
      .map(([id, dmg]) => ({ id, unit: UNIT_BY_ID[id], dmg }))
      .sort((a, b) => b.dmg - a.dmg);
  }

  snapshot(): Snapshot {
    return {
      phase: this.phase,
      timer: Math.max(0, this.timer || 0),
      stage: this.stage,
      round: this.round,
      label: `${this.stage}-${this.round}`,
      gold: this.econ.gold,
      hp: this.econ.hp,
      level: this.econ.level,
      xp: this.econ.xp,
      xpNext: this.econ.xpToNext(),
      streak: this.econ.streak,
      capacity: boardCapacity(this.econ.level),
      onBoard: this.roster.board.length,
      frozen: !!this.frozen,
      shop: this.shop.map(id => {
        if (!id) return null;
        const ones = this.roster.entries.filter(e => e.unitId === id && e.star === 1).length;
        const twos = this.roster.entries.filter(e => e.unitId === id && e.star === 2).length;
        return {
          id,
          unit: UNIT_BY_ID[id],
          progress: this.roster.copiesToward(id),
          // buying this card triggers a merge RIGHT NOW: a third 1-star copy
          // makes a 2-star; if two 2-stars are also waiting, it cascades to 3
          upgrade: ones % 3 === 2 ? (twos === 2 ? 3 : 2) : null,
          affordable: this.econ.gold >= UNIT_BY_ID[id].cost,
        };
      }),
      bench: this.roster.bench.map(e => ({ entry: e, unit: UNIT_BY_ID[e.unitId], star: e.star })),
      board: this.roster.board.map(e => ({ entry: e, unit: UNIT_BY_ID[e.unitId], star: e.star, cell: e.cell })),
      selected: this.selected,
      detail: this.detailFor(this.selected),
      enemy: this.enemyRoster(),
      aiHp: this.oppHp ?? 0,
      aiLevel: this.ai?.econ.level ?? 0,
      online: !!this.netMatch,
      waitingForPeer: !!this.waitingForPeer,
      aiGold: this.ai?.econ.gold ?? 0,
      victory: !!this.victory,
    };
  }

  // The opponent's board for the scout panel. During combat this reads live HP
  // straight off the sim; during planning it is the previewed line-up at full
  // health.
  enemyRoster(): EnemyRow[] {
    if (this.combat) {
      return this.combat.units
        .filter(u => u.team === 'enemy')
        .map(u => ({
          unit: u.unit, star: u.star,
          hp: Math.max(0, Math.round(u.hp)), maxHp: u.maxHp,
          frac: Math.max(0, u.hp / u.maxHp),
          mana: u.maxMana ? Math.min(1, u.mana / u.maxMana) : 0,
          alive: u.alive,
        }));
    }
    // Online there is nothing to scout: the opponent is still choosing, and
    // showing a half-built board would be worse than showing none.
    if (this.netMatch || this.phase !== PHASE.PLANNING) return [];
    return this.previewEnemy().map(s => {
      const unit = UNIT_BY_ID[s.id];
      const st = statsFor(unit, s.star);
      return {
        unit, star: s.star, hp: st.maxHp, maxHp: st.maxHp,
        frac: 1, mana: 0, alive: true,
      };
    });
  }

  // Everything the inspector panel needs about one unit. `entry` is null when
  // inspecting a shop card (nothing owned yet, so nothing to sell).
  detailFor(entry: Entry | null, unitId: string | null = null, star = 1): Detail | null {
    const id = entry ? entry.unitId : unitId;
    if (!id) return null;
    const unit = UNIT_BY_ID[id];
    const s = entry ? entry.star : star;
    return {
      entry,
      unit,
      star: s,
      stats: statsFor(unit, s),
      ability: unit.ability,
      abilityText: abilityText(unit, s),
      sellFor: entry ? sellValue(unit.cost, s) : null,
      onBoard: entry ? entry.cell !== null : false,
    };
  }
}
