import * as THREE from 'three';
import { FIGHTERS } from './config.js';
import { loadAssets } from './anim.js';
import { Fighter3D } from './fighter3d.js';
import { Engine, simFight, setFightRng, seededRng } from './fight.js';
import { Net, PROTOCOL_VERSION } from './net.js';

const canvas = document.querySelector('#scene');
// perf tiers: phones get a lower pixel-ratio cap and smaller shadow maps;
// high-DPR phones skip MSAA entirely (the DPR already supersamples)
const isMobile = matchMedia('(pointer: coarse)').matches || window.innerWidth < 820;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !(isMobile && window.devicePixelRatio > 1.7),
  powerPreference: 'high-performance',
});
let dprCap = isMobile ? 1.5 : 2;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18; // lift ACES midtones so skin reads natural, not muddy
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07070c);
scene.fog = new THREE.Fog(0x07070c, 12, 32);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 60);

// arena floor beneath the octagon model
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(30, 48),
  new THREE.MeshStandardMaterial({ color: 0x08080d, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.35;
scene.add(ground);

// ---------- Lights ----------
scene.add(new THREE.HemisphereLight(0xd8e2ff, 0x1c1c26, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 3.0);
key.position.set(2.5, 7, 3.5);
key.castShadow = true;
key.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -6;
key.shadow.camera.right = key.shadow.camera.top = 6;
key.shadow.camera.near = 1;
key.shadow.camera.far = 18;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key);
const blueRim = new THREE.PointLight(0x3b62ff, 35, 18);
blueRim.position.set(-5.5, 3.2, -2);
scene.add(blueRim);
const redRim = new THREE.PointLight(0xff3348, 35, 18);
redRim.position.set(5.5, 3.2, -2);
scene.add(redRim);
const spot = new THREE.SpotLight(0xffffff, 320, 26, 0.7, 0.5);
spot.position.set(0, 9, 0);
scene.add(spot, spot.target);
const fill = new THREE.DirectionalLight(0xbfcaff, 1.1);
fill.position.set(-3, 4, -4);
scene.add(fill);
// camera-following face light: guarantees the side facing the viewer (faces,
// chests) is never in the dark regardless of where the orbit camera sits
const faceFill = new THREE.DirectionalLight(0xfff0dd, 0.85);
scene.add(faceFill, faceFill.target);

// ---------- Audio ----------
const MUSIC_BAR = (60 / 92) * 4; // one 4/4 bar at 92 BPM
const MUSIC_VOL = 0.08; // background level — user asked for quiet, half the original 0.16

class FX {
  init() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.comp = this.ctx.createDynamicsCompressor();
        this.comp.threshold.value = -18;
        this.comp.ratio.value = 6;
        this.comp.connect(this.ctx.destination);
      } catch {
        /* audio unsupported */
      }
    }
    this.ctx?.resume?.();
  }

  out() {
    return this.comp || this.ctx.destination;
  }

  // layered impact: sub thump + body knock + slap transient (+ crit boom)
  impact(kind, heavy, crit) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const vary = f => f * (0.88 + Math.random() * 0.24);

    const sub = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(vary(kind === 'kick' ? 58 : 82), t);
    sub.frequency.exponentialRampToValueAtTime(30, t + 0.16);
    const subG = c.createGain();
    subG.gain.setValueAtTime(heavy ? 0.9 : 0.55, t);
    subG.gain.exponentialRampToValueAtTime(0.001, t + (heavy ? 0.28 : 0.18));
    sub.connect(subG).connect(this.out());
    sub.start(t);
    sub.stop(t + 0.3);

    const knock = c.createOscillator();
    knock.type = 'triangle';
    knock.frequency.setValueAtTime(vary(kind === 'kick' ? 140 : 190), t);
    knock.frequency.exponentialRampToValueAtTime(70, t + 0.09);
    const knockG = c.createGain();
    knockG.gain.setValueAtTime(heavy ? 0.5 : 0.35, t);
    knockG.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    knock.connect(knockG).connect(this.out());
    knock.start(t);
    knock.stop(t + 0.15);

    const len = (c.sampleRate * 0.06) | 0;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const slap = c.createBufferSource();
    slap.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = vary(kind === 'kick' ? 900 : 1600);
    bp.Q.value = 0.7;
    const slapG = c.createGain();
    slapG.gain.value = heavy ? 0.8 : 0.6;
    slap.connect(bp).connect(slapG).connect(this.out());
    slap.start(t);

    if (crit) {
      const boom = c.createOscillator();
      boom.type = 'sawtooth';
      boom.frequency.setValueAtTime(46, t);
      boom.frequency.exponentialRampToValueAtTime(24, t + 0.5);
      const shaper = c.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) curve[i] = Math.tanh(2.2 * (i / 128 - 1));
      shaper.curve = curve;
      const boomG = c.createGain();
      boomG.gain.setValueAtTime(0.5, t);
      boomG.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      boom.connect(shaper).connect(boomG).connect(this.out());
      boom.start(t);
      boom.stop(t + 0.6);
    }
  }

  bell() {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    [880, 1760].forEach((f, i) => {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.18 / (i + 1), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + 1.15);
    });
  }

  loadVoices(cfgs) {
    this.voices = {};
    for (const c of cfgs) {
      if (c.voice) {
        const a = new Audio(c.voice);
        a.preload = 'auto';
        this.voices[c.id] = a;
      }
    }
  }

  // crit celebration: the attacker shouts their own line mid-fight.
  // Throttled so back-to-back crits don't stutter-restart the clip.
  critVoice(cfg) {
    const a = this.voices?.[cfg.id];
    if (!a) return;
    const now = performance.now();
    if (this._voiceUntil && now < this._voiceUntil) return;
    // a.duration is NaN before metadata loads and can be Infinity for streams
    const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 2.5;
    this._voiceUntil = now + Math.max(2500, dur * 1000 + 800);
    try {
      a.currentTime = 0;
      a.volume = 0.9;
      a.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }

  // ---------- background fight music (synthesized — no assets, no licenses) ----------
  // 92 BPM dark percussion loop: kick/snare/hats + phrygian bass + tension pad.
  // Master sits at 0.16 so it stays background under commentary and impacts.
  startMusic() {
    const c = this.ctx;
    if (!c || this.musicOn) return;
    this.musicOn = true;
    this.mGain = c.createGain();
    this.mGain.gain.value = MUSIC_VOL;
    this.mGain.connect(this.out());

    // sustained tension pad: detuned saws through a slowly breathing lowpass
    const padLp = c.createBiquadFilter();
    padLp.type = 'lowpass';
    padLp.frequency.value = 520;
    padLp.Q.value = 1.2;
    const padLfo = c.createOscillator();
    padLfo.frequency.value = 0.11;
    const padLfoG = c.createGain();
    padLfoG.gain.value = 220;
    padLfo.connect(padLfoG).connect(padLp.frequency);
    const padG = c.createGain();
    padG.gain.value = 0.05;
    padLp.connect(padG).connect(this.mGain);
    this.mPad = [padLfo];
    for (const [f, det] of [[146.83, -5], [146.83, 5], [220, 3]]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(padLp);
      o.start();
      this.mPad.push(o);
    }
    padLfo.start();

    this.mBar = 0;
    this.mNext = c.currentTime + 0.08;
    this.mTimer = setInterval(() => {
      while (this.musicOn && this.mNext < this.ctx.currentTime + 0.45) {
        this._musicBar(this.mNext, this.mBar++);
        this.mNext += MUSIC_BAR;
      }
    }, 100);
  }

  stopMusic(fade = 0.7) {
    if (!this.musicOn) return;
    this.musicOn = false;
    clearInterval(this.mTimer);
    const c = this.ctx;
    const g = this.mGain, pad = this.mPad;
    g.gain.setTargetAtTime(0.0001, c.currentTime, fade / 4);
    setTimeout(() => {
      pad.forEach(o => { try { o.stop(); } catch { /* already stopped */ } });
      g.disconnect();
    }, fade * 1000 + 200);
  }

  // sidechain-style dip so big moments (crits, KOs) punch through the music
  duckMusic() {
    if (!this.musicOn) return;
    const t = this.ctx.currentTime;
    this.mGain.gain.cancelScheduledValues(t);
    this.mGain.gain.setValueAtTime(this.mGain.gain.value, t);
    this.mGain.gain.linearRampToValueAtTime(MUSIC_VOL * 0.3, t + 0.05);
    this.mGain.gain.setTargetAtTime(MUSIC_VOL, t + 0.4, 0.3);
  }

  _musicBar(t0, bar) {
    const step = MUSIC_BAR / 16;
    const hit = (fn, s, ...args) => fn.call(this, t0 + s * step, ...args);

    for (const s of bar % 4 === 3 ? [0, 6, 8, 14] : [0, 6, 8]) hit(this._mKick, s);
    hit(this._mSnare, 4, 0.5);
    hit(this._mSnare, 12, 0.55);
    if (bar % 2 === 1) hit(this._mSnare, 15, 0.16);
    for (let s = 0; s < 16; s += 2) hit(this._mHat, s, s === 2 || s === 10 ? 0.09 : 0.045);

    const D = 73.42, C = 65.41, F = 87.31, G = 98.0;
    const line = bar % 4 === 3 ? [D, D, F, G, D, C, D, F] : [D, D, F, D, D, C, D, D];
    line.forEach((f, i) => hit(this._mBass, i * 2, f));

    if (bar % 8 === 4) hit(this._mStab, 0);
    if (bar % 8 === 7) for (let i = 0; i < 4; i++) hit(this._mTom, 12 + i, 170 - i * 24);
  }

  _mKick(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.1);
    const g = c.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(this.mGain);
    o.start(t);
    o.stop(t + 0.24);
  }

  _mSnare(t, vol) {
    const c = this.ctx;
    const src = this._noise(0.12);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.9;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    src.connect(bp).connect(g).connect(this.mGain);
    src.start(t);
  }

  _mHat(t, vol) {
    const c = this.ctx;
    const src = this._noise(0.035);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(hp).connect(g).connect(this.mGain);
    src.start(t);
  }

  _mBass(t, freq) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 330;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(lp).connect(g).connect(this.mGain);
    o.start(t);
    o.stop(t + 0.17);
  }

  _mStab(t) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0.11, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(g).connect(this.mGain);
    for (const f of [146.83, 155.56]) { // D3 + Eb3 — minor-second menace
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.42);
    }
  }

  _mTom(t, freq) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.1);
    const g = c.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(this.mGain);
    o.start(t);
    o.stop(t + 0.14);
  }

  _noise(sec) {
    const c = this.ctx;
    const len = (c.sampleRate * sec) | 0;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    return src;
  }

  // ---------- defense SFX ----------
  // dodge: air whoosh — swept bandpass noise, no transient
  whoosh() {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const src = this._noise(0.3);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.2;
    const f0 = 950 * (0.85 + Math.random() * 0.3);
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(240, t + 0.24);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    src.connect(bp).connect(g).connect(this.out());
    src.start(t);
  }

  // block: forearms catching the shot — dull knock, no sub weight, tiny clack
  blockHit(heavy) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const knock = c.createOscillator();
    knock.type = 'triangle';
    knock.frequency.setValueAtTime(heavy ? 200 : 240, t);
    knock.frequency.exponentialRampToValueAtTime(105, t + 0.07);
    const kg = c.createGain();
    kg.gain.setValueAtTime(heavy ? 0.55 : 0.4, t);
    kg.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    knock.connect(kg).connect(this.out());
    knock.start(t);
    knock.stop(t + 0.12);

    const thump = this._noise(0.05);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    const tg = c.createGain();
    tg.gain.value = heavy ? 0.5 : 0.35;
    thump.connect(lp).connect(tg).connect(this.out());
    thump.start(t);

    const clack = this._noise(0.02);
    const hp2 = c.createBiquadFilter();
    hp2.type = 'highpass';
    hp2.frequency.value = 2600;
    const cg = c.createGain();
    cg.gain.value = 0.12;
    clack.connect(hp2).connect(cg).connect(this.out());
    clack.start(t);
  }

  victory(cfg) {
    // the post-match line owns the stage — cut any lingering crit shout
    for (const v of Object.values(this.voices || {})) {
      try { v.pause(); } catch { /* ignore */ }
    }
    this._voiceUntil = 0;
    const a = this.voices?.[cfg.id];
    if (a) {
      try {
        a.currentTime = 0;
        a.volume = 0.95;
        a.play().catch(() => {});
      } catch {
        /* ignore */
      }
    }
    this.bell();
  }
}
const fx = new FX();
window.__fx = fx;

