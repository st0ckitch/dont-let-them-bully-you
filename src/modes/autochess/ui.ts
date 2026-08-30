import * as THREE from 'three';

/** tapify hands the handler an event whose target we have already narrowed. */
type TapEvent = Event & { target: HTMLElement | null };
// Autochess HUD: shop, bench, economy readouts and floating combat text.
//
// Built imperatively against a container the mode owns, so none of it exists
// (or costs anything) while the game is in auto-sim or control mode.

import { TIER_COLOR, sellValue, UNIT_BY_ID } from './units.ts';
import { PHASE, PLANNING_TIME, RESOLVE_TIME } from './mode.ts';
import { ROUND_TIME } from './combat.ts';
import { REROLL_COST, XP_COST, XP_PER_BUY, BENCH_SLOTS } from './shop.ts';
import type { AutochessMode, Snapshot, Detail, RoundResult, ModeUi } from './mode.ts';
import type { Entry } from './types.ts';
import type { CombatUnit, DamageType } from './combat.ts';

/** One floating damage/heal number, tracked to its unit until it fades. */
interface Floater {
  n: HTMLDivElement;
  unit: CombatUnit;
  t: number;
  dx: number;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

const STAR = '★';

// Activate on touch via pointerup, on mouse via click. iOS Safari has a
// compatibility behaviour that exists in NO other engine (it lives in the OS
// touch layer, so even desktop-WebKit tests pass): when a tap hits an element
// whose pointerover/mouseover handler visibly mutates the page, the tap is
// treated as a HOVER — the hover fires and the click is swallowed; only a
// second tap clicks. Our bench slots and shop cards show a preview panel on
// pointerover, which is exactly that pattern, so on iPhones one tap "did
// nothing". pointerup is always delivered, so touch runs on it instead, with
// a small movement guard so a drag is not a tap; the click path stays for
// mice, deduped so desktop browsers (which fire both) cannot double-activate.
// The touch-dedupe timestamp is SHARED across all elements, not stored per
// element: activating on pointerup usually re-renders the UI, so by the time
// the browser dispatches the trailing click it hit-tests onto a NEWLY-BUILT
// element whose own timer would know nothing about the tap — and the action
// would run twice. (Observed: one tap on a bench slot selected and instantly
// de-selected.) One shared clock kills the trailing click no matter which
// element it lands on.
let lastTouchActivation = 0;
const tapify = (el: HTMLElement, fn: (e: TapEvent) => void): void => {
  let sx = 0, sy = 0;
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') { sx = e.clientX; sy = e.clientY; }
  });
  el.addEventListener('pointerup', e => {
    if (e.pointerType === 'mouse') return;
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 14) return;
    lastTouchActivation = performance.now();
    fn(e as TapEvent);
  });
  el.addEventListener('click', e => {
    if (performance.now() - lastTouchActivation < 700) return; // tap already handled
    fn(e as TapEvent);
  });
};

export class AutochessUI implements ModeUi {
  private readonly root: HTMLElement;
  private readonly mode: AutochessMode;
  private readonly portraits: Record<string, string>;
  private floaters: Floater[];
  private last?: Snapshot;
  private _hoverDetail: Detail | null = null;
  private _hoverSlot: number | null = null;
  private _detOpen = false;
  private _foeOpen = true;
  private _meterOpen = true;
  private _meterTab: 'round' | 'total' = 'round';
  private _hideT?: ReturnType<typeof setTimeout>;
  private _toastT?: ReturnType<typeof setTimeout>;
  private _bannerT?: ReturnType<typeof setTimeout>;
  private _foeT = 0;
  private _meterT = 0;
  private _v?: THREE.Vector3;
  private _onKey!: (e: KeyboardEvent) => void;

