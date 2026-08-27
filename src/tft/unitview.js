// Visual representation of one board unit.
//
// Wraps the existing Fighter3D so the autochess mode inherits the whole
// animation pipeline — per-rig clip retargeting, the additive guard/flinch
// overlays, bind-delta correction — instead of re-implementing it. The model
// is deep-cloned per unit because a champion can legitimately be fielded more
// than once, and Object3D.clone() alone would leave every copy sharing one
// skeleton.

import * as THREE from 'three';
import { clone as cloneSkinned } from '../../vendor/utils/SkeletonUtils.js?v=202608271934';
import { Fighter3D } from '../fighter3d.js?v=202608271934';


// Fighters are authored 1.8m tall against a 1.0-unit hex width. That ratio is
// already close to TFT's champion-to-hex proportion, so they only need a nudge
// down to stop shoulders overlapping on adjacent hexes.
const UNIT_SCALE = 0.82;

const BAR_W = 0.78;
const BAR_H = 0.075;
const BAR_Y = 1.72;

const HP_GREEN = 0x4ed04a;  // ally fill
const HP_RED = 0xc0301f;    // enemy fill
const MANA_BLUE = 0x127ebd;
const MANA_TRACK = 0x000617; // very dark navy, not neutral black

// star pips: bronze / silver / gold by star level
const STAR_COLOR = { 1: 0xa2703a, 2: 0xc3cdd2, 3: 0xffd24a };

// Left-anchored unit quad: translating the geometry so x=0 is its left edge
// makes `scale.x = fraction` fill the bar from the left, with no per-frame
// geometry work.
function barGeometry(w, h) {
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(w / 2, 0, 0);
  return g;
}

let sharedGeo = null;
function geos() {
  if (!sharedGeo) {
    sharedGeo = {
      bg: new THREE.PlaneGeometry(BAR_W + 0.04, BAR_H * 2 + 0.05),
      hp: barGeometry(BAR_W, BAR_H),
      // mana row is exactly half the health row's height, as in TFT
      mana: barGeometry(BAR_W, BAR_H * 0.5),
      pip: new THREE.PlaneGeometry(0.1, 0.1),
    };
  }
  return sharedGeo;
}

function flatMat(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false,
  });
}