// ---------- UI ----------
const $ = s => document.querySelector(s);

const hpColor = hp =>
  hp > 55
    ? 'linear-gradient(90deg,#2ee06a,#8ff0a0)'
    : hp > 25
      ? 'linear-gradient(90deg,#ffb340,#ffd166)'
      : 'linear-gradient(90deg,#ff3b3b,#ff7b6b)';

function setPlate(side, cfg) {
  const card = $(side === 'a' ? '#card-a' : '#card-b');
  card.querySelector('.flag').textContent = cfg.flag;
  const [first, ...rest] = cfg.name.split(' ');
  card.querySelector('.pfirst').textContent = first.toUpperCase();
  card.querySelector('.plast').textContent = rest.join(' ').toUpperCase();
  card.querySelector('.nick').textContent = cfg.nick.toUpperCase();
  card.querySelector('.hpwrap').setAttribute('aria-label', `${cfg.name} health`);
  const rows = [
    ['STR', cfg.stats.striking],
    ['GRP', cfg.stats.grappling],
    ['CAR', cfg.stats.cardio],
    ['CHN', cfg.stats.chin],
    ['SPD', cfg.stats.speed],
  ];
  card.querySelector('.skills').innerHTML = rows
    .map(([n, v]) => `<div class="skill"><span>${n}</span><div class="sbar"><div style="width:${v}%"></div></div><b>${v}</b></div>`)
    .join('');
}