  private top!: HTMLElement; private stageLabel!: HTMLElement; private phaseLabel!: HTMLElement;
  private timerBar!: HTMLElement; private timerFill!: HTMLElement; private buildTag!: HTMLElement;
  private rail!: HTMLElement; private hpBox!: HTMLElement; private levelBox!: HTMLElement;
  private capBox!: HTMLElement; private streakBox!: HTMLElement; private detail!: HTMLElement;
  private bottom!: HTMLElement; private benchRow!: HTMLElement; private shopSide!: HTMLElement;
  private goldBox!: HTMLElement; private xpBtn!: HTMLButtonElement; private rollBtn!: HTMLButtonElement;
  private cards!: HTMLElement; private cardsWrap!: HTMLElement; private freezeBtn!: HTMLButtonElement;
  private actions!: HTMLElement; private foe!: HTMLElement; private meter!: HTMLElement;
  private right!: HTMLElement; private readyBtn!: HTMLButtonElement; private toast!: HTMLElement;
  private floatLayer!: HTMLElement; private banner!: HTMLElement;

  constructor(root: HTMLElement, mode: AutochessMode,
    { portraits = {} }: { portraits?: Record<string, string> } = {}) {
    this.root = root;
    this.mode = mode;
    this.portraits = portraits;
    this.floaters = [];
    this._build();
  }

  private _build(): void {
    this.root.innerHTML = '';
    this.root.classList.add('acRoot');

    // ---- top bar: stage, phase, timer ----
    this.top = el('div', 'acTop');
    this.stageLabel = el('div', 'acStage', '1-1');
    this.phaseLabel = el('div', 'acPhase', 'PLANNING');
    this.timerBar = el('div', 'acTimerBar');
    this.timerFill = el('div', 'acTimerFill');
    this.timerBar.appendChild(this.timerFill);
    this.buildTag = el('div', 'acBuild', window.__BUILD || '');
    this.top.append(this.stageLabel, this.phaseLabel, this.timerBar, this.buildTag);

    // ---- left rail: player state ----
    this.rail = el('div', 'acRail');
    this.hpBox = el('div', 'acHp', '<span class="acHpVal">100</span><span class="acHpLbl">HP</span>');
    this.levelBox = el('div', 'acLevel');
    this.capBox = el('div', 'acCap');
    this.streakBox = el('div', 'acStreak');
    this.rail.append(this.hpBox, this.levelBox, this.capBox, this.streakBox);

    // ---- inspector: stats, ability, sell ----
    this.detail = el('div', 'acDetail hidden');
    tapify(this.detail, e => {
      if (!e.target?.closest('[data-sell]')) {
        // on phones the panel is a compact bar; tapping it opens the full card
        this._detOpen = !this._detOpen;
        this.detail.classList.toggle('acDetOpen', this._detOpen);
        return;
      }
      const entry = this._hoverDetail?.entry || this.mode.selected;
      if (!entry) return;
      // drop the hover first: it points at an entry that is about to stop
      // existing, and onState() would render it right back
      this._hoverDetail = null;
      this._cancelHide();
      this.mode.sell(entry);
    });
    // Keep the panel alive while the pointer is on it, so the Sell button is
    // actually reachable after hovering a bench slot.
    this.detail.addEventListener('pointerenter', () => this._cancelHide());
    this.detail.addEventListener('pointerleave', () => this._scheduleHide());

    // ---- bench + shop ----
    // One grid owns the whole bottom cluster: bench in the upper row, shop in
    // the lower, both in the same column so the bench sits directly above the
    // cards. They used to be separately absolute-positioned off `bottom`, which
    // silently collided the moment the shop grew a row (it did, when the freeze
    // bar was added).
    this.bottom = el('div', 'acBottom');
    this.benchRow = el('div', 'acBench');
    this.shopSide = el('div', 'acShopSide');

    this.goldBox = el('div', 'acGold', '<b>0</b><span>gold</span>');
    this.xpBtn = el('button', 'acSideBtn acXp');
    this.rollBtn = el('button', 'acSideBtn acRoll');
    this.shopSide.append(this.goldBox, this.xpBtn, this.rollBtn);

    this.cards = el('div', 'acCards');
    this.cardsWrap = el('div', 'acCardsWrap');
    this.freezeBtn = el('button', 'acFreeze');
    tapify(this.freezeBtn, () => this.mode.toggleFreeze());
    // Freeze and START ROUND share a row inside the bottom cluster. On desktop
    // .acReady is absolutely positioned and so leaves this flow untouched; on a
    // phone it stays in the row, because floating it over the board covered the
    // two bottom-right hexes and made them impossible to place on.
    this.actions = el('div', 'acActions');
    this.cardsWrap.append(this.benchRow, this.cards, this.actions);
    this.bottom.append(this.shopSide, this.cardsWrap);

    // ---- right column: opponent scout + damage meter ----
    // Desktop opens both; phones start them collapsed to a one-line chip —
    // screen space is the scarce resource there, and both are reference
    // panels, not controls.
    const mobile = matchMedia('(max-width: 700px)').matches;
    this._foeOpen = !mobile;
    this._meterOpen = !mobile;
    this._meterTab = 'round';
    this.foe = el('div', 'acFoe');
    this.meter = el('div', 'acMeter hidden');
    this.right = el('div', 'acRight');
    this.right.append(this.foe, this.meter);
    // headers toggle, tabs switch — delegated so re-renders cannot orphan them
    tapify(this.foe, e => {
      if (e.target?.closest('.acFoeHead')) { this._foeOpen = !this._foeOpen; this._renderFoe(this.last || {}); }
    });
    tapify(this.meter, e => {
      const tab = e.target?.closest<HTMLElement>('[data-tab]');
      if (tab) { this._meterTab = tab.dataset['tab'] === 'total' ? 'total' : 'round'; this._renderMeter(); return; }
      if (e.target?.closest('.acMeterHead')) { this._meterOpen = !this._meterOpen; this._renderMeter(); }
    });

    this.readyBtn = el('button', 'acReady', 'START ROUND');
    this.toast = el('div', 'acToast hidden');
    this.floatLayer = el('div', 'acFloat');
    this.banner = el('div', 'acBanner hidden');

    // the inspector lives in the rail column so it always flows BELOW the
    // stats boxes — an absolute offset silently collides the moment the rail
    // gains a row (it did, when board capacity got its own readout)
    this.rail.append(this.detail);
    this.actions.append(this.freezeBtn, this.readyBtn);
    this.root.append(this.top, this.rail, this.right, this.floatLayer, this.bottom, this.toast, this.banner);

    tapify(this.xpBtn, () => this.mode.buyXp());
    tapify(this.rollBtn, () => this.mode.reroll());
    tapify(this.readyBtn, () => this.mode.beginCombat());

    // Hover is delegated to the CONTAINERS, which are never rebuilt. Binding to
    // the cards themselves stranded the panel open: onState() re-renders the
    // shop, so buying a card destroyed the element the pointer was over and its
    // pointerleave never fired.
    this.cards.addEventListener('pointerover', e => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const card = (e.target as HTMLElement | null)?.closest<HTMLElement>('.acCard');
      const id = card?.dataset['shopId'];
      if (!id) return this._scheduleHide(); // empty slot (already bought)
      this._hoverSlot = Number(card.dataset.shopIdx);
      this._showHover(this.mode.detailFor(null, id, 1));
    });
    this.cards.addEventListener('pointerleave', () => this._scheduleHide());

