import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

// Animation-only GLBs (mesh/textures stripped offline). All rigs share the
// same 24-bone skeleton NAMES, but bind-pose orientations differ between the
// athletic rigs (merab/ilia, near-identical) and the portrait rig (davit,
// up to 137° on hips/spine/thighs) — so clips are retargeted per rig family
// with bind-delta correction, not just copied.
const ANIM_FILES = {
  punch_combo: 'assets/anim_punch_combo.glb',
  roundhouse: 'assets/anim_roundhouse.glb',
  run: 'assets/anim_running.glb',
  victory_cheer: 'assets/anim_victory_cheer.glb',
  dodge_counter: 'assets/anim_dodge_counter.glb',
  flying_kick: 'assets/anim_flying_kick.glb',
  chest_pound: 'assets/anim_chest_pound.glb',
  flex: 'assets/anim_flex.glb',
  hook: 'assets/anim_hook.glb',
  knock_down: 'assets/anim_knock_down.glb',
  punch_combo_2: 'assets/anim_punch_combo_2.glb',
  punch_combo_4: 'assets/anim_punch_combo_4.glb',
  backflip_kick: 'assets/anim_backflip_kick.glb',
  counterstrike: 'assets/anim_counterstrike.glb',
  double_kick: 'assets/anim_double_kick.glb',
  jumping_punch: 'assets/anim_jumping_punch.glb',
  lunge_spin_kick: 'assets/anim_lunge_spin_kick.glb',
  knee_strike: 'assets/anim_knee_strike.glb',
  elbow_strike: 'assets/anim_elbow_strike.glb',
  lunge_roundhouse: 'assets/anim_lunge_roundhouse.glb',
  spartan_kick: 'assets/anim_spartan_kick.glb',
  sweeping_kick: 'assets/anim_sweeping_kick.glb',
  kung_fu_punch: 'assets/anim_kung_fu_punch.glb',
  high_kick: 'assets/anim_high_kick.glb',
};

// which rig family each clip was authored on (default: athletic)
const PORTRAIT_SOURCED = new Set(['uppercut', 'hook', 'punch_combo_2', 'punch_combo_4',
  'kung_fu_punch', 'high_kick']);

// Native per-family exports of the same library clip — preferred over
// retargeting where they exist: the KO fall is on screen for 3 full seconds,
// too visible to tolerate bind-delta error.
const FAMILY_NATIVE = {
  portrait: {
    knock_down: 'assets/anim_knock_down_portrait.glb',
    spartan_kick: 'assets/anim_spartan_kick_portrait.glb',
    sweeping_kick: 'assets/anim_sweeping_kick_portrait.glb',
  },
};

// The KO fall's baked hip travel must survive processing — it carries the
// body backwards onto the canvas. Everything else stays pinned in place.
const KEEP_HIPS_TRAVEL = new Set(['knock_down']);

// Some Meshy clips ship with dead spans (motionless lead-in/tail) or bundle
// two actions — trim to the active window found by per-bin rotational-energy
// analysis. counterstrike keeps only its first burst (the actual counter).
// knock_down drops its 1.1s pre-fall stagger so a KO reads as a direct fall.
const TRIM_WINDOWS = {
  punch_combo_4: [1.85, 4.75],
  kung_fu_punch: [0.5, 4.8],
  counterstrike: [1.3, 3.1],
  knock_down: [1.05, 3.3],
};

// Dodge_and_Counter windows from per-bone angular-velocity analysis:
// slip at 0.6–2.0s, right-hand counter flurry at 2.0–3.45s (contiguous).
const DODGE_WINDOW = [0.6, 2.0];
const COUNTER_WINDOW = [2.0, 3.45];

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();

