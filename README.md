# DON'T LET THEM BULLY YOU 🥊

A 3D MMA fight simulator that runs entirely in the browser — no build step, no backend.

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

- [three.js](https://github.com/mrdoob/three.js) (vendored, r170) renders the scene; models and the octagon were generated with [Meshy AI](https://www.meshy.ai/) and rigged on Meshy biped skeletons.
- All animation clips are shared across fighters via world-frame bind-pose retargeting (the rigs share bone names but not bind orientations — up to 137° apart).
- Strike impacts fire at calibrated moments of each animation clip, gated by real reach distance; defense is a blend of an additive guard overlay, a head-slip subclip, and reactive counters.
- Impact sounds are synthesized live with WebAudio (layered sub-thump + knock + slap through a compressor).
- Fight balance was tuned with in-engine Monte Carlo simulation (~50/50 for every matchup).

## Run locally

```bash
python3 tools/serve.py 8000 .
```

then open http://localhost:8000

(`python3 -m http.server` works too, but it lets the browser cache ES modules
heuristically — you edit a file, reload, and the old code still runs. The
server in `tools/` sends `no-store` to avoid that. See [tools/README.md](tools/README.md).)

## Credits & disclaimer

Fan-made demo for fun — not affiliated with, endorsed by, or connected to the UFC, ESPN, or any fighter or brand depicted. Fighter likenesses are AI-generated 3D models. Fonts: [Anton](https://fonts.google.com/specimen/Anton) and [Barlow Condensed](https://fonts.google.com/specimen/Barlow+Condensed) (SIL Open Font License). three.js is MIT-licensed.