function popDamage(card, dmg, crit) {
  const s = document.createElement('span');
  s.className = `dmgpop${crit ? ' crit' : ''}`;
  s.textContent = `-${dmg}`;
  card.appendChild(s);
  setTimeout(() => s.remove(), 1000);
}

function confetti() {
  const box = $('#confetti');
  const emojis = ['🎉', '🥊', '⭐', '🇬🇪', '🔥', '👑'];
  for (let i = 0; i < 90; i++) {
    const s = document.createElement('span');
    s.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    s.style.left = `${Math.random() * 100}vw`;
    s.style.fontSize = `${20 + Math.random() * 16}px`;
    s.style.animationDuration = `${2.2 + Math.random() * 2}s`;
    s.style.animationDelay = `${Math.random() * 0.5}s`;
    box.appendChild(s);
  }
}

function showBanner(winner, loser, sub) {
  $('#bannerText').textContent = winner ? `${winner.cfg.short} WON!` : 'DRAW';
  const color = winner ? winner.corner : '#d4af37';
  $('#bannerText').style.color = color;
  $('#bannerText').style.textShadow = `0 0 40px ${color}, 0 4px 18px rgba(0,0,0,0.9)`;
  $('#bannerSub').textContent = sub;
  $('#banner').classList.remove('hidden');
}

function flashRoundCard(text) {
  const rc = $('#roundCard');
  rc.textContent = text;
  rc.classList.remove('show');
  void rc.offsetWidth;
  rc.classList.add('show');
}

let shake = 0;
const addShake = s => (shake = Math.max(shake, s));

// ---------- Fighters / match lifecycle ----------
const fighters = {};
let fighterA = null;
let fighterB = null;
let engine = null;
let selA = 'merab';
let selB = 'ilia';
let activeSide = 'A'; // which corner the next roster tap assigns (MK-style: alternates)
let menuOpen = false;

