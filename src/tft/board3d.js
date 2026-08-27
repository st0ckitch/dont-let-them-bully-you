// The autochess arena: cage model, hex overlay, and pointer picking.
//
// The cage GLB is decimated from a 107 MB Meshy export (see tools/decimate.mjs)
// and already carries a hex-tiled floor in its texture. That baked pattern is
// scenery — the playable grid is drawn on top so it lines up with the actual
// cell coordinates, exactly like TFT paints its hexes over the arena terrain.

import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/GLTFLoader.js?v=202608271934';
import { MeshoptDecoder } from '../../vendor/meshopt_decoder.module.js?v=202608271934';
import * as Hex from './hex.js?v=202608271934';

// Board footprint in world units. The grid is ~7.5 x 7.3, so 10 leaves a
// comfortable margin between the outer columns and the cage fence.
const BOARD_SPAN = 10;

const HEX_COLORS = {
  player: 0x2f7fd4,
  enemy: 0xc0392b,
  neutral: 0x39506b,
  hover: 0xffd90f,
  valid: 0x39d98a,
  occupied: 0x6d7f95,
};

function hexShape(radius) {
  const s = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30); // pointy-top
    const x = radius * Math.cos(a);
    const y = radius * Math.sin(a);
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  s.closePath();
  return s;
}

// A hex ring: outer hex with an inner hex punched out, so the cell reads as an
// outline rather than a solid tile.
function hexRingGeometry(radius, thickness) {
  const outer = hexShape(radius);
  const inner = hexShape(radius - thickness);
  // Shape holes wind opposite to the outline; reversing keeps the punch valid.
  outer.holes.push(new THREE.Path(inner.getPoints().reverse()));
  const g = new THREE.ShapeGeometry(outer);
  g.rotateX(-Math.PI / 2);
  return g;
}

