import * as THREE from 'three';
import { FIGHTERS } from './fighters/index.js?v=202608281148';
import { MOVES } from './moves/index.js?v=202608281148';
import { loadAssets } from './anim.js?v=202608281148';
import { Fighter3D } from './fighter3d.js?v=202608281148';
import { Engine, simFight, setFightRng, seededRng } from './modes/octagon/fight.js?v=202608281148';
import { Net, PROTOCOL_VERSION } from './net.js?v=202608281148';
import { AutochessMode, PHASE as AUTOCHESS_PHASE } from './modes/autochess/mode.js?v=202608281148';
import { AutochessUI } from './modes/autochess/ui.js?v=202608281148';
import { cellId as autochessCellId } from './modes/autochess/hex.js?v=202608281148';

// Build stamp. GitHub Pages serves assets with max-age=600, so a phone can run
// ten-minute-old modules after a deploy and look like nothing shipped. This
// shows on the loading screen so "did it update?" is answerable at a glance.
const BUILD = '2026-08-28 11:48';
window.__BUILD = BUILD;

// Visible error trap. iOS Safari has no reachable console on a user's phone,
// so a script error that kills an event handler is indistinguishable from "the
// button does nothing". Any uncaught error paints a red ribbon with the
// message so a screenshot is a bug report.
function reportFatal(msg) {
  let el = document.getElementById('errRibbon');
  if (!el) {
    el = document.createElement('div');
    el.id = 'errRibbon';
    el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;background:#a11;color:#fff;' +
      'font:11px/1.4 monospace;padding:6px 10px;white-space:pre-wrap;word-break:break-all;pointer-events:auto';
    el.onclick = () => el.remove();
    document.body.appendChild(el);
  }
  el.textContent += (el.textContent ? '\n' : '') + msg;
}
window.addEventListener('error', e =>
  reportFatal(`${e.message} @ ${(e.filename || '').split('/').pop().split('?')[0]}:${e.lineno}`));
window.addEventListener('unhandledrejection', e =>
  reportFatal('unhandled: ' + (e.reason?.message || e.reason)));

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

  // iOS refuses HTMLAudioElement.play() outside a user gesture until each
  // element has been played once from inside one. Do that silently on the
  // first real interaction, or the very first voice line of a session is lost.
  unlockElements() {
    const els = [...Object.values(this.voices || {}), ...Object.values(this.announces || {})];
    if (this._elementsUnlocked || !els.length) return;
    this._elementsUnlocked = true;
    for (const a of els) {
      try {
        a.muted = true;
        const p = a.play();
        const restore = () => { try { a.pause(); a.currentTime = 0; } catch { /* ignore */ } a.muted = false; };
        if (p && p.then) p.then(restore).catch(restore); else restore();
      } catch {
        a.muted = false;
      }
    }
  }

  loadVoices(cfgs) {
    this.voices = {};
    this.announces = {};
    for (const c of cfgs) {
      if (c.voice.win) {
        const a = new Audio(c.voice.win);
        a.preload = 'auto';
        this.voices[c.id] = a;
      }
      if (c.voice.announce) {
        const a = new Audio(c.voice.announce);
        a.preload = 'auto';
        this.announces[c.id] = a;
      }
    }
  }

  // ring-announcer walk-out line at the opening bell
  playAnnounce(cfg) {
    const a = this.announces?.[cfg.id];
    if (!a) return;
    try {
      a.currentTime = 0;
      a.volume = 1;
      a.play().catch(() => {});
    } catch {
      /* ignore */
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

// A WebAudio context is suspended whenever the page is backgrounded — a tab
// switch, a phone lock, an incoming call — and nothing ever resumed it, so
// sound effects and voice lines silently stopped for the rest of the session.
// init() is idempotent and cheap, so resume on any gesture and on regaining
// visibility rather than only on the four buttons that used to call it.
const resumeAudio = () => {
  fx.init();
  fx.unlockElements();
};
for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
  document.addEventListener(ev, resumeAudio, { capture: true, passive: true });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) fx.init(); });

// ---------- UI ----------
const $ = s => document.querySelector(s);

const hpColor = hp =>
  hp > 55
    ? 'linear-gradient(90deg,#2ee06a,#8ff0a0)'
    : hp > 25
      ? 'linear-gradient(90deg,#ffb340,#ffd166)'
      : 'linear-gradient(90deg,#ff3b3b,#ff7b6b)';

// stance is stored as data ('orthodox' | 'southpaw'); this is its only display form
const STANCE_LABEL = { orthodox: 'Orthodox', southpaw: 'Southpaw' };

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

// ---------- broadcast chrome state ----------
let simSpeed = 1; // 1 | 2 | 4 — multiplies fixed-step consumption, never step size
let simPaused = false;
let portraits = {}; // face thumbs, reused by roster tiles, corner cards, rankings
const fightStats = {
  a: { sig: 0, td: 0, ctrl: 0, dmg: 0, crit: 0, stam: 100 },
  b: { sig: 0, td: 0, ctrl: 0, dmg: 0, crit: 0, stam: 100 },
};
const TD_MOVES = new Set(['leg_sweep', 'sweeping_kick', 'backflip_kick']); // count as sweeps/takedowns
const fmtCtrl = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// ---------- autochess mode ----------
// Entirely additive: `autochessMode` stays null until the mode is entered, and every
// hook below no-ops while it is. Auto-sim and control keep their exact paths.
let autochessMode = null;   // AutochessMode instance
let autochessUi = null;
let autochessActive = false;
let selectedMode = 'auto'; // 'auto' | 'control' | 'autochess'
let loadedAssets = null;   // { models, clipSets, overlayDeltas } — set once loading finishes
let octagonRoot = null;    // the octagon GLB, hidden while the autochess cage is up