function updateHP() {
  if (!fighterA) return;
  for (const [f, id, gid] of [[fighterA, '#hp-a', '#hpg-a'], [fighterB, '#hp-b', '#hpg-b']]) {
    const el = $(id);
    el.style.width = `${f.hp}%`;
    el.style.background = hpColor(f.hp);
    $(gid).style.width = `${f.hp}%`;
    el.parentElement.setAttribute('aria-valuenow', Math.round(f.hp));
    el.parentElement.setAttribute('aria-valuetext', `${Math.round(f.hp)} HP`);
  }
}

const engineCallbacks = {
  onHP: updateHP,
  onLine: line => {
    const el = $('#commentary');
    el.textContent = line;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  },
  onImpact: (heavy, crit, kind) => {
    fx.impact(kind, heavy, crit);
    addShake(crit ? 0.2 : heavy ? 0.13 : 0.06);
  },
  onCrit: atk => {
    fx.critVoice(atk.cfg);
    fx.duckMusic();
  },
  onDodge: () => fx.whoosh(),
  onBlock: heavy => fx.blockHit(heavy),
  onDamage: (def, dmg, crit) => {
    const card = def === fighterA ? $('#card-a') : $('#card-b');
    popDamage(card, dmg, crit);
    card.classList.remove('hurt');
    void card.offsetWidth;
    card.classList.add('hurt');
  },
  onKO: (winner, loser, info) => {
    fx.stopMusic();
    showBanner(winner, loser, info.method === 'flash'
      ? `KNOCKS OUT ${loser.cfg.name.toUpperCase()} COLD in round ${info.round}!`
      : `${winner.cfg.name} defeats ${loser.cfg.name} by KO in round ${info.round}`);
    confetti();
    fx.victory(winner.cfg);
  },
  onDecision: (winner, loser, cards) => {
    fx.stopMusic();
    if (winner) {
      showBanner(winner, loser, `${winner.cfg.name} takes the decision ${cards} after 3 rounds`);
      confetti();
      fx.victory(winner.cfg);
    } else {
      showBanner(null, null, `Judges score it ${cards} — dead even after 3 rounds`);
      fx.bell();
    }
  },
  onRound: (() => {
    let last = '';
    return (round, tLeft) => {
      const txt = `0:${String(Math.ceil(tLeft)).padStart(2, '0')}`;
      const memo = `${round}|${txt}`;
      if (memo !== last) {
        last = memo;
        $('#roundLabel').textContent = `R${round}`;
        $('#roundClock').textContent = txt;
      }
    };
  })(),
  onRoundCard: flashRoundCard,
  onBell: () => fx.bell(),
};

function startMatch(idA, idB, seed = null) {
  // multiplayer passes a shared seed: both clients replay the identical fight
  setFightRng(seed == null ? null : seededRng(seed));
  readyA = readyB = false; // a READY toggle racing the start must not fire a second one
  for (const f of Object.values(fighters)) f.root.visible = false;
  fighterA = fighters[idA];
  fighterB = fighters[idB];
  fighterA.corner = '#3b6cff';
  fighterB.corner = '#ff3b4d';
  fighterA.startPos.set(-1.1, 0, 0);
  fighterB.startPos.set(1.1, 0, 0);
  fighterA.root.visible = true;
  fighterB.root.visible = true;
  setPlate('a', fighterA.cfg);
  setPlate('b', fighterB.cfg);
  engine = new Engine(fighterA, fighterB, engineCallbacks);
  menuOpen = false;
  document.body.classList.remove('menuOpen');
  $('#menu').classList.add('hidden');
  fx.bell();
  fx.startMusic();
  engine.start();
  updateHP();
  updateNetUi(); // reveal the in-fight mic toggle in multiplayer
  window.__fight = { engine, fighters, fighterA, fighterB, simFight };
}

// ---------- Fighter select menu (MK-style, live 3D preview) ----------
// One-shot face portraits for the roster tiles: render each fighter's head
// with a throwaway offscreen renderer at load time (models are still in bind
// pose — mixers haven't ticked — so every face is neutral and forward).
function makeThumbs() {
  const thumbs = {};
  try {
    const tr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    tr.setSize(156, 156);
    tr.outputColorSpace = THREE.SRGBColorSpace;
    tr.toneMapping = THREE.ACESFilmicToneMapping;
    tr.toneMappingExposure = 1.18;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
    const bg = scene.background;
    const fog = scene.fog;
    scene.background = null; // keep tile corners transparent
    scene.fog = null;
    // frame off the bounding box, not the Head bone — bone origins sit at
    // different heights per rig and cropped some faces at the chin/forehead
    const box = new THREE.Box3();
    for (const f of Object.values(fighters)) {
      f.root.visible = true;
      scene.updateMatrixWorld(true);
      box.setFromObject(f.root);
      const cx = (box.min.x + box.max.x) / 2;
      const eyeY = box.max.y - 0.12; // crown sits ~0.12m above the eyes
      cam.position.set(cx, eyeY, box.max.z + 0.45);
      cam.lookAt(cx, eyeY - 0.01, (box.min.z + box.max.z) / 2);
      tr.render(scene, cam);
      thumbs[f.cfg.id] = tr.domElement.toDataURL();
      f.root.visible = false;
    }
    scene.background = bg;
    scene.fog = fog;
    tr.dispose();
    tr.forceContextLoss?.();
  } catch (err) {
    console.warn('portrait render failed — tiles fall back to flags', err);
  }
  return thumbs;
}

