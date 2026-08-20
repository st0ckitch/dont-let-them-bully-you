// Meshy GLB -> game-ready GLB, with no gltf-transform dependency.
//
// The board export is 1.19M verts / 2M tris / 107 MB with 4096^2 textures —
// unusable in a browser. This reads the GLB by hand, runs meshoptimizer's
// attribute-aware simplifier, drops the metallic-roughness map (the material
// is forced dielectric at load anyway) and rewrites a minimal GLB.
//
// Usage: node decimate.mjs <src.glb> <out.glb> <targetTris> <baseColor.jpg> [normal.jpg]
//        BIGERR=0.02 controls the simplifier's relative error budget.
import fs from 'node:fs';
import { MeshoptSimplifier } from 'meshoptimizer';

const SRC = process.argv[2];
const OUT = process.argv[3];
const TARGET_TRIS = +(process.argv[4] || 45000);
const BIGERR = +(process.env.BIGERR || 0.05);

export function readGlb(path) {
  const buf = fs.readFileSync(path);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  return { json, bin };
}

const { json, bin } = readGlb(SRC);

const acc = i => {
  const a = json.accessors[i];
  const bv = json.bufferViews[a.bufferView];
  const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const Ctor = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
  const bytes = a.count * comps * Ctor.BYTES_PER_ELEMENT;
  // copy out: the source offset is not guaranteed to satisfy the view's alignment
  const slice = Buffer.from(bin.subarray(start, start + bytes));
  return new Ctor(slice.buffer, slice.byteOffset, a.count * comps);
};

const prim = json.meshes[0].primitives[0];
const pos = acc(prim.attributes.POSITION);
const nor = acc(prim.attributes.NORMAL);
const uv = acc(prim.attributes.TEXCOORD_0);
let idx = acc(prim.indices);
if (!(idx instanceof Uint32Array)) idx = Uint32Array.from(idx);
const vcount = pos.length / 3;
console.log(`in: ${vcount} verts, ${idx.length / 3} tris`);

await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true;

// Attribute-aware: the board's detail lives in a fragmented UV atlas, so
// collapsing on position alone smears the hex inlay across texture islands.
// 'Prune' drops the small disconnected floaters the photogrammetry left behind.
const attrs = new Float32Array(vcount * 2);
attrs.set(uv);
const [simplified, error] = MeshoptSimplifier.simplifyWithAttributes(
  idx, pos, 3, attrs, 2, [1.0, 1.0], null, TARGET_TRIS * 3, BIGERR, ['Prune'],
);
console.log(`simplified: ${simplified.length / 3} tris, error=${error.toFixed(5)}`);

// compactMesh REWRITES `simplified` in place with the compacted indices and
// ALSO returns the old->new remap. Re-applying that remap double-maps and
// collapses the mesh to a shard — the indices are already done.
const [remap, uniqueCount] = MeshoptSimplifier.compactMesh(simplified);
console.log(`compact: ${uniqueCount} verts`);
const nPos = new Float32Array(uniqueCount * 3);
const nNor = new Float32Array(uniqueCount * 3);
const nUv = new Float32Array(uniqueCount * 2);
const lim = Math.min(vcount, remap.length); // remap spans maxindex+1, not vcount
for (let i = 0; i < lim; i++) {
  const d = remap[i];
  if (d === 0xffffffff || d >= uniqueCount) continue;
  nPos[d * 3] = pos[i * 3]; nPos[d * 3 + 1] = pos[i * 3 + 1]; nPos[d * 3 + 2] = pos[i * 3 + 2];
  nNor[d * 3] = nor[i * 3]; nNor[d * 3 + 1] = nor[i * 3 + 1]; nNor[d * 3 + 2] = nor[i * 3 + 2];
  nUv[d * 2] = uv[i * 2]; nUv[d * 2 + 1] = uv[i * 2 + 1];
}
const nIdx = simplified;

const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < uniqueCount; i++) {
  for (let k = 0; k < 3; k++) {
    const v = nPos[i * 3 + k];
    if (v < min[k]) min[k] = v;
    if (v > max[k]) max[k] = v;
  }
}
console.log('bounds min', min.map(x => +x.toFixed(4)), 'max', max.map(x => +x.toFixed(4)));

const use16 = uniqueCount <= 65535;
const outIdx = use16 ? Uint16Array.from(nIdx) : nIdx;

// ---- write GLB ----
const parts = [];
let byteOffset = 0;
const bvs = [];
const push = (ta, target) => {
  const b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength);
  const pad = (4 - (b.length % 4)) % 4;
  bvs.push({ buffer: 0, byteOffset, byteLength: b.length, ...(target ? { target } : {}) });
  parts.push(b);
  if (pad) parts.push(Buffer.alloc(pad));
  byteOffset += b.length + pad;
  return bvs.length - 1;
};
const bvPos = push(nPos, 34962);
const bvNor = push(nNor, 34962);
const bvUv = push(nUv, 34962);
const bvIdx = push(outIdx, 34963);

const texFiles = process.argv.slice(5); // baseColor.jpg [normal.jpg]
const imgViews = texFiles.map(f => push(new Uint8Array(fs.readFileSync(f))));

const out = {
  asset: { version: '2.0', generator: 'dltby-decimate' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'tft_board' }],
  meshes: [{ name: 'board', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
  accessors: [
    { bufferView: bvPos, componentType: 5126, count: uniqueCount, type: 'VEC3', min, max },
    { bufferView: bvNor, componentType: 5126, count: uniqueCount, type: 'VEC3' },
    { bufferView: bvUv, componentType: 5126, count: uniqueCount, type: 'VEC2' },
    { bufferView: bvIdx, componentType: use16 ? 5123 : 5125, count: outIdx.length, type: 'SCALAR' },
  ],
  bufferViews: bvs,
  buffers: [{ byteLength: byteOffset }],
  materials: [{
    name: 'board',
    pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.9 },
    ...(texFiles.length > 1 ? { normalTexture: { index: 1 } } : {}),
  }],
  textures: texFiles.map((_, i) => ({ source: i, sampler: 0 })),
  images: imgViews.map((v, i) => ({ bufferView: v, mimeType: 'image/jpeg', name: i === 0 ? 'base_color' : 'normal' })),
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
};

const jsonBuf = Buffer.from(JSON.stringify(out), 'utf8');
const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
const binChunk = Buffer.concat(parts);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
const j0 = Buffer.alloc(8); j0.writeUInt32LE(jsonChunk.length, 0); j0.writeUInt32LE(0x4e4f534a, 4);
const b0 = Buffer.alloc(8); b0.writeUInt32LE(binChunk.length, 0); b0.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(OUT, Buffer.concat([header, j0, jsonChunk, b0, binChunk]));
console.log(`wrote ${OUT}: ${(fs.statSync(OUT).size / 1048576).toFixed(2)} MB`);
