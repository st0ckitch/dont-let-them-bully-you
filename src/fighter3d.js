import * as THREE from 'three';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const _e = new THREE.Euler();
const _axisX = new THREE.Vector3(1, 0, 0);

const easeIn = u => u * u * u;

function shortestAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// Additive guard overlay: forearms up, chin tucked. Applied on top of
// whatever clip is playing, scaled by a smoothed 0..1 weight.
const GUARD_DELTAS = [
  ['LeftArm', [-0.12, 0, 0.15]],
  ['RightArm', [-0.12, 0, -0.15]],
  ['LeftForeArm', [-0.35, 0.08, 0]],
  ['RightForeArm', [-0.35, -0.08, 0]],
  ['Spine02', [0.07, 0, 0]],
  ['Head', [0.09, 0, 0]],
];

// clips that already animate the whole body — never stack the guard on these
const GUARD_SAFE = new Set(['idle', 'walk', 'run']);

export class Fighter3D {
  constructor(cfg, scene, { model, clips, pos, corner, bindDelta = null }) {
    this.cfg = cfg;
    this.stats = cfg.stats;
    this.hp = 100;
    this.corner = corner;
    this.startPos = pos.clone();
    this.state = 'idle';

    this.root = new THREE.Group();
    // YXZ so the KO pitch (rotation.x) happens about the yawed local axis —
    // the fighter falls backwards relative to facing, not world -Z
    this.root.rotation.order = 'YXZ';
    this.root.position.copy(pos);
    this.root.add(model.scene);
    this.materials = model.materials;
    this.bones = model.bones;
    scene.add(this.root);

    this.mixer = new THREE.AnimationMixer(model.scene);
    this.actions = {};
    for (const [key, clip] of Object.entries(clips)) {
      this.actions[key] = this.mixer.clipAction(clip);
    }
    this.current = null;
    this.currentKey = null;
    this._onDone = null;
    this.mixer.addEventListener('finished', e => {
      if (e.action === this.current && this._onDone) {
        const f = this._onDone;
        this._onDone = null;
        f();
      }
    });

    // bone-frame correction for procedural overlays on non-athletic rigs
    this.bindDelta = bindDelta;
    const deltaAxis = name => {
      const v = new THREE.Vector3(1, 0, 0);
      const d = bindDelta?.[name];
      if (d) v.applyQuaternion(d);
      return v;
    };
    this.flinchAxes = { spine: deltaAxis('Spine02'), spine01: deltaAxis('Spine01'), neck: deltaAxis('neck') };

    this.vel = new THREE.Vector3();
    this.flinchI = 0;
    this.flashI = 0;
    this.guardW = 0;
    this.guardTarget = 0;
    this.pulseT = -1;
    this.evadeT = -1;
    this.evadeDur = 0.7;
    this.yaw = 0;
    this.yawTarget = 0;
    this.koT = -1;

    this.play('idle');
  }

  // ---- animation ----
  play(key, { once = false, fade = 0.22, timeScale = 1, onDone = null } = {}) {
    const next = this.actions[key];
    if (!next) return;
    if (this.current === next && !once) return;
    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(timeScale);
    next.setEffectiveWeight(1);
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    if (this.current && this.current !== next) {
      this.current.crossFadeTo(next, fade, false);
    } else {
      next.fadeIn(fade);
    }
    next.play();
    this.current = next;
    this.currentKey = key;
    this._onDone = once ? onDone : null;
  }

  clipDuration(key) {
    return this.actions[key] ? this.actions[key].getClip().duration : 0;
  }

  // debug helper: freeze a clip at a normalized time (pre-fight use only)
  scrub(key, frac) {
    this.play(key, { fade: 0 });
    this.current.paused = true;
    this.current.time = frac * this.current.getClip().duration;
    this.mixer.update(0);
  }

  // ---- movement ----
  get pos() {
    return this.root.position;
  }

  distanceTo(other) {
    return this.pos.distanceTo(other.pos);
  }

  faceToward(point, dt, instant = false) {
    this.yawTarget = Math.atan2(point.x - this.pos.x, point.z - this.pos.z);
    if (instant) {
      this.yaw = this.yawTarget;
    } else {
      const d = shortestAngle(this.yawTarget - this.yaw);
      this.yaw += d * Math.min(1, dt * 8);
    }
    this.root.rotation.y = this.yaw;
  }

  moveToward(point, speed, dt) {
    _v.copy(point).sub(this.pos);
    _v.y = 0;
    const d = _v.length();
    if (d > 1e-4) {
      _v.normalize();
      this.pos.addScaledVector(_v, Math.min(speed * dt, d));
    }
    return d;
  }

  // soft impulse — eased by velocity decay so it reads as a rock, not a teleport
  knockback(fromPos, strength) {
    _v.copy(this.pos).sub(fromPos);
    _v.y = 0;
    _v.normalize();
    this.vel.addScaledVector(_v, strength);
    if (this.vel.length() > 1.4) this.vel.setLength(1.4);
    this.flinchI = Math.max(this.flinchI, Math.min(1, strength * 1.1));
  }

  defend(on) {
    this.guardTarget = on ? 1 : 0;
  }

  // sharp guard tighten timed to an incoming blocked strike
  guardPulse() {
    this.pulseT = 0;
  }