// ---------- player-control mode (solo only; AUTO-SIM stays the default) ----------
let ctlMode = false;
let ctlStam = 100;
let ctlDodgeCd = 0;
const CTL_COST = { light: 16, heavy: 26, special: 34, dodge: 14 };

function ctlActive() {
  return !!engine?.ctl;
}

function updateCtlPad() {
  $('#ctlStamFill').style.width = `${ctlStam}%`;
  const canStrike = engine?.phase === 'cooldown' && engine?.state === 'fighting' && !engine?.roundEnding;
  for (const [id, slot] of [['#ctlLight', 'light'], ['#ctlHeavy', 'heavy'], ['#ctlSpec', 'special']]) {
    $(id).disabled = !canStrike || ctlStam < CTL_COST[slot];
  }
  $('#ctlDodge').disabled = ctlDodgeCd > 0 || ctlStam < CTL_COST.dodge || engine?.state !== 'fighting';
}

function ctlFlashStam() {
  const w = $('#ctlStamWrap');
  w.classList.remove('low');
  void w.offsetWidth;
  w.classList.add('low');
}

function ctlStrike(slot) {
  if (!ctlActive()) return;
  const move = fighterA.cfg.kit?.[slot];
  const cost = CTL_COST[slot];
  if (!move) return;
  if (ctlStam < cost) return ctlFlashStam();
  if (engine.playerStrike(move)) ctlStam -= cost;
}

function ctlDodge() {
  if (!ctlActive()) return;
  if (ctlDodgeCd > 0) return;
  if (ctlStam < CTL_COST.dodge) return ctlFlashStam();
  ctlDodgeCd = 1.1;
  ctlStam -= CTL_COST.dodge;
  engine.playerDodge();
}

function ctlGuard(held) {
  if (!ctlActive()) return;
  engine.playerGuard(held);
  $('#ctlBlock').classList.toggle('held', held);
}

function statRowsHTML(cfg) {
  return [
    ['STR', cfg.stats.striking], ['GRP', cfg.stats.grappling], ['CAR', cfg.stats.cardio],
    ['CHN', cfg.stats.chin], ['SPD', cfg.stats.speed],
  ].map(([n, v]) => `<div class="skill"><span>${n}</span><div class="sbar"><div style="width:${v}%"></div></div><b>${v}</b></div>`).join('');
}

function updateCounters() {
  for (const [side, suf] of [['a', 'A'], ['b', 'B']]) {
    const s = fightStats[side];
    $(`#ccSig${suf}`).textContent = s.sig;
    $(`#ccTd${suf}`).textContent = s.td;
    $(`#ccCt${suf}`).textContent = fmtCtrl(s.ctrl);
  }
  // targeted cell updates — rewriting the sheet's innerHTML mid-exchange
  // would replace the CLOSE button between the user's tap and the click
  if (!$('#statSheet').classList.contains('hidden')) {
    for (const [k, fmt] of [['sig', v => v], ['td', v => v], ['ctrl', fmtCtrl], ['crit', v => v], ['dmg', Math.round]]) {
      for (const side of ['a', 'b']) {
        const cell = document.querySelector(`[data-ss="${side}-${k}"]`);
        if (cell) cell.textContent = fmt(fightStats[side][k]);
      }
    }
  }
}

function resetFightStats() {
  for (const s of Object.values(fightStats)) { s.sig = s.td = s.ctrl = s.dmg = s.crit = 0; s.stam = 100; }
  updateCounters();
  updateStamina();
}

// cosmetic broadcast stamina: drains with output, recovers on the stool.
// Display-only — never touches the sim.
function updateStamina() {
  $('#sbStamA').style.width = `${fightStats.a.stam}%`;
  $('#sbStamB').style.width = `${fightStats.b.stam}%`;
}

// ---------- live event feed ----------
const FEED_MAX = 6;
function feedClear() {
  $('#feedRows').innerHTML = '';
}
function feedPush(tag, text, delta = '') {
  if (skipping) return;
  const rows = $('#feedRows');
  const row = document.createElement('div');
  row.className = 'feedRow';
  row.innerHTML = `<span class="fTime">${$('#sbClock').textContent}</span>` +
    `<span class="fTag ${tag}">${tag === 'red' ? (fighterA?.cfg.short || 'RED') : tag === 'grn' ? (fighterB?.cfg.short || 'GRN') : 'SYS'}</span>` +
    `<span class="fText">${text}</span><span class="fDelta">${delta}</span>`;
  rows.prepend(row);
  while (rows.children.length > FEED_MAX) rows.lastChild.remove();
}

function setupBroadcast() {
  const surname = f => f.cfg.name.split(' ').pop().toUpperCase();
  $('#matchTitle').textContent = `${surname(fighterA)} VS ${surname(fighterB)}`;
  for (const [f, suf, corner] of [[fighterA, 'A', 'RED'], [fighterB, 'B', 'GREEN']]) {
    $(`#sbName${suf}`).textContent = f.cfg.name.toUpperCase();
    $(`#sbTag${suf}`).textContent = `“${f.cfg.nick.toUpperCase()}” · ${corner} CORNER`;
    $(`#ccName${suf}`).textContent = f.cfg.name.toUpperCase();
    $(`#ccRec${suf}`).textContent = `${f.cfg.record || '0–0–0'} · ${STANCE_LABEL[f.cfg.stance]}`;
    $(`#ccStats${suf}`).innerHTML = statRowsHTML(f.cfg);
    const img = $(`#ccImg${suf}`);
    if (portraits[f.cfg.id]) { img.src = portraits[f.cfg.id]; img.style.display = ''; }
    else img.style.display = 'none';
  }
  resetFightStats();
  feedClear();
  $('#feedMeta').textContent = 'ROUND 1';
  $('#feed').classList.remove('hidden');
  $('#broadcast').classList.remove('hidden');
}

