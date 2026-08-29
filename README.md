# DON'T LET THEM BULLY YOU 🥊

A 3D MMA fight simulator that runs entirely in the browser — no backend.

**Play it live:** https://st0ckitch.github.io/dont-let-them-bully-you/

## Fighters

| | Nickname | Style |
|---|---|---|
| 🇬🇪 **Merab Dvalishvili** | The Machine | Relentless pace, granite chin |
| 🇬🇪🇪🇸 **Ilia Topuria** | El Matador | Elite striking, dodge-and-counter specialist |
| 🇬🇪 **Davit Panjakidze** | The Hoking | Fast hands, uppercuts and hooks |

Pick two fighters, press FIGHT, and watch. Every fight is decided by stat-driven dice — striking, grappling, cardio, chin, speed — so any fighter can win any night. KO ends it: fall animation, victory celebration, and the winner's own voice line.

## Modes

- **Auto-sim** — pick two fighters and watch the sim call the fight.
- **Take control** — fight out of the red corner yourself: punch, kick, special, hold block, time your dodges.
- **Autochess** — a TFT-style autobattler on a hex board in a cage. Buy fighters from a 5-card shop, place them on your half, and they fight for themselves. Three of a kind upgrades to the next star. See [AUTOCHESS.md](AUTOCHESS.md).

## How it works

- TypeScript throughout, bundled by Vite. [three.js](https://github.com/mrdoob/three.js) stays vendored at r170 — the fight balance and the animation retargeting were tuned against that exact build.
- three.js renders the scene; models and the octagon were generated with [Meshy AI](https://www.meshy.ai/) and rigged on Meshy biped skeletons.
- All animation clips are shared across fighters via world-frame bind-pose retargeting (the rigs share bone names but not bind orientations — up to 137° apart).
- Strike impacts fire at calibrated moments of each animation clip, gated by real reach distance; defense is a blend of an additive guard overlay, a head-slip subclip, and reactive counters.
- Impact sounds are synthesized live with WebAudio (layered sub-thump + knock + slap through a compressor).
- Fight balance was tuned with in-engine Monte Carlo simulation (~50/50 for every matchup).

## Run locally

```bash
npm install
npm run dev          # Vite dev server
```

Before pushing, check the real production output — the
`/dont-let-them-bully-you/` base path only exists in a build, so a base-path
mistake is invisible in dev:

```bash
npm run build && npm run preview
```

## Checking your work

```bash
npm run check        # typecheck + no-any + the headless test suite
```

That is what CI runs. The three parts individually:

| Command | What it proves |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` under `strict`. No emit — Vite compiles. |
| `npm run no-any` | no explicit `any` type anywhere in `src/`. `strict` forbids the *implicit* kind; tsconfig has no switch for the explicit kind, so this is a script. |
| `npm test` | the eight headless harnesses in `tools/` |

**Run `npm test` before anything touching the sim.** `modes/autochess/combat.ts`
is bit-deterministic and online play works by both peers replaying one seed
locally — a desync produces two different winners and no error at all.

## Layout

```
src/
  main.ts        bootstrap, scene, HUD wiring, multiplayer lobby
  anim.ts        GLB loading + per-rig clip retargeting
  fighter3d.ts   one rendered fighter
  net.ts         PeerJS transport
  types.ts       Stats, Stance — shared by moves and fighters
  fighters/      one file per fighter + barrel   (see its README)
  moves/         one file per move + barrel      (see its README)
  modes/
    octagon/     fight.ts — the MMA sim, pure and headless-runnable
    autochess/   the TFT-style autobattler
  styles/        one sheet per region, linked in cascade order
public/
  assets/        models, animations, audio, fonts — copied verbatim
vendor/          three.js r170 and its example loaders, bundled by Vite
```

`main` deploys itself to GitHub Pages via `.github/workflows/deploy.yml`, which
runs `npm run check` first.

## Credits & disclaimer

Fan-made demo for fun — not affiliated with, endorsed by, or connected to the UFC, ESPN, or any fighter or brand depicted. Fighter likenesses are AI-generated 3D models. Fonts: [Anton](https://fonts.google.com/specimen/Anton) and [Barlow Condensed](https://fonts.google.com/specimen/Barlow+Condensed) (SIL Open Font License). three.js is MIT-licensed.