// The picked fighters stand in the octagon behind the transparent menu
// center, each looping their signature clip; a fresh pick plays the victory
// clip once as a selection flourish before settling into the loop.
// portrait phones crop a wide two-shot — stand the fighters closer together
// and pull the camera further back there (see the menu branch of the loop)
const previewSpread = () => (camera.aspect < 0.9 ? 0.55 : 0.85);
const _lookOut = new THREE.Vector3();
const _previewP = new THREE.Vector3();

function updateMenuPreview(changedSide = null) {
  for (const f of Object.values(fighters)) f.root.visible = false;
  for (const side of ['A', 'B']) {
    const f = fighters[side === 'A' ? selA : selB];
    if (f.state !== 'idle') f.reset(); // clear KO tilt / victory turn from the last fight
    const p = _previewP.set((side === 'A' ? -1 : 1) * previewSpread(), 0, 0);
    f.pos.copy(p);
    f.faceToward(_lookOut.set(p.x * 0.25, 0, 9), 0, true);
    f.root.visible = true;
    if (side === changedSide) {
      if (f.cfg.victoryClip !== f.cfg.builtin) {
        f.play(f.cfg.victoryClip, { once: true, fade: 0.12, onDone: () => f.play(f.cfg.builtin, { fade: 0.4 }) });
      } else {
        f.play(f.cfg.builtin, { fade: 0.12 });
      }
    } else if (f.currentKey !== f.cfg.builtin && f.currentKey !== f.cfg.victoryClip) {
      f.play(f.cfg.builtin, { fade: 0.25 });
    }
  }
}

function openMenu() {
  engine = null; // stop any finished fight from simulating behind the menu
  fighterA = null;
  fighterB = null;
  menuOpen = true;
  readyA = readyB = false; // a fresh select round always re-arms READY
  document.body.classList.add('menuOpen');
  $('#menu').classList.remove('hidden');
  refreshMenu();
  updateMenuPreview();
  updateNetUi();
}

function buildMenu(thumbs) {
  $('#rosterBar').innerHTML = FIGHTERS.map(c => `
    <button class="rtile" data-id="${c.id}" aria-label="${c.name}">
      ${thumbs[c.id] ? `<img src="${thumbs[c.id]}" alt="">` : `<span class="rflag">${c.flag}</span>`}
      <span class="rname">${c.short}</span>
    </button>`).join('');
  document.querySelectorAll('.rtile').forEach(el =>
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      if (net) {
        // online: you only ever pick your own corner, and picking un-readies you
        const other = mySide === 'A' ? selB : selA;
        if (id === other) return;
        if (mySide === 'A') { selA = id; readyA = false; }
        else { selB = id; readyB = false; }
        net.send({ t: 'pick', side: mySide, id });
        refreshMenu();
        updateNetUi();
        updateMenuPreview(mySide);
        return;
      }
      if (activeSide === 'A') {
        selA = id;
        if (selB === id) selB = FIGHTERS.find(c => c.id !== id).id;
      } else {
        selB = id;
        if (selA === id) selA = FIGHTERS.find(c => c.id !== id).id;
      }
      const changed = activeSide;
      activeSide = activeSide === 'A' ? 'B' : 'A'; // MK flow: corners alternate
      refreshMenu();
      updateMenuPreview(changed);
    }),
  );
  $('#mplateA').addEventListener('click', () => { if (!net) { activeSide = 'A'; refreshMenu(); } });
  $('#mplateB').addEventListener('click', () => { if (!net) { activeSide = 'B'; refreshMenu(); } });
}

function refreshMenu() {
  document.querySelectorAll('.rtile').forEach(el => {
    el.classList.toggle('selA', el.dataset.id === selA);
    el.classList.toggle('selB', el.dataset.id === selB);
  });
  for (const [pid, sel, side] of [['#mplateA', selA, 'A'], ['#mplateB', selB, 'B']]) {
    const cfg = FIGHTERS.find(c => c.id === sel);
    const p = $(pid);
    p.querySelector('.mpname').textContent = cfg.name.toUpperCase();
    p.querySelector('.mpnick').textContent = cfg.nick.toUpperCase();
    p.querySelector('.mpstat').textContent =
      `STR ${cfg.stats.striking} · GRP ${cfg.stats.grappling} · SPD ${cfg.stats.speed} · CAR ${cfg.stats.cardio}`;
    p.querySelector('.mpready').classList.toggle('hidden', !(netConnected() && (side === 'A' ? readyA : readyB)));
    p.classList.toggle('active', activeSide === side);
  }
}

// ---------- Multiplayer (PeerJS: DataChannel for the lobby, WebRTC voice) ----------
// Host = blue corner, guest = red. Each client only picks its own side; the
// fight itself is the seeded deterministic sim, so only {seed, picks} travel.
let net = null;
let mySide = 'A';
let readyA = false;
let readyB = false;

const netConnected = () => !!net?.conn?.open;
const HINT_DEFAULT = "3 rounds × 30 seconds — win by KO, flash KO, or the judges' scorecards";

