# tools

Node scripts for the autochess mode. Everything except `decimate.mjs` is
dependency-free — run them straight with `node`.

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

`serve.py` is a no-store static server. Plain `python3 -m http.server` sends
`Last-Modified` with no `Cache-Control`, so browsers apply heuristic freshness
and keep running **stale ES modules** after you edit them — you reload and the
old code still runs, with no error.

```
python3 tools/serve.py 8124 .
```

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

Run the stamper before every push:

```
node tools/stamp.mjs .
```

GitHub Pages caches each file independently for 10 minutes, so without this a
returning browser can mix modules from two different builds — new code calling
into a stale module throws mid-click, which reads as "buttons randomly stopped
working". Stamping puts the same `?v=<timestamp>` on every internal import, so
a client loads either the whole old build or the whole new one, never a mix.
The loading screen shows the stamp so you can tell which one you're on.