function renderStatSheet() {
  const A = fightStats.a, B = fightStats.b;
  const rows = [
    ['SIG. STRIKES', 'sig', A.sig, B.sig],
    ['TAKEDOWNS', 'td', A.td, B.td],
    ['CTRL TIME', 'ctrl', fmtCtrl(A.ctrl), fmtCtrl(B.ctrl)],
    ['CRITS', 'crit', A.crit, B.crit],
    ['TOTAL DAMAGE', 'dmg', Math.round(A.dmg), Math.round(B.dmg)],
  ];
  $('#statSheet').innerHTML = `<div class="sheetCard">
    <div class="sheetTitle">STAT BREAKDOWN</div>
    <div class="sheetSub">${fighterA ? fighterA.cfg.short : ''} <em>vs</em> ${fighterB ? fighterB.cfg.short : ''}</div>
    <table>${rows.map(([n, k, a, b]) => `<tr><td class="l" data-ss="a-${k}">${a}</td><th>${n}</th><td class="r" data-ss="b-${k}">${b}</td></tr>`).join('')}</table>
    <button class="sheetClose" data-close="statSheet">CLOSE</button>
  </div>`;
}

// tuned Monte-Carlo win rates vs the field (see fighters/ balance notes)
const RANK_WR = { soso: 54, gigi: 52, levan: 51, dato: 51, david: 50, ilia: 49, davit: 48, cotne: 48, merab: 46 };
function renderRankings() {
  const ranked = [...FIGHTERS].sort((x, y) => (RANK_WR[y.id] || 50) - (RANK_WR[x.id] || 50));
  $('#rankings').innerHTML = `<div class="sheetCard">
    <div class="sheetTitle">RANKINGS</div>
    <div class="sheetSub">simulated win rate vs the field</div>
    <table class="rankTable">${ranked.map((c, i) => `<tr>
      <td class="rkNum">${i + 1}</td>
      <td class="rkImg">${portraits[c.id] ? `<img src="${portraits[c.id]}" alt="">` : c.flag}</td>
      <td class="rkWho"><b>${c.name.toUpperCase()}</b><span>“${c.nick.toUpperCase()}” · ${c.record || ''}</span></td>
      <td class="rkWr">${RANK_WR[c.id] || 50}%</td>
    </tr>`).join('')}</table>
    <button class="sheetClose" data-close="rankings">CLOSE</button>
  </div>`;
}

function updateNavTabs(active) {
  document.querySelectorAll('.btab').forEach(b => b.classList.toggle('sel', b.dataset.nav === active));
}

let skipping = false; // mutes per-hit SFX/DOM spam while the skip loop burns steps

function skipToResult() {
  if (!engine || !fighterA || !fighterB) return;
  simPaused = false;
  $('#pauseLabel').textContent = 'Pause sim';
  // deterministic fast-forward: burn fixed steps until the verdict lands
  skipping = true;
  try {
    let guard = 60 * 400;
    while (guard-- && $('#banner').classList.contains('hidden')) {
      engine.update(SIM_STEP);
      fighterA.update(SIM_STEP);
      fighterB.update(SIM_STEP);
    }
  } finally {
    skipping = false;
  }
  updateHP();
  updateCounters();
}

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
  for (const [f, suf] of [[fighterA, 'A'], [fighterB, 'B']]) {
    $(`#sbHp${suf}`).textContent = Math.max(0, Math.round(f.hp));
    $(`#sbFill${suf}`).style.width = `${Math.max(0, f.hp)}%`;
    $(`#sbGhost${suf}`).style.width = `${Math.max(0, f.hp)}%`;
  }
}

const engineCallbacks = {
  onHP: updateHP,
  onLine: line => {
    if (skipping) return;
    if (/^[🔔⚖🧾😵🏆]/u.test(line)) feedPush('sys', line.replace(/^[^ ]+ /, ''));
    const el = $('#commentary');
    el.textContent = line;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  },
  onImpact: (heavy, crit, kind) => {
    if (skipping) return;
    fx.impact(kind, heavy, crit);
    addShake(crit ? 0.2 : heavy ? 0.13 : 0.06);
  },
  onCrit: atk => {
    if (skipping) return;
    fx.critVoice(atk.cfg);
    fx.duckMusic();
  },
  onDodge: () => { if (!skipping) fx.whoosh(); },
  onBlock: heavy => { if (!skipping) fx.blockHit(heavy); },
  onDamage: (def, dmg, crit, atk, moveKey) => {
    if (atk) {
      const s = fightStats[atk === fighterA ? 'a' : 'b'];
      s.sig += 1;
      s.dmg += dmg;
      if (crit) s.crit += 1;
      if (TD_MOVES.has(moveKey)) s.td += 1;
      s.ctrl += crit ? 1.1 : 0.45; // seconds the hit keeps the opponent reeling
      s.stam = Math.max(25, s.stam - 2);
    }
    if (skipping) return; // stats above still count; the DOM/flash spam doesn't
    updateStamina();
    if (atk && moveKey) {
      feedPush(atk === fighterA ? 'red' : 'grn',
        `${atk.cfg.short} lands the ${moveKey.replace(/_/g, ' ')}`, `−${dmg}`);
    }
    // mobile keeps the top plates, desktop fights show the score band — pop on both
    const card = def === fighterA ? $('#card-a') : $('#card-b');
    const band = def === fighterA ? document.querySelector('.sbA') : document.querySelector('.sbB');
    popDamage(card, dmg, crit);
    if (band) popDamage(band, dmg, crit);
    card.classList.remove('hurt');
    void card.offsetWidth;
    card.classList.add('hurt');
    if (atk) updateCounters();
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
    let lastRound = 1;
    return (round, tLeft) => {
      const txt = `0:${String(Math.ceil(tLeft)).padStart(2, '0')}`;
      const memo = `${round}|${txt}`;
      if (memo !== last) {
        last = memo;
        $('#roundLabel').textContent = `R${round}`;
        $('#roundClock').textContent = txt;
        $('#sbRound').textContent = `ROUND ${round} OF 3`;
        $('#sbClock').textContent = txt;
        $('#feedMeta').textContent = `ROUND ${round}`;
        if (round !== lastRound) {
          lastRound = round;
          for (const s of Object.values(fightStats)) s.stam = Math.min(100, s.stam + 26);
          updateStamina();
        }
      }
    };
  })(),
  onRoundCard: flashRoundCard,
  onBell: () => fx.bell(),
};