// One persistent, DOM-attached element for the opponent's voice: iOS Safari
// refuses audio on detached elements, and its autoplay policy blocks play()
// outside a gesture unless the page holds a live mic capture — which it
// doesn't when the user tapped "Don't Allow". The CREATE/JOIN tap pre-unlocks
// the element; if play() is still refused, the next tap anywhere retries.
const remoteAudioEl = document.createElement('audio');
remoteAudioEl.autoplay = true;
remoteAudioEl.setAttribute('playsinline', '');
document.body.appendChild(remoteAudioEl);

function unlockRemoteAudio() { // must be called from inside a tap handler
  remoteAudioEl.muted = true;
  remoteAudioEl.play().catch(() => {});
  remoteAudioEl.pause();
  remoteAudioEl.muted = false;
}

function tryPlayRemote() {
  remoteAudioEl.play().catch(() => {
    document.addEventListener('pointerup', () => remoteAudioEl.play().catch(() => {}), { once: true });
  });
}

// mid-fight the menu (and #menuHint) is hidden — surface network events
// through the commentary lower-third instead
function netToast(message) {
  const el = $('#commentary');
  el.textContent = `📵 ${message}`;
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

const netCallbacks = {
  onOpen: () => updateNetUi(),
  onConnect: () => {
    readyA = readyB = false;
    net.send({ t: 'hello', v: PROTOCOL_VERSION, side: mySide, pick: mySide === 'A' ? selA : selB, ready: false });
    fx.bell();
    refreshMenu();
    updateNetUi();
  },
  onMsg: d => onNetMsg(d),
  onClose: () => {
    readyA = readyB = false;
    if (net?.isHost) {
      // guest dropped: keep the lobby registered on the same code for a rejoin
      if (!menuOpen) netToast('OPPONENT DISCONNECTED');
      else $('#menuHint').textContent = 'OPPONENT DISCONNECTED — LOBBY STILL OPEN, SAME CODE';
      refreshMenu();
      updateNetUi();
    } else {
      teardownNet('OPPONENT LEFT THE LOBBY');
    }
  },
  onError: err => {
    const MESSAGES = {
      'no-lobby': 'NO LOBBY WITH THAT CODE',
      'connect-timeout': 'COULD NOT REACH THE OPPONENT — ONE NETWORK IS BLOCKING P2P, TRY WIFI',
      'negotiation-failed': 'COULD NOT REACH THE OPPONENT — ONE NETWORK IS BLOCKING P2P, TRY WIFI',
      network: 'LOBBY SERVER UNREACHABLE — CHECK CONNECTION AND TRY AGAIN',
      'server-error': 'LOBBY SERVER OVERLOADED — TRY AGAIN IN A MINUTE',
      'socket-error': 'LOBBY SERVER DROPPED THE LINE — TRY AGAIN',
      'socket-closed': 'LOBBY SERVER DROPPED THE LINE — TRY AGAIN',
    };
    teardownNet(MESSAGES[err.type] || 'CONNECTION FAILED — TRY AGAIN');
  },
  onRetry: (n, max) => {
    $('#netStatus').textContent = `RECONNECTING… (${n}/${max})`;
  },
  onRemoteStream: stream => {
    remoteAudioEl.srcObject = stream;
    tryPlayRemote();
  },
  onMicState: () => updateNetUi(),
};

function onNetMsg(d) {
  switch (d.t) {
    case 'hello':
    case 'pick': {
      // stale-cache guard: a mismatched build replays the same seed into a
      // DIFFERENT fight with zero errors — refuse loudly instead
      if (d.t === 'hello' && d.v !== PROTOCOL_VERSION) {
        net?.send({ t: 'badver' });
        teardownNet('GAME VERSIONS DIFFER — RELOAD THE PAGE ON BOTH PHONES');
        break;
      }
      const id = d.pick ?? d.id;
      if (d.side === 'A') { selA = id; readyA = d.ready ?? false; }
      else { selB = id; readyB = d.ready ?? false; }
      if (selA === selB) {
        // simultaneous same-pick: side B yields on BOTH ends, and the alt
        // derives from the colliding id — crossed corrections converge
        selB = FIGHTERS.find(c => c.id !== selA).id;
        readyB = false;
        net?.send({ t: 'pick', side: 'B', id: selB });
      }
      refreshMenu();
      updateNetUi();
      if (menuOpen) updateMenuPreview(d.side);
      break;
    }
    case 'badver':
      teardownNet('GAME VERSIONS DIFFER — RELOAD THE PAGE ON BOTH PHONES');
      break;
    case 'ready':
      if (!menuOpen) break; // stale toggle arriving mid-fight must not restart the match
      if (d.side === 'A') readyA = d.ready; else readyB = d.ready;
      refreshMenu();
      updateNetUi();
      maybeHostStart();
      break;
    case 'start':
      if (typeof d.seed !== 'number') { teardownNet('GAME VERSIONS DIFFER — RELOAD THE PAGE ON BOTH PHONES'); break; }
      selA = d.a;
      selB = d.b;
      fx.init();
      startMatch(d.a, d.b, d.seed);
      break;
    case 'rematch':
      if (typeof d.seed !== 'number') { teardownNet('GAME VERSIONS DIFFER — RELOAD THE PAGE ON BOTH PHONES'); break; }
      doRematch(d.seed);
      break;
    case 'rematchReq':
      if (net?.isHost) {
        const seed = (Math.random() * 0x7fffffff) | 0;
        net.send({ t: 'rematch', seed });
        doRematch(seed);
      }
      break;
    case 'menu':
      closeBannerToMenu();
      break;
  }
}

function maybeHostStart() {
  if (net?.isHost && netConnected() && readyA && readyB) {
    const seed = (Math.random() * 0x7fffffff) | 0;
    net.send({ t: 'start', a: selA, b: selB, seed });
    startMatch(selA, selB, seed);
  }
}

function teardownNet(message = null) {
  net?.destroy();
  net = null;
  remoteAudioEl.srcObject = null; // keep the element — its gesture unlock persists across lobbies
  readyA = readyB = false;
  mySide = 'A';
  refreshMenu();
  updateNetUi();
  if (message) {
    $('#menuHint').textContent = message;
    if (!menuOpen) netToast(message); // the hint is invisible mid-fight
  }
}

function updateNetUi() {
  $('#netIdle').classList.toggle('hidden', !!net);
  $('#netLive').classList.toggle('hidden', !net);
  const fight = $('#menuFightBtn');
  if (net) {
    $('#netStatus').innerHTML = netConnected()
      ? `LIVE — YOU ARE ${mySide === 'A' ? 'BLUE' : 'RED'}`
      : net.isHost
        // only a server-CONFIRMED code is shareable — an unregistered one can
        // still collide and get silently rerolled
        ? (net.registered && net.code ? `LOBBY <b>${net.code}</b> — SHARE THIS CODE` : 'OPENING LOBBY…')
        : 'CONNECTING…';
    const mic = $('#netMicBtn');
    mic.className = `netBtn ${net.micState}`;
    mic.textContent = net.micState === 'muted' ? '🔇' : '🎤';
    mic.title = net.micState === 'blocked' ? 'Microphone blocked by the browser' : 'Toggle microphone';
  }
  const gmic = $('#gameMicBtn');
  if (net && !menuOpen) {
    gmic.textContent = net.micState === 'muted' ? '🔇' : '🎤';
    gmic.className = net.micState;
  } else {
    gmic.className = 'hidden';
  }
  if (!net) {
    fight.disabled = false;
    fight.textContent = 'FIGHT';
    $('#menuHint').textContent = HINT_DEFAULT;
  } else if (!netConnected()) {
    fight.disabled = true;
    fight.textContent = 'WAITING…';
    $('#menuHint').textContent = 'your friend joins with the code — they fight out of the red corner';
  } else {
    fight.disabled = false;
    const myReady = mySide === 'A' ? readyA : readyB;
    fight.textContent = myReady ? 'CANCEL READY' : 'READY';
    $('#menuHint').textContent = readyA && readyB
      ? 'STARTING…'
      : 'both corners must press READY — the mic is live while you pick';
  }
}

function doRematch(seed) {
  if (!engine) return; // a 'rematch' can land after this side already left to the menu
  $('#banner').classList.add('hidden');
  $('#confetti').innerHTML = '';
  setFightRng(seed == null ? null : seededRng(seed));
  fx.bell();
  fx.startMusic();
  engine.start();
}

function closeBannerToMenu() {
  $('#banner').classList.add('hidden');
  $('#confetti').innerHTML = '';
  openMenu();
}

$('#netHostBtn').addEventListener('click', () => {
  fx.init();
  unlockRemoteAudio();
  teardownNet();
  net = new Net(netCallbacks);
  mySide = 'A';
  activeSide = 'A';
  net.host();
  updateNetUi();
});

$('#netJoinBtn').addEventListener('click', () => {
  fx.init();
  unlockRemoteAudio();
  const code = $('#netCodeInput').value.trim();
  if (!/^\d{4}$/.test(code)) {
    $('#menuHint').textContent = 'ENTER THE 4-DIGIT LOBBY CODE';
    return;
  }
  teardownNet();
  net = new Net(netCallbacks);
  mySide = 'B';
  activeSide = 'B';
  net.join(code);
  refreshMenu();
  updateNetUi();
});

$('#netCodeInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('#netJoinBtn').click();
});

