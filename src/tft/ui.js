// Autochess HUD: shop, bench, economy readouts and floating combat text.
//
// Built imperatively against a container the mode owns, so none of it exists
// (or costs anything) while the game is in auto-sim or control mode.

import { TIER_COLOR, sellValue, UNIT_BY_ID } from './units.js';
import { PHASE } from './mode.js';
import { REROLL_COST, XP_COST, XP_PER_BUY, BENCH_SLOTS } from './shop.js';

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

const STAR = '★';

export class AutochessUI {
  constructor(root, mode, { portraits = {} } = {}) {
    this.root = root;
    this.mode = mode;
    this.portraits = portraits;
    this.floaters = [];
    this._build();
  }

  _build() {
    this.root.innerHTML = '';
    this.root.classList.add('acRoot');

    // ---- top bar: stage, phase, timer ----
    this.top = el('div', 'acTop');
    this.stageLabel = el('div', 'acStage', '1-1');
    this.phaseLabel = el('div', 'acPhase', 'PLANNING');
    this.timerBar = el('div', 'acTimerBar');
    this.timerFill = el('div', 'acTimerFill');
    this.timerBar.appendChild(this.timerFill);
    this.top.append(this.stageLabel, this.phaseLabel, this.timerBar);

    // ---- left rail: player state ----
    this.rail = el('div', 'acRail');
    this.hpBox = el('div', 'acHp', '<span class="acHpVal">100</span><span class="acHpLbl">HP</span>');
    this.levelBox = el('div', 'acLevel');
    this.capBox = el('div', 'acCap');
    this.streakBox = el('div', 'acStreak');
    this.rail.append(this.hpBox, this.levelBox, this.capBox, this.streakBox);

    // ---- inspector: stats, ability, sell ----
    this.detail = el('div', 'acDetail hidden');
    this.detail.addEventListener('click', e => {
      if (e.target.closest('[data-sell]')) {
        const entry = this._hoverDetail?.entry || this.mode.selected;
        if (!entry) return;
        // drop the hover first: it points at an entry that is about to stop
        // existing, and onState() would render it right back
        this._hoverDetail = null;
        this._cancelHide();
        this.mode.sell(entry);
      }
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
    this.freezeBtn.addEventListener('click', () => this.mode.toggleFreeze());
    this.cardsWrap.append(this.benchRow, this.cards, this.freezeBtn);
    this.bottom.append(this.shopSide, this.cardsWrap);

    // ---- opponent scout panel ----
    this.foe = el('div', 'acFoe');

    this.readyBtn = el('button', 'acReady', 'START ROUND');
    this.toast = el('div', 'acToast hidden');
    this.floatLayer = el('div', 'acFloat');
    this.banner = el('div', 'acBanner hidden');

    // the inspector lives in the rail column so it always flows BELOW the
    // stats boxes — an absolute offset silently collides the moment the rail
    // gains a row (it did, when board capacity got its own readout)
    this.rail.append(this.detail);
    this.root.append(this.top, this.rail, this.foe, this.floatLayer, this.bottom, this.readyBtn, this.toast, this.banner);

    this.xpBtn.addEventListener('click', () => this.mode.buyXp());
    this.rollBtn.addEventListener('click', () => this.mode.reroll());
    this.readyBtn.addEventListener('click', () => this.mode.beginCombat());

    // Hover is delegated to the CONTAINERS, which are never rebuilt. Binding to
    // the cards themselves stranded the panel open: onState() re-renders the
    // shop, so buying a card destroyed the element the pointer was over and its
    // pointerleave never fired.
    this.cards.addEventListener('pointerover', e => {
      const card = e.target.closest('.acCard');
      const id = card?.dataset.shopId;
      if (!id) return this._scheduleHide(); // empty slot (already bought)
      this._hoverSlot = Number(card.dataset.shopIdx);
      this._showHover(this.mode.detailFor(null, id, 1));
    });
    this.cards.addEventListener('pointerleave', () => this._scheduleHide());

    this.benchRow.addEventListener('pointerover', e => {
      const slot = e.target.closest('.acBenchSlot');
      const uid = slot?.dataset.benchUid;
      if (!uid) return this._scheduleHide();
      const entry = this.mode.roster?.entries.find(x => String(x.uid) === uid);
      if (entry) this._showHover(this.mode.detailFor(entry));
    });
    this.benchRow.addEventListener('pointerleave', () => this._scheduleHide());

    // keyboard: TFT muscle memory
    this._onKey = e => {
      if (!this.mode.active || e.target.tagName === 'INPUT') return;
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

  destroy() {
    clearTimeout(this._hideT);
    clearTimeout(this._toastT);
    clearTimeout(this._bannerT);
    document.removeEventListener('keydown', this._onKey);
    this.root.innerHTML = '';
    this.root.classList.remove('acRoot');
  }

  // ---- rendering ----
  onState(s) {
    this.last = s;
    this.stageLabel.textContent = s.label;
    this.phaseLabel.textContent = s.phase === PHASE.COMBAT ? 'COMBAT'
      : s.phase === PHASE.RESOLVE ? 'ROUND OVER'
        : s.phase === PHASE.OVER ? 'ELIMINATED' : 'PLANNING';
    this.phaseLabel.dataset.phase = s.phase;

    this.hpBox.querySelector('.acHpVal').textContent = s.hp;
    this.hpBox.dataset.low = s.hp <= 30 ? '1' : '0';

    this.levelBox.innerHTML =
      `<div class="acLvlTop"><b>Lv ${s.level}</b></div>` +
      `<div class="acXpBar"><i style="width:${s.xpNext ? Math.min(100, 100 * s.xp / s.xpNext) : 100}%"></i></div>` +
      `<div class="acXpTxt">${s.xpNext ? `${s.xp}/${s.xpNext} XP` : 'MAX LEVEL'}</div>`;

    // Board capacity gets its own readout: it is the single most common thing
    // to be confused about ("why can't I place this?"), and it is gated by
    // level, so it belongs next to the level rather than buried in it.
    const full = s.onBoard >= s.capacity;
    this.capBox.dataset.full = full ? '1' : '0';
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
    this._validateHover(s);
    // a hovered shop card wins while the pointer is on it; otherwise the panel
    // sticks to whatever is selected, so it survives moving the mouse away
    this._renderDetail(this._hoverDetail || s.detail);

    const planning = s.phase === PHASE.PLANNING;
    this.readyBtn.classList.toggle('hidden', !planning);
    this.root.dataset.phase = s.phase;
  }

  _renderShop(s) {
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
      card.innerHTML = `
        <div class="acCardArt">${art}${pips}</div>
        <div class="acCardName">${u.short}</div>
        <div class="acCardNick">${u.nick}</div>
        <div class="acCardFoot"><span class="acCardAbil">${u.ability.name}</span><b>${u.cost}g</b></div>`;
      card.dataset.shopId = c.id;
      card.dataset.shopIdx = i;
      card.addEventListener('click', () => this.mode.buy(i));
      this.cards.appendChild(card);
    });
  }

  // Hover shows immediately; hiding is delayed so the pointer can travel from
  // the card to the panel without it vanishing en route.
  _showHover(d) {
    this._cancelHide();
    if (!d) return;
    this._hoverDetail = d;
    this._renderDetail(d);
  }

  _cancelHide() { clearTimeout(this._hideT); }

  // The pointer does not move when you buy or when three copies merge, so no
  // fresh pointerover arrives to correct a hover that now points at a slot that
  // emptied or an entry that stopped existing. Re-check it against live state.
  _validateHover(s) {
    const h = this._hoverDetail;
    if (!h) return;
    if (h.entry) {
      if (!this.mode.roster?.entries.includes(h.entry)) this._hoverDetail = null;
      return;
    }
    if (this._hoverSlot != null && !s.shop[this._hoverSlot]) this._hoverDetail = null;
  }

  _scheduleHide() {
    this._cancelHide();
    this._hideT = setTimeout(() => {
      this._hoverDetail = null;
      // fall back to the pinned selection, or close entirely
      this._renderDetail(this.last?.detail || null);
    }, 160);
  }

  _renderFoe(s) {
    const foes = s.enemy || [];
    if (!foes.length) { this.foe.classList.add('hidden'); return; }
    this.foe.classList.remove('hidden');
    const live = foes.filter(f => f.alive).length;
    const totalFrac = foes.reduce((a, f) => a + f.frac, 0) / foes.length;
    const hpFrac = Math.max(0, Math.min(1, (s.aiHp ?? 0) / 100));
    this.foe.innerHTML =
      `<div class="acFoeHead">
         <span>OPPONENT</span>
         <b class="acFoeHp2" data-low="${s.aiHp <= 30 ? 1 : 0}">${s.aiHp}</b>
       </div>
       <div class="acFoeLife"><i style="width:${(hpFrac * 100).toFixed(1)}%"></i></div>
       <div class="acFoeSub">Lv ${s.aiLevel} · ${s.aiGold}g · ${live}/${foes.length} alive</div>
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
       ${s.phase === PHASE.PLANNING
         ? `<div class="acFoeHint">scouted · they are level ${this.mode.ai?.econ.level ?? '?'} with ${this.mode.ai?.econ.gold ?? '?'}g</div>`
         : ''}`;
  }

  _renderDetail(d) {
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
        : '<div class="acDetHint">Click to buy</div>'}`;
  }

  _renderBench(s) {
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
        slot.dataset.benchUid = b.entry.uid;
        slot.addEventListener('click', () => this.mode.select(b.entry));
      }
      this.benchRow.appendChild(slot);
    }
  }

  // Per-frame: only the countdown bar, so the shop is not re-rendered 60x a
  // second just to move a timer.
  onTick(phase, timer) {
    const full = phase === PHASE.COMBAT ? 30 : phase === PHASE.PLANNING ? 30 : 3.2;
    this.timerFill.style.width = `${Math.max(0, Math.min(100, (timer / full) * 100))}%`;

    // Enemy health changes every frame in combat, but onState() only fires on
    // discrete events. Patch the existing rows' widths instead of rebuilding
    // the panel's innerHTML 60 times a second.
    if (phase !== PHASE.COMBAT) return;
    const now = performance.now();
    if (this._foeT && now - this._foeT < 80) return;
    this._foeT = now;
    const foes = this.mode.enemyRoster();
    const rows = this.foe.querySelectorAll('.acFoeRow');
    if (rows.length !== foes.length) { this._renderFoe(this.mode.snapshot()); return; }
    if (!foes.length) return;
    let live = 0, sum = 0;
    foes.forEach((f, i) => {
      const row = rows[i];
      row.classList.toggle('dead', !f.alive);
      row.querySelector('.acFoeBar i').style.width = `${(f.frac * 100).toFixed(1)}%`;
      row.querySelector('.acFoeMana i').style.width = `${(f.mana * 100).toFixed(1)}%`;
      row.querySelector('.acFoeHp').textContent = f.hp;
      if (f.alive) live++;
      sum += f.frac;
    });
    this.foe.querySelector('.acFoeHead b').textContent = `${live}/${foes.length}`;
    this.foe.querySelector('.acFoeTotal i').style.width = `${(100 * sum / foes.length).toFixed(1)}%`;
  }

  // ---- transient feedback ----
  onToast(msg) {
    this.toast.textContent = msg;
    this.toast.classList.remove('hidden', 'acToastIn');
    void this.toast.offsetWidth;
    this.toast.classList.add('acToastIn');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toast.classList.add('hidden'), 1800);
  }

  onMerge(m) {
    const u = UNIT_BY_ID[m.entry.unitId];
    this.onToast(`${u.short} upgraded to ${STAR.repeat(m.star)}`);
  }

  onCast() { /* ability VFX handled in 3D; hook kept for future flourish */ }

  onRoundEnd(r) {
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

  onGameOver(s) {
    this.banner.innerHTML = s.victory
      ? `<div class="acBannerMain win">VICTORY</div>
         <div class="acBannerSub">Opponent eliminated at stage ${s.label} — you finished on ${s.hp} HP</div>`
      : `<div class="acBannerMain lose">ELIMINATED</div>
         <div class="acBannerSub">You reached stage ${s.label} at level ${s.level} — opponent had ${s.aiHp} HP left</div>`;
    this.banner.classList.remove('hidden');
  }

  // Floating damage numbers, projected from the unit's world position.
  onFloatDamage(unit, amount, crit, type) {
    this._float(unit, `${amount}`, crit ? 'crit' : type === 'magic' ? 'magic' : 'phys');
  }

  onFloatHeal(unit, amount) {
    this._float(unit, `+${amount}`, 'heal');
  }

  _float(unit, text, kind) {
    if (!unit.view) return;
    const n = el('div', `acDmg ${kind}`, text);
    this.floatLayer.appendChild(n);
    this.floaters.push({ n, unit, t: 0, dx: (Math.random() - 0.5) * 26 });
    if (this.floaters.length > 40) {
      const old = this.floaters.shift();
      old.n.remove();
    }
  }

  // Called each frame by the mode so floaters track their unit and fade.
  updateFloaters(dt, camera, boardRoot) {
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
      const p = f.unit.view.bars.position;
      this._v = this._v || new (Object.getPrototypeOf(p).constructor)();
      this._v.copy(p);
      boardRoot.localToWorld(this._v);
      this._v.project(camera);
      const x = (this._v.x * 0.5 + 0.5) * w + f.dx;
      const y = (1 - (this._v.y * 0.5 + 0.5)) * h - f.t * 46;
      f.n.style.transform = `translate(${x}px, ${y}px)`;
      f.n.style.opacity = String(Math.max(0, 1 - f.t / 1.05));
    }
  }
}