// Rotation-only retarget prep: drop translation tracks except hips (X/Z
// pinned so clips stay in place — the engine drives root motion — unless the
// clip's hip travel is part of the action, like the KO fall).
function processClip(clip, name) {
  const tracks = [];
  for (const t of clip.tracks) {
    if (t.name.endsWith('.quaternion')) {
      tracks.push(t);
    } else if (t.name === 'Hips.position') {
      if (!KEEP_HIPS_TRAVEL.has(name)) {
        const v = t.values;
        const x0 = v[0], z0 = v[2];
        for (let i = 0; i < v.length; i += 3) {
          v[i] = x0;
          v[i + 2] = z0;
        }
      }
      tracks.push(t);
    }
  }
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

// World-frame static-parent retarget. The rigs share bone names but distribute
// orientation differently down the chain (merab's Hips bind is rolled ~127°,
// davit's is nearly straight), so per-keyframe:
//   q' = pre * q * post
//   pre  = Wp_t⁻¹ · Wp_s
//   post = qBind_s⁻¹ · Wp_s⁻¹ · Wp_t · qBind_t
// where Wp = parent's world bind rotation. This maps the bone's world-space
// deviation from bind onto the target rig exactly (rest pose → rest pose).
function retargetClip(clip, fromBind, toBind) {
  const tracks = [];
  for (const t of clip.tracks) {
    const nt = t.clone();
    if (t.name.endsWith('.quaternion')) {
      const bone = t.name.slice(0, -11);
      const from = fromBind[bone], to = toBind[bone];
      if (from && to) {
        const pre = to.parentWorldQ.clone().invert().multiply(from.parentWorldQ);
        const post = from.q.clone().invert()
          .multiply(from.parentWorldQ.clone().invert())
          .multiply(to.parentWorldQ)
          .multiply(to.q);
        const v = nt.values;
        for (let i = 0; i < v.length; i += 4) {
          _qc.set(v[i], v[i + 1], v[i + 2], v[i + 3]).premultiply(pre).multiply(post);
          v[i] = _qc.x;
          v[i + 1] = _qc.y;
          v[i + 2] = _qc.z;
          v[i + 3] = _qc.w;
        }
      }
    } else if (t.name === 'Hips.position') {
      // both Armatures are identical, so only the hip-height ratio matters
      const s = (toBind.Hips?.y || 1) / (fromBind.Hips?.y || 1);
      const v = nt.values;
      for (let i = 0; i < v.length; i++) v[i] *= s;
    }
    tracks.push(nt);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

// Shift a clip's Hips.position X/Z so its first frame sits at the reference
// offset (the untrimmed clip's frame 0), preserving all travel after it.
function rebaseHipTravel(clip, refX, refZ) {
  for (const t of clip.tracks) {
    if (t.name === 'Hips.position') {
      const v = t.values;
      const dx = v[0] - refX;
      const dz = v[2] - refZ;
      for (let i = 0; i < v.length; i += 3) {
        v[i] -= dx;
        v[i + 2] -= dz;
      }
    }
  }
}

function captureBind(scene) {
  scene.updateMatrixWorld(true);
  const bind = {};
  scene.traverse(o => {
    if (o.isBone) {
      bind[o.name] = {
        q: o.quaternion.clone(),
        worldQ: o.getWorldQuaternion(new THREE.Quaternion()),
        parentWorldQ: o.parent.getWorldQuaternion(new THREE.Quaternion()),
        y: o.position.y,
      };
    }
  });
  return bind;
}

export async function loadAssets(cfgs, onProgress) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (url, loaded, total) => onProgress?.(loaded, total);
  const loader = new GLTFLoader(manager);

  const bodyPromises = cfgs.map(c => loader.loadAsync(c.body));
  const animKeys = Object.keys(ANIM_FILES);
  const animPromises = animKeys.map(k => loader.loadAsync(ANIM_FILES[k]));
  const nativeSpecs = Object.entries(FAMILY_NATIVE).flatMap(([family, files]) =>
    Object.entries(files).map(([key, url]) => ({ family, key, url })));
  const nativePromises = nativeSpecs.map(s => loader.loadAsync(s.url));
  const octagonPromise = loader.loadAsync('assets/octagon.glb');
  // await together so the first rejection surfaces immediately
  const [bodies, anims, natives, octagonGltf] = await Promise.all([
    Promise.all(bodyPromises),
    Promise.all(animPromises),
    Promise.all(nativePromises),
    octagonPromise,
  ]);

  const models = bodies.map((gltf, i) => prepareModel(gltf.scene, cfgs[i].height));

  // bind poses per rig family (merab = athletic reference, davit = portrait)
  const bindByFamily = {};
  cfgs.forEach((cfg, i) => {
    if (!bindByFamily[cfg.rig]) bindByFamily[cfg.rig] = captureBind(models[i].scene);
  });
  const athleticBind = bindByFamily.athletic;
  const portraitBind = bindByFamily.portrait;

  // raw clips, tagged by source family
  const raw = {};
  bodies.forEach((gltf, i) => {
    raw[cfgs[i].builtin] = {
      clip: processClip(gltf.animations[0], cfgs[i].builtin),
      family: cfgs[i].rig,
    };
  });
  animKeys.forEach((k, i) => {
    raw[k] = {
      clip: processClip(anims[i].animations[0], k),
      family: PORTRAIT_SOURCED.has(k) ? 'portrait' : 'athletic',
    };
  });

  // native per-family clips (no retarget needed)
  const nativeClips = {};
  nativeSpecs.forEach((s, i) => {
    (nativeClips[s.family] ||= {})[s.key] = processClip(natives[i].animations[0], s.key);
  });

  const bindFor = { athletic: athleticBind, portrait: portraitBind };
  const clipSets = {};
  for (const family of Object.keys(bindByFamily)) {
    const set = {};
    for (const [k, { clip, family: src }] of Object.entries(raw)) {
      set[k] = nativeClips[family]?.[k]
        || (src === family ? clip : retargetClip(clip, bindFor[src], bindFor[family]));
    }
    set.dodge = THREE.AnimationUtils.subclip(set.dodge_counter, 'dodge', DODGE_WINDOW[0] * 30, DODGE_WINDOW[1] * 30, 30);
    set.counter = THREE.AnimationUtils.subclip(set.dodge_counter, 'counter', COUNTER_WINDOW[0] * 30, COUNTER_WINDOW[1] * 30, 30);
    for (const [k, [t0, t1]] of Object.entries(TRIM_WINDOWS)) {
      const pre = set[k].tracks.find(t => t.name === 'Hips.position');
      const refX = pre ? pre.values[0] : 0;
      const refZ = pre ? pre.values[2] : 0;
      set[k] = THREE.AnimationUtils.subclip(set[k], k, t0 * 30, t1 * 30, 30);
      // clips with live hip travel get re-anchored to the rig's rest offset,
      // otherwise the cut would start mid-stagger with the body displaced
      if (KEEP_HIPS_TRAVEL.has(k)) rebaseHipTravel(set[k], refX, refZ);
    }
    clipSets[family] = set;
  }

  // per-family bone-frame deltas for procedural overlays (guard/flinch),
  // C = Ws_target⁻¹ · Ws_source so overlay rotations conjugate into the
  // target rig's bone frame
  const overlayDeltas = {};
  for (const family of Object.keys(bindByFamily)) {
    if (family === 'athletic') {
      overlayDeltas[family] = null;
    } else {
      const d = {};
      for (const bone of Object.keys(athleticBind)) {
        if (bindFor[family][bone]) {
          d[bone] = bindFor[family][bone].worldQ.clone().invert().multiply(athleticBind[bone].worldQ);
        }
      }
      overlayDeltas[family] = d;
    }
  }

  const octagon = prepareOctagon(octagonGltf.scene);
  return { models, clipSets, overlayDeltas, octagon };
}

function prepareModel(scene, targetHeight) {
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const s = targetHeight / size.y;
  scene.scale.setScalar(s);
  const box2 = new THREE.Box3().setFromObject(scene);
  scene.position.y -= box2.min.y;

  const materials = [];
  const bones = {};
  scene.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        // Meshy's KHR_specular values read as chrome under our lighting — clamp to skin-like
        if ('metalness' in m) m.metalness = Math.min(m.metalness, 0.1);
        if ('specularIntensity' in m) m.specularIntensity = Math.min(m.specularIntensity, 0.3);
        if ('roughness' in m) m.roughness = Math.max(m.roughness, 0.55);
        if (m.emissive) {
          m.emissive.set(0xff3030);
          m.emissiveIntensity = 0;
          materials.push(m);
        }
      }
    }
    if (o.isBone) bones[o.name] = o;
  });
  return { scene, materials, bones };
}

function prepareOctagon(scene) {
  scene.traverse(o => {
    if (o.isMesh) {
      o.receiveShadow = true;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.side = THREE.DoubleSide;
        // Meshy exports metalness=1 with no env map → renders black; force dielectric
        if ('metalness' in m) m.metalness = 0;
        if ('roughness' in m) m.roughness = 0.85;
      }
    }
  });
  return scene;
}
