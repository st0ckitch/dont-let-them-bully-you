# tools

Headless harnesses and asset scripts. They import `src/**/*.ts` directly — Node
strips types natively, so no build or runner is needed. `featurecheck.mjs` needs
Playwright and `decimate.mjs` needs meshoptimizer; the rest are dependency-free.

`npm test` runs the eight that return an exit code:

```
node hextest.mjs      # hex math, picking stability under float noise, path symmetry
node shoptest.mjs     # merges, pool accounting, shop odds, economy
node combattest.mjs   # structure: mirror symmetry, termination, star/cost effect
node balance.mjs      # roster balance across random boards
node regress.mjs      # the MMA sim's win matrix, as a guard on config.js/fight.js
```

`balance.mjs` is the one to trust for tuning the roster. A 1v1 between two
same-cost units is a near-deterministic damage race that flips 0%↔100% on a few
stat points, so it reports healthy rosters as broken. TFT balances board
contribution, and so does this.

`serve.py` predates Vite and is kept only for serving a plain directory without
node. `npm run dev` is the normal way in.

## Asset pipeline

`decimate.mjs` is how `assets/tft_board.glb` was produced from a raw Meshy
export: 107 MB / 2M triangles down to ~5 MB / 73k. It reads and rewrites the GLB
by hand so the only dependency is meshoptimizer (no gltf-transform, no sharp).

```
npm install meshoptimizer
node extract-tex.mjs <meshy.glb> ./tex
sips -Z 2048 -s format jpeg -s formatOptions 78 ./tex/0_base_color.jpg --out ./tex/bc.jpg
sips -Z 1024 -s format jpeg -s formatOptions 70 ./tex/2_normal.jpg    --out ./tex/nrm.jpg
BIGERR=0.02 node decimate.mjs <meshy.glb> ../assets/tft_board.glb 60000 ./tex/bc.jpg ./tex/nrm.jpg
```

Note: `meshoptimizer`'s `compactMesh()` rewrites the index array **in place**
*and* returns the remap. Applying that remap afterwards double-maps it and
collapses the mesh to a single shard.

## Deploying

`main` builds and deploys itself via `.github/workflows/deploy.yml`. Vite
content-hashes every bundle, so the mixed-build problem `stamp.mjs` used to
solve is gone: a changed file gets a new filename, and `index.html` is served
no-store.

Locally: `npm run dev` for the Vite dev server, `npm run build && npm run preview`
to check the real production output (including the `/dont-let-them-bully-you/`
base path, which only appears in a build).