function startMatch(idA, idB, seed = null) {
  exitAutochess(); // an octagon fight must not run under a live autochess board
  // multiplayer passes a shared seed: both clients replay the identical fight
  setFightRng(seed == null ? null : seededRng(seed));
  readyA = readyB = false; // a READY toggle racing the start must not fire a second one
  for (const f of Object.values(fighters)) f.root.visible = false;
  fighterA = fighters[idA];
  fighterB = fighters[idB];
  // corner coding per the broadcast design: A = red, B = green (tints the winner banner)
  fighterA.corner = '#c8102e';
  fighterB.corner = '#00c853';
  fighterA.startPos.set(-1.1, 0, 0);
  fighterB.startPos.set(1.1, 0, 0);
  fighterA.root.visible = true;
  fighterB.root.visible = true;
  setPlate('a', fighterA.cfg);
  setPlate('b', fighterB.cfg);
  engine = new Engine(fighterA, fighterB, engineCallbacks);
  // TAKE CONTROL is strictly solo: online fights must stay deterministic
  if (ctlMode && !net) {
    engine.setControlled(fighterA);
    ctlStam = 100;
    ctlDodgeCd = 0;
    $('#ctlPad').classList.remove('hidden');
    $('#ctlKeys').style.display = matchMedia('(pointer: coarse)').matches ? 'none' : '';
  } else {
    $('#ctlPad').classList.add('hidden');
  }
  menuOpen = false;
  simPaused = false;
  $('#pauseLabel').textContent = 'Pause sim';
  document.body.classList.remove('menuOpen');
  document.body.classList.add('fighting');
  $('#menu').classList.add('hidden');
  $('#rankings').classList.add('hidden');
  $('#statSheet').classList.add('hidden');
  setupBroadcast();
  updateNavTabs('fight');
  // ring announcer walk-out line (Soso's Buffer-style intro lives here)
  for (const f of [fighterA, fighterB]) if (f.cfg.voice.announce) fx.playAnnounce(f.cfg);
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
      if (f.cfg.visual.victory !== f.cfg.visual.idle) {
        f.play(f.cfg.visual.victory, { once: true, fade: 0.12, onDone: () => f.play(f.cfg.visual.idle, { fade: 0.4 }) });
      } else {
        f.play(f.cfg.visual.idle, { fade: 0.12 });
      }
    } else if (f.currentKey !== f.cfg.visual.idle && f.currentKey !== f.cfg.visual.victory) {
      f.play(f.cfg.visual.idle, { fade: 0.25 });
    }
  }
}

function openMenu() {
  exitAutochess(); // the menu is the single funnel out of every mode
  engine = null; // stop any finished fight from simulating behind the menu
  fighterA = null;
  fighterB = null;
  menuOpen = true;
  readyA = readyB = false; // a fresh select round always re-arms READY
  document.body.classList.add('menuOpen');
  document.body.classList.remove('fighting');
  $('#broadcast').classList.add('hidden');
  $('#statSheet').classList.add('hidden');
  $('#rankings').classList.add('hidden');
  $('#ctlPad').classList.add('hidden');
  $('#menu').classList.remove('hidden');
  updateNavTabs('roster');
  refreshMenu();
  updateMenuPreview();
  updateNetUi();
}