export class Board3D {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);

    // Units are parented here so their local y=0 sits on the cage floor and
    // Fighter3D's `this.pos.y = 0` stays correct without touching that class.
    this.unitRoot = new THREE.Group();
    this.root.add(this.unitRoot);

    this.gridRoot = new THREE.Group();
    this.root.add(this.gridRoot);

    this.cells = new Map(); // cellId -> { ring, fill, col, row }
    this.dim = 1;           // global grid opacity multiplier (1 planning, low in combat)
    this._state = null;
    this.floorY = 0;
    this.loaded = false;
    this._raycaster = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._hit = new THREE.Vector3();
  }

  async load(onProgress) {
    if (this.loaded) return;
    const manager = new THREE.LoadingManager();
    manager.onProgress = (url, loaded, total) => onProgress?.(loaded, total);
    const loader = new GLTFLoader(manager);
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync('assets/tft_board.glb');
    const cage = gltf.scene;

    const box = new THREE.Box3().setFromObject(cage);
    const size = new THREE.Vector3();
    box.getSize(size);
    cage.scale.setScalar(BOARD_SPAN / Math.max(size.x, size.z));
    cage.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(cage);
    cage.position.y -= box2.min.y; // sit the cage base on y=0

    cage.traverse(o => {
      if (!o.isMesh) return;
      o.receiveShadow = true;
      o.frustumCulled = false;
      for (const m of [].concat(o.material)) {
        // Meshy exports metalness=1 with no env map, which renders black
        if ('metalness' in m) m.metalness = 0;
        if ('roughness' in m) m.roughness = 0.92;
        // The scanned floor is near-white; damping it hard lets the hex overlay
        // and the fighters read as the brightest things on screen, like TFT.
        if (m.color) m.color.multiplyScalar(0.42);
        m.side = THREE.DoubleSide;
      }
    });
    this.root.add(cage);
    this.cage = cage;

    // Find the playing surface by dropping a ray onto the middle of the cage.
    cage.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 20, 0), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(cage, true);
    this.floorY = hits.length ? hits[0].point.y : 0.53;
    this.unitRoot.position.y = this.floorY;
    this.gridRoot.position.y = this.floorY + 0.012; // just clear of z-fighting
    this._plane.constant = -this.floorY;

    this._buildGrid();
    this.loaded = true;
  }

  _buildGrid() {
    const ringGeo = hexRingGeometry(Hex.SIZE * 0.93, Hex.SIZE * 0.10);
    const fillGeo = new THREE.ShapeGeometry(hexShape(Hex.SIZE * 0.86));
    fillGeo.rotateX(-Math.PI / 2);

    for (const { col, row } of Hex.allCells()) {
      const w = Hex.cellToWorld(col, row);
      const side = Hex.isPlayerHalf(row) ? 'player' : 'enemy';

      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: HEX_COLORS[side], transparent: true, opacity: 0.34, depthWrite: false,
      }));
      ring.position.set(w.x, 0, w.z);
      ring.renderOrder = 2;

      const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({
        color: HEX_COLORS[side], transparent: true, opacity: 0, depthWrite: false,
      }));
      fill.position.set(w.x, 0.001, w.z);
      fill.renderOrder = 1;

      this.gridRoot.add(ring, fill);
      this.cells.set(Hex.cellId(col, row), { ring, fill, col, row, side });
    }
  }

  // ---- highlight state ----
  // `state` maps cellId -> 'hover' | 'valid' | 'occupied' | null
  setHighlights(state) {
    this._state = state;
    const d = this.dim;
    for (const [id, cell] of this.cells) {
      const s = state?.get(id) || null;
      const base = HEX_COLORS[cell.side];
      if (s === 'hover') {
        cell.ring.material.color.setHex(HEX_COLORS.hover);
        cell.ring.material.opacity = 0.95 * d;
        cell.fill.material.color.setHex(HEX_COLORS.hover);
        cell.fill.material.opacity = 0.3 * d;
      } else if (s === 'valid') {
        cell.ring.material.color.setHex(HEX_COLORS.valid);
        cell.ring.material.opacity = 0.7 * d;
        cell.fill.material.color.setHex(HEX_COLORS.valid);
        cell.fill.material.opacity = 0.13 * d;
      } else if (s === 'occupied') {
        cell.ring.material.color.setHex(HEX_COLORS.occupied);
        cell.ring.material.opacity = 0.55 * d;
        cell.fill.material.opacity = 0;
      } else {
        cell.ring.material.color.setHex(base);
        cell.ring.material.opacity = 0.34 * d;
        cell.fill.material.opacity = 0;
      }
    }
  }

  // Fade the grid down for combat rather than switching it off. TFT keeps the
  // hexes faintly readable while units fight — you need to see who is standing
  // where to understand why a fight went the way it did.
  setGridMode(planning) {
    this.dim = planning ? 1 : 0.22;
    this.gridRoot.visible = true;
    this.setHighlights(planning ? this._state : null);
  }

  setVisible(on) { this.root.visible = on; }

  // The online guest owns rows 0-3 in canonical coordinates but still wants to
  // look at its own half from the near side. Rotating the whole board is safer
  // than mirroring the data: cellAtPointer() goes through root.worldToLocal(),
  // so picking inverts the rotation for free and no coordinate ever has to be
  // flipped by hand — which is exactly where a desync would hide.
  setFlipped(on) {
    this.flipped = !!on;
    this.root.rotation.y = on ? Math.PI : 0;
    this.root.updateMatrixWorld(true);
    // Recolour from the LOCAL player's point of view. The cell's canonical half
    // never changes, but "mine" is rows 0-3 for the flipped side, and a player
    // whose own half glows enemy-red is reading the board backwards.
    for (const cell of this.cells.values()) {
      const mine = Hex.isPlayerHalf(cell.row) !== this.flipped;
      cell.side = mine ? 'player' : 'enemy';
    }
    this.setHighlights(this._state);
  }

  // ---- picking ----
  // Raycast against the floor plane rather than the cage mesh: the plane is
  // exact, costs nothing, and still resolves a cell when the pointer is over a
  // fighter standing on the hex.
  cellAtPointer(ndc, camera) {
    this._raycaster.setFromCamera(ndc, camera);
    const hit = this._raycaster.ray.intersectPlane(this._plane, this._hit);
    if (!hit) return null;
    const local = this.root.worldToLocal(hit.clone());
    return Hex.worldToCell(local.x, local.z);
  }

  worldOf(col, row, out = new THREE.Vector3()) {
    const w = Hex.cellToWorld(col, row);
    return out.set(w.x, 0, w.z);
  }

  dispose() {
    this.cells.clear();
    this.root.clear();
  }
}
