// Pull the embedded JPEG textures out of a Meshy GLB so `sips` can resize them
// (macOS ships sips, so this avoids depending on sharp/libvips).
import fs from 'node:fs';

const SRC = process.argv[2], OUTDIR = process.argv[3];
const buf = fs.readFileSync(SRC);
let off = 12, json = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
  else if (type === 0x004e4942) bin = data;
  off += 8 + len + ((4 - (len % 4)) % 4);
}
fs.mkdirSync(OUTDIR, { recursive: true });
(json.images || []).forEach((im, i) => {
  const bv = json.bufferViews[im.bufferView];
  const start = bv.byteOffset || 0;
  const out = `${OUTDIR}/${i}_${im.name}.jpg`;
  fs.writeFileSync(out, bin.subarray(start, start + bv.byteLength));
  console.log(out, (bv.byteLength / 1048576).toFixed(2), 'MB');
});
