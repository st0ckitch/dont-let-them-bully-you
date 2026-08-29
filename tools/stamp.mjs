// Version-stamp every internal module reference so a deploy is ATOMIC.
//
// GitHub Pages serves each file with max-age=600 and no build step means no
// hashed filenames — so for up to ten minutes after a push, a returning browser
// can mix modules from two different builds. A mix where new code calls a
// function the stale module does not export yet throws mid-interaction, which
// users experience as "buttons randomly stopped working" (it has now happened
// three times). Appending the same ?v=<stamp> to every relative import makes
// the URL the cache key: a stale index.html loads a fully OLD-but-consistent
// set, a fresh one loads a fully NEW set, and no Frankenstein build can exist.
//
// Usage: node tools/stamp.mjs [rootDir]   (default ../live)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || new URL('../live', import.meta.url).pathname);
const now = new Date();
const pad = n => String(n).padStart(2, '0');
const STAMP = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
const HUMAN = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

const jsFiles = [];
for (const dir of ['src', 'src/moves', 'src/fighters', 'src/modes/octagon', 'src/modes/autochess', 'vendor', 'vendor/utils']) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) if (f.endsWith('.js')) jsFiles.push(path.join(abs, f));
}

let touched = 0;
// relative imports only — never absolute URLs (fonts, CDNs)
const IMPORT_RE = /(from\s+['"])(\.{1,2}\/[^'"]+?\.js)(\?v=\d+)?(['"])/g;
for (const f of jsFiles) {
  let s = fs.readFileSync(f, 'utf8');
  const out = s.replace(IMPORT_RE, `$1$2?v=${STAMP}$4`);
  if (out !== s) { fs.writeFileSync(f, out); touched++; }
}

// the entry points in index.html, including the importmap target for 'three'
const idx = path.join(ROOT, 'index.html');
let h = fs.readFileSync(idx, 'utf8');
h = h.replace(/((?:src|href)=["'])(\.\/(?:src|vendor)\/[^"']+?\.(?:js|css))(\?v=\d+)?(["'])/g, `$1$2?v=${STAMP}$4`);
h = h.replace(/("three":\s*["'])(\.\/vendor\/three\.module\.js)(\?v=\d+)?(["'])/, `$1$2?v=${STAMP}$4`);
fs.writeFileSync(idx, h);

// keep the human-readable loading-screen stamp in step
const mainP = path.join(ROOT, 'src/main.js');
let m = fs.readFileSync(mainP, 'utf8');
m = m.replace(/const BUILD = '[^']*';/, `const BUILD = '${HUMAN}';`);
fs.writeFileSync(mainP, m);

console.log(`stamped v=${STAMP} (${HUMAN}) across ${touched} js files + index.html`);