export class UnitView {
  // `assets` is { model, clips, bindDelta } for this fighter's rig.
  constructor(entry, unit, star, team, assets, parent, scene) {
    this.entry = entry;
    this.unit = unit;
    this.star = star;
    this.team = team;
    this.dead = false;
    this._lastClip = null;

    const model = {
      scene: cloneSkinned(assets.model.scene),
      materials: [],
      bones: {},
    };
    // The clone carries its own materials only if we ask for them; Meshy models
    // share one material per mesh, and the hit-flash writes emissiveIntensity,
    // so each unit needs its own copies or every clone flashes together.
    model.scene.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
        for (const m of [].concat(o.material)) {
          if (m.emissive) {
            m.emissive.set(0xff3030);
            m.emissiveIntensity = 0;
            // remembered so revive() can undo the death fade without assuming
            // every material started opaque
            m.userData.__origTransparent = m.transparent;
            m.userData.__origOpacity = m.opacity;
            model.materials.push(m);
          }
        }
      }
      if (o.isBone) model.bones[o.name] = o;
    });

    this.fighter = new Fighter3D(unit.cfg, scene, {
      model,
      clips: assets.clips,
      bindDelta: assets.bindDelta,
      pos: new THREE.Vector3(0, 0, 0),
      corner: team === 'player' ? '#2f7fd4' : '#c0392b',
      parent,
      arenaRadius: Infinity, // the hex grid is the containment here
    });
    this.fighter.root.scale.setScalar(UNIT_SCALE);

    this._buildBars(parent);
  }

  _buildBars() {
    const g = geos();
    this.bars = new THREE.Group();
    this.bars.position.y = BAR_Y;

    const bg = new THREE.Mesh(g.bg, flatMat(MANA_TRACK, 0.8));
    bg.renderOrder = 10;

    this.hpFill = new THREE.Mesh(g.hp, flatMat(this.team === 'player' ? HP_GREEN : HP_RED));
    this.hpFill.position.set(-BAR_W / 2, BAR_H * 0.62, 0.001);
    this.hpFill.renderOrder = 11;

    this.manaFill = new THREE.Mesh(g.mana, flatMat(MANA_BLUE));
    this.manaFill.position.set(-BAR_W / 2, -BAR_H * 0.5, 0.001);
    this.manaFill.renderOrder = 11;
    this.manaFill.scale.x = 0;

    this.bars.add(bg, this.hpFill, this.manaFill);

    // Star pips sit above the bar: a COUNT of pips (one per star), tinted by
    // STAR level bronze/silver/gold — not by cost tier, and not a single
    // recoloured marker. Cost tier is communicated by the shop card border.
    this.pips = [];
    const color = STAR_COLOR[this.star] || STAR_COLOR[1];
    for (let i = 0; i < this.star; i++) {
      const p = new THREE.Mesh(g.pip, flatMat(color));
      p.position.set((i - (this.star - 1) / 2) * 0.13, BAR_H * 2.1, 0.001);
      p.rotation.z = Math.PI / 4; // diamond, reads as a pip at this size
      p.renderOrder = 12;
      this.bars.add(p);
      this.pips.push(p);
    }

    this.fighter.root.parent.add(this.bars);
  }

  get root() { return this.fighter.root; }

  setPosition(x, z) {
    this.fighter.pos.x = x;
    this.fighter.pos.z = z;
  }

  faceToward(x, z, dt, instant = false) {
    this._face = this._face || new THREE.Vector3();
    this._face.set(x, 0, z);
    this.fighter.faceToward(this._face, dt, instant);
  }

  // ---- animation, retimed for autochess cadence ----
  // Attack clips were authored for the MMA sim, where one strike owns a whole
  // exchange. Here a unit attacks roughly once a second, so each clip is
  // time-scaled to exactly fill its attack interval — otherwise a 2-second
  // combo would still be winding up when the next attack is due.
  playAttack(clipKey, duration) {
    const raw = this.fighter.clipDuration(clipKey);
    if (!raw) return;
    this.fighter.play(clipKey, {
      once: true,
      fade: 0.08,
      timeScale: raw / Math.max(0.2, duration),
      onDone: () => { if (!this.dead) this.playIdle(); },
    });
    this._lastClip = clipKey;
  }

  playCast(clipKey, duration) {
    const raw = this.fighter.clipDuration(clipKey);
    if (!raw) return;
    this.fighter.play(clipKey, {
      once: true,
      fade: 0.1,
      timeScale: raw / Math.max(0.3, duration),
      onDone: () => { if (!this.dead) this.playIdle(); },
    });
    this._lastClip = clipKey;
  }

  // Duration the combat sim should budget for this unit's ability, derived
  // from the real clip so the impact frame and the damage tick agree.
  castDuration() {
    const raw = this.fighter.clipDuration(this.unit.ability.clip);
    return Math.min(1.9, Math.max(0.85, raw));
  }

  playWalk() {
    if (this.fighter.currentKey === 'walk') return;
    this.fighter.play('walk', { fade: 0.16 });
    this._lastClip = 'walk';
  }

  playIdle() {
    if (this.fighter.currentKey === 'idle') return;
    this.fighter.play('idle', { fade: 0.2 });
    this._lastClip = 'idle';
  }

  // Planning phase: units loop their signature clip, which is what makes the
  // board feel alive between rounds.
  playSignature() {
    const key = this.unit.idleClip;
    if (this.fighter.actions[key]) this.fighter.play(key, { fade: 0.3 });
    else this.playIdle();
  }

  flash() { this.fighter.flash(); }

  hit(fromX, fromZ, strength) {
    this._kb = this._kb || new THREE.Vector3();
    this._kb.set(fromX, 0, fromZ);
    this.fighter.knockback(this._kb, strength);
  }

  die() {
    this.dead = true;
    this.deathT = 0;
    this.fighter.ko(); // plays the real knock_down fall and holds the pose
    for (const p of this.pips) p.visible = false;
  }

  // Undo die(). A roster entry outlives the round it was killed in, so the same
  // UnitView is reused next planning phase — without this it stays sunk below
  // the floor at zero opacity, still holding the knock_down pose, and the
  // player's board simply goes invisible from round 2 onward.
  revive() {
    if (!this.dead) return;
    this.dead = false;
    this.deathT = 0;
    for (const m of this.fighter.materials) {
      m.transparent = m.userData.__origTransparent ?? false;
      m.opacity = m.userData.__origOpacity ?? 1;
    }
    for (const p of this.pips) p.visible = true;
    // reset() clears the KO state and pitch and restarts the idle clip; it also
    // snaps to startPos, so callers must position afterwards
    this.fighter.reset();
    this.fighter.root.position.y = 0;
    this.fighter.root.visible = true;
    this.bars.visible = true;
  }

  setBars(hpFrac, manaFrac) {
    this.hpFill.scale.x = Math.max(0, Math.min(1, hpFrac));
    this.manaFill.scale.x = Math.max(0, Math.min(1, manaFrac));
  }

  setBarsVisible(on) { this.bars.visible = on; }

  // Planning phase shows the SAME plate as combat — full health, starting mana
  // — rather than a stripped-down variant. It is the only way to read a unit's
  // star level on the board without clicking it.
  showPlanningPlate() {
    this.setBars(1, 0);
    this.bars.visible = true;
    for (const p of this.pips) p.visible = true;
  }

  update(dt, camera) {
    this.fighter.update(dt);
    this.bars.position.x = this.fighter.pos.x;
    this.bars.position.z = this.fighter.pos.z;
    this.bars.position.y = BAR_Y * UNIT_SCALE;
    // billboard the bars so they stay readable as the camera orbits
    if (camera) this.bars.quaternion.copy(camera.quaternion);

    if (this.dead) {
      // let the fall finish, then sink and fade the corpse away so the board
      // clears for the next round
      this.deathT += dt;
      this.bars.visible = false;
      if (this.deathT > 1.6) {
        const k = Math.min(1, (this.deathT - 1.6) / 0.9);
        this.fighter.root.position.y = -k * 0.9;
        for (const m of this.fighter.materials) { m.transparent = true; m.opacity = 1 - k; }
        this.fighter.root.visible = k < 1;
      }
    }
  }

  setVisible(on) {
    this.fighter.root.visible = on;
    this.bars.visible = on;
  }

  dispose() {
    this.fighter.root.parent?.remove(this.fighter.root);
    this.bars.parent?.remove(this.bars);

    // Dispose ONLY what this instance owns.
    //
    // SkeletonUtils.clone() copies the mesh but SHARES its geometry with the
    // source model — and that source is also used by every other board unit of
    // this fighter AND by the octagon-mode roster in main.js. Calling
    // geometry.dispose() here therefore destroyed the GPU buffers for all of
    // them: enemy views are disposed every round transition, so from round 2
    // on those fighters rendered as nothing while their combat logic kept
    // running. An invisible unit that still fights back reads as "undead".
    //
    // The materials ARE per-instance (cloned in the constructor, because the
    // hit-flash writes emissiveIntensity), so those are safe to release.
    this.fighter.root.traverse(o => {
      if (o.isMesh) {
        for (const m of [].concat(o.material)) m.dispose?.();
      }
    });
    // bar geometry is shared via geos() and must outlive this view; only the
    // per-instance materials made by flatMat() are ours to dispose
    for (const c of this.bars.children) {
      for (const m of [].concat(c.material)) m.dispose?.();
    }
  }
}
