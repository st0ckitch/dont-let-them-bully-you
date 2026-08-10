import * as THREE from 'three';
import { FIGHTERS } from './config.js';
import { loadAssets } from './anim.js';
import { Fighter3D } from './fighter3d.js';
import { Engine, simFight } from './fight.js';

const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
key.shadow.mapSize.set(2048, 2048);
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
  onCrit: atk => fx.critVoice(atk.cfg),
  onDamage: (def, dmg, crit) => {
    const card = def === fighterA ? $('#card-a') : $('#card-b');
    popDamage(card, dmg, crit);
    card.classList.remove('hurt');
    void card.offsetWidth;
    card.classList.add('hurt');
  },
  onKO: (winner, loser, info) => {
    showBanner(winner, loser, info.method === 'flash'
      ? `KNOCKS OUT ${loser.cfg.name.toUpperCase()} COLD in round ${info.round}!`
      : `${winner.cfg.name} defeats ${loser.cfg.name} by KO in round ${info.round}`);
    confetti();
    fx.victory(winner.cfg);
  },
  onDecision: (winner, loser, cards) => {
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

function startMatch(idA, idB) {
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
  $('#menu').classList.add('hidden');
  fx.bell();
  engine.start();
  updateHP();
  window.__fight = { engine, fighters, fighterA, fighterB, simFight };
}

// ---------- Fighter select menu ----------
function buildMenu() {
  for (const side of ['A', 'B']) {
    $(side === 'A' ? '#pickA' : '#pickB').innerHTML = FIGHTERS.map(c => `
      <button class="fcard" data-id="${c.id}" data-side="${side}">
        <span class="fcflag">${c.flag}</span>
        <span class="fcname">${c.short}</span>
        <span class="fcnick">${c.nick.toUpperCase()}</span>
        <span class="fcstat">STR ${c.stats.striking} · SPD ${c.stats.speed} · CAR ${c.stats.cardio}</span>
      </button>`).join('');
  }
  document.querySelectorAll('.fcard').forEach(el =>
    el.addEventListener('click', () => {
      const { id, side } = el.dataset;
      if (side === 'A') {
        selA = id;
        if (selB === id) selB = FIGHTERS.find(c => c.id !== id).id;
      } else {
        selB = id;
        if (selA === id) selA = FIGHTERS.find(c => c.id !== id).id;
      }
      refreshMenu();
    }),
  );
  refreshMenu();
}

function refreshMenu() {
  document.querySelectorAll('.fcard').forEach(el => {
    const sel = el.dataset.side === 'A' ? selA : selB;
    const other = el.dataset.side === 'A' ? selB : selA;
    el.classList.toggle('sel', el.dataset.id === sel);
    el.disabled = el.dataset.id === other;
  });
}

$('#menuFightBtn').addEventListener('click', () => {
  fx.init();
  startMatch(selA, selB);
});

$('#rematchBtn').addEventListener('click', () => {
  $('#banner').classList.add('hidden');
  $('#confetti').innerHTML = '';
  fx.bell();
  engine.start();
});

$('#changeBtn').addEventListener('click', () => {
  $('#banner').classList.add('hidden');
  $('#confetti').innerHTML = '';
  $('#menu').classList.remove('hidden');
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
  buildMenu();
  $('#loading').classList.add('hidden');
  $('#menu').classList.remove('hidden');
  window.__fight = { fighters, simFight };
}).catch(err => {
  console.error(err);
  loadText.textContent = `Failed to load — ${err?.message || err}`;
  loadFill.style.background = '#ff3b4d';
});

// ---------- Loop ----------
const clock = new THREE.Clock();
let radius = 4.6;
let camY = 2.45;
const camTarget = new THREE.Vector3(0, 1.0, 0);

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  engine?.update(dt);
  for (const f of Object.values(fighters)) {
    if (f.root.visible) f.update(dt);
  }

  if (fighterA && fighterB) {
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
});