  // whole-body lean-back evade (procedural, works over any base clip)
  evade(dur = 0.7) {
    this.evadeT = 0;
    this.evadeDur = dur;
  }

  flash() {
    this.flashI = 1;
  }

  // ---- fight states ----
  ko() {
    this.state = 'ko';
    this.guardTarget = 0;
    if (this.current) this.current.paused = true;
    this.koT = 0;
  }

  victory() {
    this.state = 'victory';
    this.guardTarget = 0;
    // turn to the crowd/camera side — consumed by the victory branch in update()
    this.yawTarget = Math.atan2(0 - this.pos.x, 6 - this.pos.z);
    this.play(this.cfg.victoryClip, { fade: 0.3 });
  }

  reset() {
    this.state = 'idle';
    this.hp = 100;
    this.koT = -1;
    this.vel.set(0, 0, 0);
    this.flinchI = 0;
    this.flashI = 0;
    this.guardW = 0;
    this.guardTarget = 0;
    this.pulseT = -1;
    this.evadeT = -1;
    this.pos.copy(this.startPos);
    this.root.rotation.x = 0;
    if (this.current) {
      this.current.stop();
      this.current = null;
      this.currentKey = null;
    }
    this._onDone = null;
    this.play('idle', { fade: 0 });
  }

  update(dt) {
    this.mixer.update(dt);

    // victory: turn toward the crowd (yawTarget set by victory())
    if (this.state === 'victory') {
      const d = shortestAngle(this.yawTarget - this.yaw);
      this.yaw += d * Math.min(1, dt * 6);
      this.root.rotation.y = this.yaw;
    }

    // guard overlay blends in/out smoothly on top of the playing clip;
    // guardPulse() briefly overdrives it so blocks visibly "catch" the shot
    const gRate = this.guardTarget > this.guardW ? 7 : 4;
    this.guardW += (this.guardTarget - this.guardW) * Math.min(1, dt * gRate);
    let gw = this.guardW;
    if (this.pulseT >= 0) {
      if (this.pulseT < 0.4) {
        gw = Math.min(1.6, gw + Math.sin((Math.PI * this.pulseT) / 0.4) * 0.9);
        this.pulseT += dt;
      } else {
        this.pulseT = -1;
      }
    }
    if (gw > 0.01 && this.state !== 'ko' && GUARD_SAFE.has(this.currentKey)) {
      for (const [name, e] of GUARD_DELTAS) {
        const bone = this.bones[name];
        if (!bone) continue;
        _e.set(e[0] * gw, e[1] * gw, e[2] * gw);
        _q.setFromEuler(_e);
        const d = this.bindDelta?.[name];
        if (d) _q.premultiply(d).multiply(_qd.copy(d).invert()); // conjugate into this rig's bone frame
        bone.quaternion.multiply(_q);
      }
    }

    // lean-back evade: sine envelope peaks right when the strike whiffs
    if (this.evadeT >= 0 && this.state !== 'ko') {
      const u = this.evadeT / this.evadeDur;
      if (u >= 1) {
        this.evadeT = -1;
      } else {
        const w = Math.sin(Math.PI * u);
        _q.setFromAxisAngle(this.flinchAxes.spine, -0.42 * w);
        this.bones.Spine02?.quaternion.multiply(_q);
        _q.setFromAxisAngle(this.flinchAxes.spine01, -0.22 * w);
        this.bones.Spine01?.quaternion.multiply(_q);
        _q.setFromAxisAngle(this.flinchAxes.neck, 0.16 * w); // chin stays tucked
        this.bones.neck?.quaternion.multiply(_q);
        this.evadeT += dt;
      }
    }

    // impact flinch: bend spine/neck back on top of whatever is playing
    if (this.flinchI > 0.01 && this.state !== 'ko') {
      const a = this.flinchI * 0.3;
      _q.setFromAxisAngle(this.flinchAxes.spine, -a);
      this.bones.Spine02?.quaternion.multiply(_q);
      _q.setFromAxisAngle(this.flinchAxes.neck, -a * 0.75);
      this.bones.neck?.quaternion.multiply(_q);
    }
    this.flinchI *= Math.exp(-5 * dt);

    // knockback velocity — softer decay so the shove eases out
    if (this.vel.lengthSq() > 1e-6) {
      this.pos.addScaledVector(this.vel, dt);
      this.vel.multiplyScalar(Math.exp(-4.5 * dt));
    }

    // keep inside the octagon canvas
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 2.6) {
      this.pos.x *= 2.6 / r;
      this.pos.z *= 2.6 / r;
    }
    this.pos.y = 0;

    // KO fall: rigid backwards fall pivoting at the feet, slight bounce
    if (this.koT >= 0 && this.koT < 1.4) {
      this.koT += dt;
      const t = Math.min(this.koT / 0.75, 1);
      let ang = -1.55 * easeIn(t);
      if (this.koT > 0.75) {
        const b = Math.min((this.koT - 0.75) / 0.35, 1);
        ang = -1.55 - 0.1 * Math.sin(b * Math.PI);
      }
      this.root.rotation.x = ang;
    }

    // hit flash on the model's materials
    this.flashI *= Math.exp(-7 * dt);
    for (const m of this.materials) m.emissiveIntensity = this.flashI * 0.5;
  }
}