function buildMenu(thumbs) {
  $('#rosterBar').innerHTML = FIGHTERS.map(c => `
    <button class="rtile" data-id="${c.id}" aria-label="${c.name}">
      ${thumbs[c.id] ? `<img src="${thumbs[c.id]}" alt="">` : `<span class="rflag">${c.flag}</span>`}
      <span class="rname">${c.short}</span>
      <span class="rinfo" data-info="${c.id}" title="${c.name} details">i</span>
    </button>`).join('');
  document.querySelectorAll('.rtile').forEach(el =>
    el.addEventListener('click', e => {
      const id = el.dataset.id;
      if (e.target?.dataset?.info) {          // the "i" badge opens the card instead of picking
        e.stopPropagation();
        renderFighterCard(FIGHTERS.find(c => c.id === id));
        return;
      }
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


// ---------- fighter detail card ----------
// The move list is DERIVED, not authored: each move's w() is evaluated against
// this fighter and normalised, so the card always reflects what the sim will
// actually throw. Bars are scaled 70-100, not 0-100 — the roster only spans
// ~78-98 and a full-range bar renders every fighter identical.
const STAT_FLOOR = 70;
const moveDamage = m => m.impacts.reduce((s, i) => s + (i.min + i.max) / 2, 0);

function fighterMoveset(cfg) {
  const rows = MOVES.map(m => ({ m, w: m.w(cfg) })).filter(r => r.w > 0);
  const total = rows.reduce((s, r) => s + r.w, 0);
  return rows.map(r => ({ ...r, share: 100 * r.w / total })).sort((a, b) => b.share - a.share);
}

function fighterTraits(cfg) {
  const t = [];
  if (cfg.counterSkill >= 0.4) t.push('Elite counter-striker');
  else if (cfg.counterSkill >= 0.28) t.push('Counters well');
  else if (cfg.counterSkill <= 0.15) t.push('Rarely counters');
  if (cfg.powerKO >= 3) t.push('One-punch knockout power');
  else if (cfg.powerKO >= 1.5) t.push('Real finishing pop');
  return t;
}

function renderFighterCard(cfg) {
  const S = cfg.stats;
  const bar = v => `${Math.max(0, Math.min(100, (v - STAT_FLOOR) / (100 - STAT_FLOOR) * 100))}%`;
  const stats = [['Striking', S.striking], ['Grappling', S.grappling], ['Cardio', S.cardio],
                 ['Chin', S.chin], ['Speed', S.speed]];
  const kit = Object.entries(cfg.kit).map(([slot, m]) => `<li><b>${slot}</b>${m.label}</li>`).join('');
  const moves = fighterMoveset(cfg).map(r => `
    <tr>
      <td class="fcM">${r.m.label}${r.m.heavy ? '<em>heavy</em>' : ''}</td>
      <td class="fcS"><i style="width:${r.share.toFixed(1)}%"></i><span>${r.share.toFixed(1)}%</span></td>
      <td class="fcD">${moveDamage(r.m).toFixed(1)}</td>
      <td class="fcH">${r.m.impacts.length}</td>
    </tr>`).join('');
  $('#fighterCard').innerHTML = `<div class="sheetCard fcCard">
    <div class="fcHead">
      ${portraits[cfg.id] ? `<img src="${portraits[cfg.id]}" alt="">` : `<span class="fcFlag">${cfg.flag}</span>`}
      <div>
        <div class="sheetTitle">${cfg.name.toUpperCase()}</div>
        <div class="sheetSub">“${cfg.nick.toUpperCase()}” · ${cfg.record} · ${STANCE_LABEL[cfg.stance]}</div>
      </div>
    </div>
    <div class="fcBars">${stats.map(([k, v]) =>
      `<div class="fcBar"><span>${k}</span><i><b style="width:${bar(v)}"></b></i><em>${v}</em></div>`).join('')}</div>
    ${fighterTraits(cfg).length ? `<div class="fcTraits">${fighterTraits(cfg).map(t => `<span>${t}</span>`).join('')}</div>` : ''}
    <div class="fcSect">Control kit</div>
    <ul class="fcKit">${kit}</ul>
    <div class="fcSect">Moveset <em>share · damage · hits</em></div>
    <table class="fcMoves">${moves}</table>
    <button class="sheetClose" data-close="fighterCard">CLOSE</button>
  </div>`;
  $('#fighterCard').classList.remove('hidden');
}

// ---------- Multiplayer (PeerJS: DataChannel for the lobby, WebRTC voice) ----------
// Host = blue corner, guest = red. Each client only picks its own side; the
// fight itself is the seeded deterministic sim, so only {seed, picks} travel.
let net = null;
let mySide = 'A';
let readyA = false;
let readyB = false;

const netConnected = () => !!net?.conn?.open;
const HINT_DEFAULT = "3 rounds × 30 seconds — drag the arena to move the camera, double-tap to reset";

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
  // autochess round traffic is handled by the mode's own state machine
  if (typeof d.t === 'string' && d.t.startsWith('ac-')) {
    autochessMode?.netMatch?.onMessage(d);
    return;
  }
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
      fx.init();
      if (d.mode === 'autochess') {
        selectedMode = 'autochess';
        enterAutochess({ isHost: false, seed: d.seed });
        break;
      }
      selA = d.a;
      selB = d.b;
      startMatch(d.a, d.b, d.seed);
      break;
    case 'rematch':
      if (typeof d.seed !== 'number') { teardownNet('GAME VERSIONS DIFFER — RELOAD THE PAGE ON BOTH PHONES'); break; }
      doRematch(d.seed);
      break;
    case 'rematchReq':
      // engine gate: a host already back in the menu must not launch the
      // guest into a solo "rematch" — steer both sides to the lobby instead
      if (net?.isHost && engine) {
        const seed = (Math.random() * 0x7fffffff) | 0;
        net.send({ t: 'rematch', seed });
        doRematch(seed);
      } else if (net?.isHost) {
        net.send({ t: 'menu' });
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
    if (selectedMode === 'autochess') {
      net.send({ t: 'start', mode: 'autochess', seed });
      enterAutochess({ isHost: true, seed });
      return;
    }
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
  // autochess supports online play, so the selector stays available; only
  // TAKE CONTROL is still solo-only and is disabled below
  $('#modeSeg').classList.remove('hidden');
  $('.modeBtn[data-mode="control"]').disabled = !!net;
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
  // if the opponent skipped ahead and rematched while WE are still mid-fight,
  // finish our copy first (same shared stream) so the new seed starts clean
  if ($('#banner').classList.contains('hidden')) skipToResult();
  simPaused = false;
  $('#pauseLabel').textContent = 'Pause sim';
  resetFightStats();
  feedClear();
  $('#feedMeta').textContent = 'ROUND 1';
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
  // autochess is strictly solo, like control mode — the `net` branch above
  // already returned, so online lobbies can never reach it
  if (selectedMode === 'autochess') {
    enterAutochess(null);
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

// ---------- broadcast controls ----------
$('#pauseBtn').addEventListener('click', () => {
  simPaused = !simPaused;
  $('#pauseLabel').textContent = simPaused ? 'Resume sim' : 'Pause sim';
});

document.querySelectorAll('.speedBtn').forEach(b =>
  b.addEventListener('click', () => {
    simSpeed = Number(b.dataset.speed) || 1;
    document.querySelectorAll('.speedBtn').forEach(x => x.classList.toggle('sel', x === b));
  }),
);

$('#skipBtn').addEventListener('click', () => skipToResult());

// ---------- fight-mode toggle + control pad input ----------
const MODE_HINTS = {
  auto: HINT_DEFAULT,
  control: 'you fight out of the RED corner — punch/kick/special to attack, hold block, time your dodges',
  autochess: 'buy fighters, place them on your half, and they fight for themselves — 3 of a kind upgrades',
};

document.querySelectorAll('.modeBtn').forEach(b =>
  b.addEventListener('click', () => {
    selectedMode = b.dataset.mode;
    ctlMode = selectedMode === 'control';
    document.querySelectorAll('.modeBtn').forEach(x => x.classList.toggle('sel', x === b));
    $('#menuHint').textContent = MODE_HINTS[selectedMode] || HINT_DEFAULT;
    $('#menuFightBtn').textContent = selectedMode === 'autochess' ? 'ENTER THE CAGE' : 'FIGHT';
  }),
);

// ---------- autochess entry / exit ----------
async function enterAutochess(online = null) {
  // Never construct the mode before the fighter models exist: it caches the
  // instance, so an early entry would leave `assets` null forever and every
  // unit purchase would throw.
  if (!loadedAssets) {
    loadText.textContent = 'Still loading fighters…';
    return;
  }
  if (!autochessMode) {
    autochessMode = new AutochessMode({ scene, camera, assets: loadedAssets, fx, ui: null });
    loadText.textContent = 'Loading the autochess cage…';
    $('#loading').classList.remove('hidden');
    try {
      await autochessMode.load((loaded, total) => {
        loadFill.style.width = `${Math.round((loaded / Math.max(1, total)) * 100)}%`;
      });
    } catch (err) {
      console.error(err);
      loadText.textContent = `Board failed to load — ${err?.message || err}`;
      autochessMode = null;
      return;
    }
    $('#loading').classList.add('hidden');
    autochessUi = new AutochessUI($('#autochessUi'), autochessMode, { portraits });
    autochessMode.ui = autochessUi;
  }

  // park the octagon-mode fighters and chrome
  engine = null;
  fighterA = null;
  fighterB = null;
  for (const f of Object.values(fighters)) f.root.visible = false;
  octagonRoot.visible = false;
  menuOpen = false;
  autochessActive = true;
  document.body.classList.remove('menuOpen');
  document.body.classList.add('fighting', 'autochessMode');
  $('#menu').classList.add('hidden');
  $('#broadcast').classList.add('hidden');
  $('#topbar').classList.add('hidden');
  $('#commentaryWrap').classList.add('hidden');
  $('#ctlPad').classList.add('hidden');
  $('#autochessUi').classList.remove('hidden');
  updateNavTabs('fight');

  userYaw = 0;
  userY = 0;
  // online: hand the mode a transport. The host also opens the match, which is
  // the only message needed to agree a seed — every round after that is driven
  // by the board exchange itself.
  autochessMode.start(online ? { isHost: online.isHost, send: msg => net?.send(msg) } : null);
  if (online) {
    if (online.isHost) autochessMode.netMatch.start(online.seed);
    else { autochessMode.netMatch.seed = online.seed | 0; autochessMode.netMatch.started = true; autochessMode.netMatch.round = 1; }
  }
  window.__autochess = autochessMode;
}

function exitAutochess() {
  if (!autochessActive) return;
  autochessActive = false;
  autochessMode?.stop();
  octagonRoot.visible = true;
  document.body.classList.remove('autochessMode');
  $('#autochessUi').classList.add('hidden');
  $('#topbar').classList.remove('hidden');
  $('#commentaryWrap').classList.remove('hidden');
}

$('#ctlLight').addEventListener('click', () => ctlStrike('light'));
$('#ctlHeavy').addEventListener('click', () => ctlStrike('heavy'));
$('#ctlSpec').addEventListener('click', () => ctlStrike('special'));
$('#ctlDodge').addEventListener('click', () => ctlDodge());
$('#ctlBlock').addEventListener('pointerdown', e => { e.preventDefault(); ctlGuard(true); });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
  $('#ctlBlock').addEventListener(ev, () => ctlGuard(false));
}

document.addEventListener('keydown', e => {
  if (!ctlActive() || e.repeat || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'j') ctlStrike('light');
  else if (k === 'k') ctlStrike('heavy');
  else if (k === 'l') ctlStrike('special');
  else if (k === ' ') { e.preventDefault(); ctlDodge(); }
  else if (k === 's') ctlGuard(true);
});
document.addEventListener('keyup', e => {
  if (e.key.toLowerCase() === 's') ctlGuard(false);
});

$('#statsBtn').addEventListener('click', () => {
  const sheet = $('#statSheet');
  if (sheet.classList.contains('hidden')) {
    renderStatSheet();
    sheet.classList.remove('hidden');
  } else sheet.classList.add('hidden');
});

// overlay CLOSE buttons (stat sheet + rankings render their own)
document.addEventListener('click', e => {
  const close = e.target?.dataset?.close;
  if (close) {
    $(`#${close}`).classList.add('hidden');
    if (close === 'rankings') updateNavTabs(menuOpen ? 'roster' : 'fight');
  }
});

document.querySelectorAll('.btab').forEach(b =>
  b.addEventListener('click', () => {
    if (!Object.keys(fighters).length) return; // still loading — nothing to navigate
    const nav = b.dataset.nav;
    $('#rankings').classList.add('hidden');
    if (nav === 'rankings') {
      $('#statSheet').classList.add('hidden');
      renderRankings();
      $('#rankings').classList.remove('hidden');
      updateNavTabs('rankings');
      return;
    }
    if (nav === 'fight') {
      // in the menu, FIGHT doubles as the start button; mid-fight it's home
      if (menuOpen) {
        if (!$('#menuFightBtn').disabled) $('#menuFightBtn').click();
        else updateNavTabs('roster'); // WAITING… — nothing to start yet
      } else updateNavTabs('fight');
      return;
    }
    // roster / lobby both live on the select screen; leaving a live online
    // fight must take BOTH players out, exactly like the CHANGE button
    if (!menuOpen) {
      if (net && netConnected()) net.send({ t: 'menu' });
      $('#banner').classList.add('hidden');
      $('#confetti').innerHTML = '';
      openMenu();
    }
    updateNavTabs(nav);
    if (nav === 'lobby') {
      const bar = $('#netBar');
      bar.classList.remove('flash');
      void bar.offsetWidth;
      bar.classList.add('flash');
    }
  }),
);

// ---------- Async load ----------
const loadFill = $('#loadFill');
const loadText = $('#loadText');

loadAssets(FIGHTERS, (loaded, total) => {
  loadFill.style.width = `${Math.round((loaded / total) * 100)}%`;
  loadText.textContent = `Loading arena… ${loaded}/${total}  ·  build ${BUILD}`;
}).then(({ models, clipSets, overlayDeltas, octagon }) => {
  // kept for the autochess mode: it clones these models per board unit and
  // hides the octagon while its own cage is on screen
  loadedAssets = { models, clipSets, overlayDeltas };
  octagonRoot = octagon;
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
      clips: clipSets[cfg.visual.rig],
      bindDelta: overlayDeltas[cfg.visual.rig],
      pos: new THREE.Vector3(i === 0 ? -1.1 : 1.1, 0, 0),
      corner: '#fff',
    });
    f.root.visible = false;
    fighters[cfg.id] = f;
  });
  fx.loadVoices(FIGHTERS);
  portraits = makeThumbs();
  buildMenu(portraits);
  $('#loading').classList.add('hidden');
  // permanent, subtle build marker — "am I on the new version?" must be
  // answerable without catching the loading screen
  $('#menuHint').insertAdjacentHTML('afterend',
    `<div style="font-size:9px;opacity:.35;letter-spacing:1px;margin-top:4px">build ${BUILD}</div>`);
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

// ---------- user camera orbit (drag to rotate, works in solo and online —
// the camera is presentation-only, so it never touches the seeded sim) ----------
let userYaw = 0; // horizontal drag, radians added to the cinematic sway
let userY = 0; // vertical drag, metres added to the eye height
let camDragging = false;
let dragPX = 0;
let dragPY = 0;
canvas.style.touchAction = 'none'; // one-finger drags must reach us, not the browser
canvas.addEventListener('pointerdown', e => {
  camDragging = true;
  dragPX = e.clientX;
  dragPY = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
});
canvas.addEventListener('pointermove', e => {
  if (!camDragging) return;
  userYaw += (e.clientX - dragPX) * 0.005;
  userY = Math.max(-1.0, Math.min(2.4, userY - (e.clientY - dragPY) * 0.004));
  dragPX = e.clientX;
  dragPY = e.clientY;
});
for (const ev of ['pointerup', 'pointercancel']) {
  canvas.addEventListener(ev, () => { camDragging = false; });
}
canvas.addEventListener('dblclick', () => { userYaw = 0; userY = 0; }); // double-tap resets the shot

// ---------- autochess board interaction ----------
// Click a hex to place the selected fighter, click an occupied hex to pick that
// fighter up. Distinguished from a camera drag by movement threshold, so
// orbiting the board never fires a placement.
const _ndc = new THREE.Vector2();
let autochessDownX = 0, autochessDownY = 0, autochessDragged = false;

function autochessCellFromEvent(e) {
  if (!autochessActive || !autochessMode?.board?.loaded) return null;
  // Normalise against the CANVAS RECT, not window.innerWidth/innerHeight.
  // Those only agree when the canvas exactly fills the viewport at (0,0), which
  // is false on iOS Safari: the collapsing URL bar leaves innerHeight
  // disagreeing with the visible area, so clientY/innerHeight came out short and
  // every tap resolved a few rows too far "up" — usually landing on the enemy
  // half, where place() rejects it and nothing appears to happen.
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  _ndc.set(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
  return autochessMode.board.cellAtPointer(_ndc, camera);
}

canvas.addEventListener('pointerdown', e => {
  if (!autochessActive) return;
  autochessDownX = e.clientX;
  autochessDownY = e.clientY;
  autochessDragged = false;
});

// A finger never lands as cleanly as a mouse, so a 6px threshold read almost
// every tap as a camera drag and swallowed the placement.
const AUTOCHESS_TAP_SLOP = matchMedia('(pointer: coarse)').matches ? 16 : 6;

canvas.addEventListener('pointermove', e => {
  if (!autochessActive) return;
  if (Math.abs(e.clientX - autochessDownX) + Math.abs(e.clientY - autochessDownY) > AUTOCHESS_TAP_SLOP) autochessDragged = true;
  if (camDragging) return;
  const cell = autochessCellFromEvent(e);
  autochessMode.setHover(cell ? autochessCellId(cell.col, cell.row) : null);
});

canvas.addEventListener('pointerup', e => {
  if (!autochessActive || autochessDragged) return;
  if (autochessMode.phase !== AUTOCHESS_PHASE.PLANNING) return;
  const cell = autochessCellFromEvent(e);
  if (!cell) { autochessMode.select(null); return; }
  const id = autochessCellId(cell.col, cell.row);
  const occupant = autochessMode.roster.at(id);
  if (autochessMode.selected) autochessMode.place(autochessMode.selected, id);
  else if (occupant) autochessMode.select(occupant);
});

renderer.setAnimationLoop(() => {
  // Cheap guard against a canvas that never got sized. ResizeObserver does not
  // reliably fire for a 0 -> N viewport transition (a tab that starts hidden,
  // a restored session), and a NaN aspect silently breaks hex picking.
  if (window.innerWidth !== lastViewW || window.innerHeight !== lastViewH) applyViewportSize();

  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  const t = clock.elapsedTime;
  autoQuality(rawDt * 1000, t);

  // Fixed-step sim: seeded multiplayer fights must consume the rng stream at
  // identical sim times on both clients, so the engine and fighters advance
  // in 1/60s quanta regardless of the device's frame rate. Pause/speed only
  // change how many quanta this client consumes per frame — never their size,
  // so a 4× viewer and a paused viewer still replay the identical fight.
  simAcc = Math.min(simAcc + (simPaused && engine ? 0 : dt * (engine ? simSpeed : 1)), 0.25);
  while (simAcc >= SIM_STEP) {
    simAcc -= SIM_STEP;
    engine?.update(SIM_STEP);
    for (const f of Object.values(fighters)) {
      if (f.root.visible) f.update(SIM_STEP);
    }
    // autochess runs on the same fixed quantum, so its battles resolve
    // identically regardless of frame rate
    if (autochessActive) autochessMode.update(SIM_STEP);
  }

  if (autochessActive) {
    autochessUi?.onTick?.(autochessMode.phase, autochessMode.timer);
    autochessUi?.updateFloaters(dt, camera, autochessMode.board.unitRoot);
  }

  if (ctlActive()) {
    ctlStam = Math.min(100, ctlStam + dt * (engine.ctlGuard ? 4 : 10));
    ctlDodgeCd = Math.max(0, ctlDodgeCd - dt);
    updateCtlPad();
  }

  if (autochessActive) {
    // Autochess uses a fixed high-angle shot framing the whole board, like
    // TFT — no cinematic sway, because the player is reading hexes and needs
    // a stable frame. Drag still orbits/tilts; double-click recentres.
    // 46 degrees of elevation is the shallowest angle that clears the cage's
    // near fence (2 units tall) while keeping the far row on screen.
    // On a phone the binding constraint is WIDTH, not height: the 7-column grid
    // is wider than a 375px viewport long before it is taller. Portrait pulls
    // back until the outer columns fit, steepens toward top-down (which is more
    // compact vertically), and aims below the floor so the board sits in the
    // clear band between the status strip and the shop rather than under it.
    const aspect = camera.aspect;
    const portrait = aspect < 0.8;
    const dist = portrait ? 21 : aspect < 1.0 ? 19.5 : aspect < 1.5 ? 16.0 : 14.6;
    const basePitch = portrait ? 1.0 : 0.80;
    const lookY = portrait ? -1.2 : 0.35;
    const pitch = Math.max(0.55, Math.min(1.3, basePitch - userY * 0.12));
    const yaw = userYaw * 0.6;
    camera.position.set(
      Math.sin(yaw) * Math.cos(pitch) * dist,
      autochessMode.board.floorY + Math.sin(pitch) * dist,
      Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    if (shake > 0.002) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake * 0.7;
      shake *= Math.exp(-5 * dt);
    }
    camera.lookAt(0, autochessMode.board.floorY + lookY, 0);
    faceFill.position.set(camera.position.x, camera.position.y + 1.2, camera.position.z);
    faceFill.target.position.set(0, autochessMode.board.floorY + 1.0, 0);
    renderer.render(scene, camera);
    return;
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

  const ang = Math.sin(t * 0.1) * 0.4 + userYaw; // cinematic sway + the user's drag
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
    Math.max(1.15, camY + userY + Math.sin(t * 0.23) * 0.07),
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

let lastViewW = -1, lastViewH = -1;

function applyViewportSize() {
  // Guard against a zero-sized viewport. A canvas that initialises at 0x0 gives
  // camera.aspect = NaN, which poisons the projection matrix — and because hex
  // picking raycasts through that camera, every tap resolves to nothing. The
  // board renders fine once a frame lands, so the failure looks like "taps do
  // nothing" rather than anything visibly broken.
  const w = window.innerWidth || document.documentElement.clientWidth || 1;
  const h = window.innerHeight || document.documentElement.clientHeight || 1;
  if (w === lastViewW && h === lastViewH) return;
  lastViewW = w;
  lastViewH = h;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

window.addEventListener('resize', () => {
  applyViewportSize();
  if (menuOpen) updateMenuPreview(); // re-space the two-shot for the new aspect
});

// A resize event never fires for a tab that simply started at zero size (a
// background tab, a restored session, some mobile browsers mid-load), so watch
// the element itself as well.
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => applyViewportSize()).observe(document.documentElement);
}
window.addEventListener('orientationchange', () => setTimeout(applyViewportSize, 50));
// iOS changes the visible area when its URL bar collapses without always firing
// a window resize, which leaves the canvas taller than what you can see.
window.visualViewport?.addEventListener('resize', applyViewportSize);
applyViewportSize();