    this.benchRow.addEventListener('pointerover', e => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const slot = (e.target as HTMLElement | null)?.closest<HTMLElement>('.acBenchSlot');
      const uid = slot?.dataset['benchUid'];
      if (!uid) return this._scheduleHide();
      const entry = this.mode.roster?.entries.find(x => String(x.uid) === uid);
      if (entry) this._showHover(this.mode.detailFor(entry));
    });
    this.benchRow.addEventListener('pointerleave', () => this._scheduleHide());

    // keyboard: TFT muscle memory
    this._onKey = e => {
      if (!this.mode.active || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'd') { e.preventDefault(); this.mode.reroll(); }
      else if (k === 'f') { e.preventDefault(); this.mode.buyXp(); }
      else if (k === 'l') { e.preventDefault(); this.mode.toggleFreeze(); }
      else if (k === 'e' && this.mode.selected) { e.preventDefault(); this.mode.sell(this.mode.selected); }
      else if (k >= '1' && k <= '5') this.mode.buy(+k - 1);
      else if (k === ' ' && this.mode.phase === PHASE.PLANNING) { e.preventDefault(); this.mode.beginCombat(); }
    };
    document.addEventListener('keydown', this._onKey);
  }

  destroy(): void {
    clearTimeout(this._hideT);
    clearTimeout(this._toastT);
    clearTimeout(this._bannerT);
    document.removeEventListener('keydown', this._onKey);
    this.root.innerHTML = '';
    this.root.classList.remove('acRoot');
  }

  // ---- rendering ----
  onState(s: Snapshot): void {
    this.last = s;
    this.stageLabel.textContent = s.label;
    this.phaseLabel.textContent = s.phase === PHASE.COMBAT ? 'COMBAT'
      : s.phase === PHASE.RESOLVE ? 'ROUND OVER'
        : s.phase === PHASE.OVER ? 'ELIMINATED' : 'PLANNING';
    this.phaseLabel.dataset['phase'] = s.phase;

    this.hpBox.querySelector('.acHpVal')!.textContent = String(s.hp);
    this.hpBox.dataset['low'] = s.hp <= 30 ? '1' : '0';

    this.levelBox.innerHTML =
      `<div class="acLvlTop"><b>Lv ${s.level}</b></div>` +
      `<div class="acXpBar"><i style="width:${s.xpNext ? Math.min(100, 100 * s.xp / s.xpNext) : 100}%"></i></div>` +
      `<div class="acXpTxt">${s.xpNext ? `${s.xp}/${s.xpNext} XP` : 'MAX LEVEL'}</div>`;

    // Board capacity gets its own readout: it is the single most common thing
    // to be confused about ("why can't I place this?"), and it is gated by
    // level, so it belongs next to the level rather than buried in it.
    const full = s.onBoard >= s.capacity;
    this.capBox.dataset['full'] = full ? '1' : '0';
    this.capBox.innerHTML =
      `<div class="acCapTop"><b>${s.onBoard}</b><i>/ ${s.capacity}</i></div>` +
      `<div class="acCapLbl">on board</div>` +
      `<div class="acCapPips">${Array.from({ length: s.capacity }, (_, i) =>
        `<span class="${i < s.onBoard ? 'on' : ''}"></span>`).join('')}</div>` +
      `<div class="acCapHint">${full ? 'Board full — level up for +1' : `Level ${s.level + 1} allows ${s.capacity + 1}`}</div>`;

    const st = s.streak;
    this.streakBox.innerHTML = st === 0 ? '<span class="acStreakNone">no streak</span>'
      : `<span class="${st > 0 ? 'acWin' : 'acLose'}">${Math.abs(st)} ${st > 0 ? 'win' : 'loss'} streak</span>`;

    this.goldBox.innerHTML = `<b>${s.gold}</b><span>gold</span>`;
    this.xpBtn.innerHTML = `<b>Buy XP</b><span>${XP_COST}g → ${XP_PER_BUY}xp</span>`;
    this.xpBtn.disabled = s.gold < XP_COST || s.phase !== PHASE.PLANNING || !s.xpNext;
    this.rollBtn.innerHTML = `<b>Reroll</b><span>${REROLL_COST}g</span>`;
    this.rollBtn.disabled = s.gold < REROLL_COST || s.phase !== PHASE.PLANNING;

    this.freezeBtn.classList.toggle('on', s.frozen);
    this.freezeBtn.disabled = s.phase !== PHASE.PLANNING;
    this.freezeBtn.innerHTML = s.frozen
      ? '<b>&#128274; SHOP FROZEN</b><span>kept for next round · L</span>'
      : '<b>&#128275; Freeze shop</b><span>keep these cards next round · L</span>';
    this.cards.classList.toggle('acFrozen', s.frozen);

    this._renderShop(s);
    this._renderBench(s);
    this._renderFoe(s);
    this._renderMeter();
    this._validateHover(s);
    // a hovered shop card wins while the pointer is on it; otherwise the panel
    // sticks to whatever is selected, so it survives moving the mouse away
    this._renderDetail(this._hoverDetail || s.detail);

    const planning = s.phase === PHASE.PLANNING;
    this.readyBtn.classList.toggle('hidden', !planning);
    this.readyBtn.textContent = s.online ? 'LOCK IN' : 'START ROUND';
    this.readyBtn.disabled = !!s.waitingForPeer;
    this.root.dataset['phase'] = s.phase;
  }

  private _renderShop(s: Snapshot): void {
    this.cards.innerHTML = '';
    s.shop.forEach((c, i) => {
      if (!c) { this.cards.appendChild(el('div', 'acCard acCardEmpty')); return; }
      const u = c.unit;
      const card = el('div', `acCard cost${u.cost}${c.affordable ? '' : ' acPoor'}`);
      card.style.setProperty('--tier', TIER_COLOR[u.cost]);
      const pips = c.progress
        ? `<div class="acPips">${Array.from({ length: c.progress.need }, (_, k) =>
          `<i class="${k < c.progress.have ? 'on' : ''}"></i>`).join('')}</div>`
        : '';
      const art = this.portraits[u.id]
        ? `<img src="${this.portraits[u.id]}" alt="">`
        : `<span class="acCardFlag">${u.cfg.flag}</span>`;
      const up = c.upgrade
        ? `<span class="acUp s${c.upgrade}" title="completes a ${c.upgrade}-star">▲</span>`
        : '';
      card.innerHTML = `
        <div class="acCardArt">${art}${pips}${up}</div>
        <div class="acCardName">${u.short}</div>
        <div class="acCardNick">${u.nick}</div>
        <div class="acCardFoot"><span class="acCardAbil">${u.ability.name}</span><b>${u.cost}g</b></div>`;
      card.dataset['shopId'] = c.id;
      card.dataset['shopIdx'] = String(i);
      tapify(card, () => this.mode.buy(i));
      this.cards.appendChild(card);
    });
  }

  // Hover shows immediately; hiding is delayed so the pointer can travel from
  // the card to the panel without it vanishing en route.
  private _showHover(d: Detail | null): void {
    this._cancelHide();
    if (!d) return;
    this._hoverDetail = d;
    this._renderDetail(d);
  }

  private _cancelHide(): void { clearTimeout(this._hideT); }

  // The pointer does not move when you buy or when three copies merge, so no
  // fresh pointerover arrives to correct a hover that now points at a slot that
  // emptied or an entry that stopped existing. Re-check it against live state.
  private _validateHover(s: Snapshot): void {
    const h = this._hoverDetail;
    if (!h) return;
    if (h.entry) {
      if (!this.mode.roster?.entries.includes(h.entry)) this._hoverDetail = null;
      return;
    }
    if (this._hoverSlot != null && !s.shop[this._hoverSlot]) this._hoverDetail = null;
  }

  private _scheduleHide(): void {
    this._cancelHide();
    this._hideT = setTimeout(() => {
      this._hoverDetail = null;
      // fall back to the pinned selection, or close entirely
      this._renderDetail(this.last?.detail || null);
    }, 160);
  }

  private _renderFoe(s: Partial<Snapshot>): void {
    const foes = s.enemy || [];
    if (!foes.length && !s.online) { this.foe.classList.add('hidden'); return; }
    this.foe.classList.remove('hidden');
    this.foe.classList.toggle('acClosed', !this._foeOpen);
    const hp = Math.max(0, Math.min(100, s.aiHp ?? 0));
    // header + life bar survive the collapse — the opponent's health is the
    // one number worth a permanent slot on screen
    const head =
      `<div class="acFoeHead">
         <span>OPPONENT</span>
         <b class="acFoeHp2" data-low="${(s.aiHp ?? 0) <= 30 ? 1 : 0}">${s.aiHp ?? 0}</b>
         <em class="acChev">${this._foeOpen ? '▾' : '▸'}</em>
       </div>
       <div class="acFoeLife"><i style="width:${hp.toFixed(1)}%"></i></div>`;
    if (!this._foeOpen) { this.foe.innerHTML = head; return; }
    if (!foes.length) {
      // online planning: the opponent is still choosing, nothing to scout yet
      this.foe.innerHTML = head +
        `<div class="acFoeSub">${s.waitingForPeer ? 'waiting for their board…' : 'choosing their board'}</div>`;
      return;
    }
    const live = foes.filter(f => f.alive).length;
    const totalFrac = foes.reduce((a, f) => a + f.frac, 0) / foes.length;
    this.foe.innerHTML = head +
      `<div class="acFoeSub">${s.online ? '' : `Lv ${s.aiLevel} · ${s.aiGold}g · `}${live}/${foes.length} alive</div>
       <div class="acFoeTotal"><i style="width:${(totalFrac * 100).toFixed(1)}%"></i></div>
       <div class="acFoeList">${foes.map(f => `
         <div class="acFoeRow${f.alive ? '' : ' dead'}" style="--tier:${TIER_COLOR[f.unit.cost]}">
           <span class="acFoePic">${this.portraits[f.unit.id]
             ? `<img src="${this.portraits[f.unit.id]}" alt="">`
             : f.unit.cfg.flag}</span>
           <span class="acFoeInfo">
             <span class="acFoeName">${f.unit.short}<em class="s${f.star}">${STAR.repeat(f.star)}</em></span>
             <span class="acFoeBar"><i style="width:${(f.frac * 100).toFixed(1)}%"></i></span>
             <span class="acFoeMana"><i style="width:${(f.mana * 100).toFixed(1)}%"></i></span>
           </span>
           <span class="acFoeHp">${f.hp}</span>
         </div>`).join('')}</div>
       ${s.phase === PHASE.PLANNING && !s.online
         ? `<div class="acFoeHint">scouted · they are level ${this.mode.ai?.econ.level ?? '?'} with ${this.mode.ai?.econ.gold ?? '?'}g</div>`
         : ''}`;
  }

  // My fighters' damage output — the ROUND tab covers the current or most
  // recent fight, TOTAL the whole game. Data lives in mode.damageRows().
  private _renderMeter(): void {
    const m = this.mode;
    if (!m.active) { this.meter.classList.add('hidden'); return; }
    this.meter.classList.remove('hidden');
    this.meter.classList.toggle('acClosed', !this._meterOpen);
    const head =
      `<div class="acMeterHead">
         <span>MY DAMAGE</span>
         <em class="acChev">${this._meterOpen ? '▾' : '▸'}</em>
       </div>`;
    if (!this._meterOpen) { this.meter.innerHTML = head; return; }
    const rows = m.damageRows(this._meterTab);
    const max = rows[0]?.dmg || 1;
    this.meter.innerHTML = head +
      `<div class="acMeterTabs">
         <button class="${this._meterTab === 'round' ? 'on' : ''}" data-tab="round">ROUND</button>
         <button class="${this._meterTab === 'total' ? 'on' : ''}" data-tab="total">TOTAL</button>
       </div>
       <div class="acMeterList">${rows.length ? rows.map(r => `
         <div class="acMeterRow" style="--tier:${TIER_COLOR[r.unit.cost]}">
           <span class="acFoePic">${this.portraits[r.id]
             ? `<img src="${this.portraits[r.id]}" alt="">`
             : r.unit.cfg.flag}</span>
           <span class="acMeterInfo">
             <span class="acMeterName">${r.unit.short}</span>
             <span class="acMeterBar"><i style="width:${(100 * r.dmg / max).toFixed(1)}%"></i></span>
           </span>
           <span class="acMeterVal">${Math.round(r.dmg)}</span>
         </div>`).join('') : '<div class="acMeterEmpty">no damage yet</div>'}</div>`;
  }

  private _renderDetail(d: Detail | null): void {
    if (!d) { this.detail.classList.add('hidden'); return; }
    const u = d.unit;
    const st = d.stats;
    this.detail.classList.remove('hidden');
    this.detail.style.setProperty('--tier', TIER_COLOR[u.cost]);
    const art = this.portraits[u.id] ? `<img src="${this.portraits[u.id]}" alt="">` : `<span>${u.cfg.flag}</span>`;
    const rows = [
      ['Health', st.maxHp],
      ['Attack damage', st.ad],
      ['Attack speed', st.attackSpeed.toFixed(2)],
      ['Armor / MR', `${st.armor} / ${st.mr}`],
      ['Range', `${u.range} hex${u.range > 1 ? 'es' : ''}`],
      ['Mana', `${st.startMana} / ${st.maxMana}`],
    ];
    this.detail.innerHTML = `
      <div class="acDetHead">
        <div class="acDetArt">${art}</div>
        <div class="acDetWho">
          <div class="acDetName">${u.short}<em class="acDetStars s${d.star}">${STAR.repeat(d.star)}</em></div>
          <div class="acDetNick">"${u.nick}"</div>
          <div class="acDetTags"><span class="acDetCost">${u.cost}g</span><span class="acDetRole">${u.role}</span></div>
        </div>
      </div>
      <p class="acDetBlurb">${u.blurb}</p>
      <div class="acDetStats">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <div class="acDetAbil">
        <div class="acDetAbilName">${d.ability.name}<em>${d.ability.mana} mana</em></div>
        <p>${d.abilityText}</p>
      </div>
      ${d.sellFor != null
        ? `<button class="acSell" data-sell>Sell ${u.short} <b>+${d.sellFor}g</b><em>E</em></button>`
        : '<div class="acDetHint">Click to buy</div>'}
      <span class="acDetMore" aria-hidden="true">&#9662;</span>`;
    // preserve the expanded state across re-renders
    this.detail.classList.toggle('acDetOpen', !!this._detOpen);
  }

  private _renderBench(s: Snapshot): void {
    this.benchRow.innerHTML = '';
    for (let i = 0; i < BENCH_SLOTS; i++) {
      const b = s.bench[i];
      const slot = el('div', 'acBenchSlot');
      if (b) {
        slot.classList.add('acFilled', `cost${b.unit.cost}`);
        slot.style.setProperty('--tier', TIER_COLOR[b.unit.cost]);
        if (s.selected === b.entry) slot.classList.add('acSel');
        const art = this.portraits[b.unit.id]
          ? `<img src="${this.portraits[b.unit.id]}" alt="">`
          : `<span>${b.unit.cfg.flag}</span>`;
        slot.innerHTML = `${art}<em class="acStars s${b.star}">${STAR.repeat(b.star)}</em>`;
        slot.title = `${b.unit.name} — ${STAR.repeat(b.star)} — sell for ${sellValue(b.unit.cost, b.star)}g`;
        slot.dataset['benchUid'] = String(b.entry.uid);
        tapify(slot, () => this.mode.select(b.entry));
      }
      this.benchRow.appendChild(slot);
    }
  }

  // Per-frame: only the countdown bar, so the shop is not re-rendered 60x a
  // second just to move a timer.
  onTick(phase: string, timer: number): void {
    const full = phase === PHASE.COMBAT ? ROUND_TIME : phase === PHASE.PLANNING ? PLANNING_TIME : RESOLVE_TIME;
    this.timerFill.style.width = `${Math.max(0, Math.min(100, (timer / full) * 100))}%`;

    // Enemy health changes every frame in combat, but onState() only fires on
    // discrete events. Patch the existing rows' widths instead of rebuilding
    // the panel's innerHTML 60 times a second.
    if (phase !== PHASE.COMBAT) return;
    const now = performance.now();
    if (this._foeT && now - this._foeT < 100) return;
    this._foeT = now;

    // damage accrues continuously; a ~3Hz re-render keeps the meter live
    // without paying full innerHTML churn every frame
    if (this._meterOpen && (!this._meterT || now - this._meterT > 300)) {
      this._meterT = now;
      this._renderMeter();
    }

    if (!this._foeOpen) return; // collapsed: HP only changes on resolve, via onState
    const foes = this.mode.enemyRoster();
    if (!foes.length) return;
    const rows = this.foe.querySelectorAll('.acFoeRow');
    if (rows.length !== foes.length) { this._renderFoe(this.mode.snapshot()); return; }
    let live = 0, sum = 0;
    foes.forEach((f, i) => {
      const row = rows[i];
      row.classList.toggle('dead', !f.alive);
      row.querySelector<HTMLElement>('.acFoeBar i')!.style.width = `${(f.frac * 100).toFixed(1)}%`;
      row.querySelector<HTMLElement>('.acFoeMana i')!.style.width = `${(f.mana * 100).toFixed(1)}%`;
      row.querySelector('.acFoeHp')!.textContent = String(f.hp);
      if (f.alive) live++;
      sum += f.frac;
    });
    const sub = this.foe.querySelector('.acFoeSub');
    if (sub) sub.textContent = `${this.last?.online ? '' : `Lv ${this.last?.aiLevel} · ${this.last?.aiGold}g · `}${live}/${foes.length} alive`;
    const tot = this.foe.querySelector<HTMLElement>('.acFoeTotal i');
    if (tot) tot.style.width = `${(100 * sum / foes.length).toFixed(1)}%`;
  }

  // ---- transient feedback ----
  onToast(msg: string): void {
    this.toast.textContent = msg;
    this.toast.classList.remove('hidden', 'acToastIn');
    void this.toast.offsetWidth;
    this.toast.classList.add('acToastIn');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toast.classList.add('hidden'), 1800);
  }

  onMerge(m: { entry: Entry; star: number }): void {
    const u = UNIT_BY_ID[m.entry.unitId];
    this.onToast(`${u.short} upgraded to ${STAR.repeat(m.star)}`);
  }

  onCast(): void { /* ability VFX handled in 3D; hook kept for future flourish */ }

  onRoundEnd(r: RoundResult): void {
    const txt = r.draw ? 'DRAW'
      : r.won ? `ROUND WON  −${r.aiDmg} enemy HP`
        : `ROUND LOST  −${r.dmg} HP`;
    this.banner.innerHTML =
      `<div class="acBannerMain ${r.won ? 'win' : r.draw ? '' : 'lose'}">${txt}</div>` +
      `<div class="acBannerSub">+${r.pay.total}g · ${r.pay.base} base · ${r.pay.interest} interest · ${r.pay.streak} streak` +
      `${r.aiHp != null ? ` &nbsp;|&nbsp; opponent ${r.aiHp} HP` : ''}</div>`;
    this.banner.classList.remove('hidden', 'acBannerIn');
    void this.banner.offsetWidth;
    this.banner.classList.add('acBannerIn');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => this.banner.classList.add('hidden'), 2600);
  }

  onGameOver(s: Snapshot): void {
    // onRoundEnd fires just before this and schedules a banner auto-hide that
    // would swallow the game-over screen (and its button) 2.6s in
    clearTimeout(this._bannerT);
    this.banner.innerHTML = s.victory
      ? `<div class="acBannerMain win">VICTORY</div>
         <div class="acBannerSub">Opponent eliminated at stage ${s.label} — you finished on ${s.hp} HP</div>`
      : `<div class="acBannerMain lose">ELIMINATED</div>
         <div class="acBannerSub">You reached stage ${s.label} at level ${s.level} — opponent had ${s.aiHp} HP left</div>`;
    // Online, a unilateral restart is meaningless — the peer is gone or won,
    // so the button exits instead. reload() is the honest teardown: it drops
    // the PeerJS session and every bit of match state at once.
    const btn = el('button', 'acAgain', s.online ? 'EXIT TO MENU' : 'PLAY AGAIN');
    tapify(btn, () => {
      if (s.online) { location.reload(); return; }
      this.banner.classList.add('hidden');
      this.mode.start();
    });
    this.banner.appendChild(btn);
    this.banner.classList.remove('hidden');
  }

  // Floating damage numbers, projected from the unit's world position.
  onFloatDamage(unit: CombatUnit, amount: number, crit: boolean, type: DamageType): void {
    this._float(unit, `${amount}`, crit ? 'crit' : type === 'magic' ? 'magic' : 'phys');
  }

  onFloatHeal(unit: CombatUnit, amount: number): void {
    this._float(unit, `+${amount}`, 'heal');
  }

  private _float(unit: CombatUnit, text: string, kind: string): void {
    if (!unit.view) return;
    const n = el('div', `acDmg ${kind}`, text);
    this.floatLayer.appendChild(n);
    this.floaters.push({ n, unit, t: 0, dx: (Math.random() - 0.5) * 26 });
    if (this.floaters.length > 40) {
      this.floaters.shift()?.n.remove();
    }
  }

  // Called each frame by the mode so floaters track their unit and fade.
  updateFloaters(dt: number, camera: THREE.Camera, boardRoot: THREE.Object3D): void {
    if (!this.floaters.length) return;
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      if (f.t > 1.05 || !f.unit.view) {
        f.n.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      const p = f.unit.view!.bars.position;
      this._v ??= new THREE.Vector3();
      this._v.set(p.x, p.y, p.z);
      boardRoot.localToWorld(this._v);
      this._v.project(camera);
      const x = (this._v.x * 0.5 + 0.5) * w + f.dx;
      const y = (1 - (this._v.y * 0.5 + 0.5)) * h - f.t * 46;
      f.n.style.transform = `translate(${x}px, ${y}px)`;
      f.n.style.opacity = String(Math.max(0, 1 - f.t / 1.05));
    }
  }
}
