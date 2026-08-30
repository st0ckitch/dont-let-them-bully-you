// Fails if `any` is used as a TYPE anywhere in src/. tsconfig can forbid
// *implicit* any (noImplicitAny, via strict) but has no switch for the explicit
// kind, so this is the gate. Comments and strings are stripped first — the
// English word "any" appears in plenty of them.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts')) files.push(p);
  }
})('src');

// `: any`, `<any>`, `as any`, `any[]`, `Array<any>` — the ways it shows up
const AS_TYPE = /(?::\s*any\b)|(?:<\s*any\s*[,>])|(?:\bas\s+any\b)|(?:\bany\s*\[\])/;
const hits = [];
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').replace(/(['"`]).*?\1/g, '');
    if (AS_TYPE.test(code)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
  });
}

if (hits.length) {
  console.error(`explicit \`any\` in ${hits.length} place(s):`);
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}
console.log(`no explicit \`any\` across ${files.length} TypeScript files`);