const toggleMic = () => {
  if (net && net.micState !== 'blocked' && net.micState !== 'off') net.toggleMute();
};
$('#netMicBtn').addEventListener('click', toggleMic);
$('#gameMicBtn').addEventListener('click', toggleMic);

$('#netLeaveBtn').addEventListener('click', () => teardownNet('LEFT THE LOBBY'));

$('#menuFightBtn').addEventListener('click', () => {
  fx.init();
  if (net) {
    if (!netConnected()) return;
    if (mySide === 'A') readyA = !readyA; else readyB = !readyB;
    net.send({ t: 'ready', side: mySide, ready: mySide === 'A' ? readyA : readyB });
    refreshMenu();
    updateNetUi();
    maybeHostStart();
    return;
  }
  startMatch(selA, selB);
});

$('#rematchBtn').addEventListener('click', () => {
  if (net) {
    if (!netConnected()) return;
    if (net.isHost) {
      const seed = (Math.random() * 0x7fffffff) | 0;
      net.send({ t: 'rematch', seed });
      doRematch(seed);
    } else {
      net.send({ t: 'rematchReq' }); // host owns the seed
    }
    return;
  }
  doRematch(null);
});

$('#changeBtn').addEventListener('click', () => {
  if (net && netConnected()) net.send({ t: 'menu' });
  closeBannerToMenu();
});

// ---------- Async load ----------
const loadFill = $('#loadFill');
const loadText = $('#loadText');

