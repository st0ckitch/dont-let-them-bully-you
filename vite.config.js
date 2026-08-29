import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// GitHub Pages serves this at /dont-let-them-bully-you/, not at a domain root.
// Without `base` every emitted asset URL resolves one level too high and 404s,
// which looks like a completely broken deploy rather than a config mistake.
const BASE = '/dont-let-them-bully-you/';

const STAMP = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  base: BASE,
  // replaces tools/stamp.mjs: the loading screen shows which build is running.
  // Cache-busting itself is now the bundler's content hashes, not a query string.
  define: { __BUILD__: JSON.stringify(STAMP) },
  resolve: {
    alias: {
      // three stays vendored at r170 rather than coming from npm: the fight
      // balance and the animation retargeting were tuned against this exact
      // build, and a minor bump could move both without any error.
      three: fileURLToPath(new URL('./vendor/three.module.js', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',   // no downleveling: combat.js is bit-deterministic and
                        // online play replays a shared seed on both peers
    outDir: 'dist',
    // bundles go to dist/build, not dist/assets: public/assets is copied
    // verbatim into dist/assets, and one folder holding both invites a
    // filename collision that would only surface at deploy time
    assetsDir: 'build',
    emptyOutDir: true,
  },
});