loadAssets(FIGHTERS, (loaded, total) => {
  loadFill.style.width = `${Math.round((loaded / total) * 100)}%`;
  loadText.textContent = `Loading arena… ${loaded}/${total}`;
}).then(({ models, clipSets, overlayDeltas, octagon }) => {
  octagon.scale.setScalar(6.0);
  scene.add(octagon);
  octagon.updateMatrixWorld(true); // raycaster uses matrixWorld as-is
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
  const hits = ray.intersectObject(octagon, true);
  if (hits.length) octagon.position.y -= hits[0].point.y;
  else console.warn('octagon alignment raycast missed — model may float');

  FIGHTERS.forEach((cfg, i) => {
    const f = new Fighter3D(cfg, scene, {
      model: models[i],
      clips: clipSets[cfg.rig],
      bindDelta: overlayDeltas[cfg.rig],
      pos: new THREE.Vector3(i === 0 ? -1.1 : 1.1, 0, 0),
      corner: '#fff',
    });
    f.root.visible = false;
    fighters[cfg.id] = f;
  });
  fx.loadVoices(FIGHTERS);
  buildMenu(makeThumbs());
  $('#loading').classList.add('hidden');
  openMenu();
  window.__fight = { fighters, simFight };
}).catch(err => {
  console.error(err);
  loadText.textContent = `Failed to load — ${err?.message || err}`;
  loadFill.style.background = '#ff3b4d';
});

// ---------- Loop ----------
const clock = new THREE.Clock();
const SIM_STEP = 1 / 60;
let simAcc = 0;
let radius = 4.6;
let camY = 2.45;

// auto-quality: sustained slow frames step the pixel ratio down — fill rate
// dominates on weak GPUs. Never steps back up; a session settles where it runs.
let frameEMA = 16;
let lastDownshift = 0;
function autoQuality(rawDtMs, t) {
  if (rawDtMs > 250) return; // hidden-tab hiccup, not real load
  frameEMA += (rawDtMs - frameEMA) * 0.05;
  if (frameEMA > 26 && dprCap > 1 && t - lastDownshift > 4) {
    dprCap = Math.max(1, dprCap - 0.25);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
    lastDownshift = t;
    frameEMA = 16;
  }
}
const camTarget = new THREE.Vector3(0, 1.0, 0);

renderer.setAnimationLoop(() => {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  const t = clock.elapsedTime;
  autoQuality(rawDt * 1000, t);

  // Fixed-step sim: seeded multiplayer fights must consume the rng stream at
  // identical sim times on both clients, so the engine and fighters advance
  // in 1/60s quanta regardless of the device's frame rate.
  simAcc = Math.min(simAcc + dt, 0.2);
  while (simAcc >= SIM_STEP) {
    simAcc -= SIM_STEP;
    engine?.update(SIM_STEP);
    for (const f of Object.values(fighters)) {
      if (f.root.visible) f.update(SIM_STEP);
    }
  }

  if (menuOpen) {
    // select screen: settle into a close two-shot of the preview fighters
    camTarget.x += (0 - camTarget.x) * Math.min(1, dt * 2);
    camTarget.z += (0.2 - camTarget.z) * Math.min(1, dt * 2);
    const menuR = camera.aspect < 0.9 ? 6.0 : 5.0;
    radius += (menuR - radius) * Math.min(1, dt * 1.6);
    camY += (2.2 - camY) * Math.min(1, dt * 1.6);
  } else if (fighterA && fighterB) {
    const mid = fighterA.pos.clone().add(fighterB.pos).multiplyScalar(0.5);
    camTarget.x += (mid.x - camTarget.x) * Math.min(1, dt * 3);
    camTarget.z += (mid.z - camTarget.z) * Math.min(1, dt * 3);
    const dist = fighterA.distanceTo(fighterB);
    const targetR = engine.state === 'ko' ? 3.6 : Math.min(5.1, Math.max(4.1, 3.7 + dist * 0.5));
    radius += (targetR - radius) * Math.min(1, dt * 1.6);
    const targetY = engine.state === 'ko' ? 1.95 : 2.45;
    camY += (targetY - camY) * Math.min(1, dt * 1.6);
  }

  const ang = Math.sin(t * 0.1) * 0.4;
  // clamp the eye inside the cage: fence flat sides sit at ~5.4 world radius
  const dirX = Math.sin(ang), dirZ = Math.cos(ang);
  const MAX_R = 5.0;
  const td = camTarget.x * dirX + camTarget.z * dirZ;
  const t2 = camTarget.x * camTarget.x + camTarget.z * camTarget.z;
  // floor at 2.4 so the fence clamp can never pull the eye inside the
  // fighters when an exchange happens against the cage
  const rEye = Math.max(2.4, Math.min(radius, -td + Math.sqrt(Math.max(0, td * td + MAX_R * MAX_R - t2))));
  camera.position.set(
    camTarget.x + dirX * rEye,
    camY + Math.sin(t * 0.23) * 0.07,
    camTarget.z + dirZ * rEye,
  );
  if (shake > 0.002) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake * 0.7;
    shake *= Math.exp(-5 * dt);
  }
  camera.lookAt(camTarget.x, 1.02, camTarget.z);

  faceFill.position.set(camera.position.x, camera.position.y + 1.2, camera.position.z);
  faceFill.target.position.set(camTarget.x, 1.4, camTarget.z);

  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (menuOpen) updateMenuPreview(); // re-space the two-shot for the new aspect
});
