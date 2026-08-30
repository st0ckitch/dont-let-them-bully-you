# fighters

The roster, one file per fighter, re-exported through `index.ts`. A fighter is
plain data — nine numbers, a set of asset paths, and a kit of move references.
Both game modes derive everything they show from this file and nothing else.

```
fighters/
  index.ts     barrel — FIGHTERS (ordered) + FIGHTER_BY_ID
  types.ts     Fighter, Kit, Visual, Voice
  gigi.ts      one file per fighter, named after its id
  merab.ts
  ...
```

Imports carry an explicit `.ts` extension, so `node tools/*.mjs` can import
these modules directly (Node strips types natively) and Vite resolves them the
same way.

## The model

```js
import { UPPERCUT, ELBOW_STRIKE, LEG_SWEEP } from '../moves/index.ts';

export const GIGI = {
  id: 'gigi', short: 'GIGI', name: 'Gigi Gvaramia', nick: 'The Deputy CTO', flag: '🇬🇪',
  record: '14–6–1', stance: 'southpaw',
  visual: {
    body: 'assets/fighters/gigi/body.glb', rig: 'gigi', height: 1.82,
    idle: 'pod_groove', victory: 'pod_groove',
  },
  voice: { win: 'assets/fighters/gigi/win.m4a', announce: null },
  stats: { striking: 94, grappling: 89, cardio: 91, chin: 94, speed: 88 },
  counterSkill: 0.42,
  powerKO: 1,
  kit: { light: UPPERCUT, heavy: ELBOW_STRIKE, special: LEG_SWEEP },
};
```

### Identity

| Field | Meaning |
| --- | --- |
| `id` | Unique, lowercase. Also the filename and the asset folder name. |
| `short` | All-caps tag for tiles, corner cards and the shop. Keep it short. |
| `name` / `nick` / `flag` | Display only. |
| `record` | Display only — decorative, not simulated. |
| `stance` | `'orthodox'` or `'southpaw'`. **Data, not a label** — `STANCE_LABEL` in `main.ts` is its only display form. No mechanical effect yet. |

### Visual — read by `anim.ts`, `fighter3d.ts`, `unitview.ts`

| Field | Meaning |
| --- | --- |
| `body` | Path to the rigged GLB. |
| `rig` | Skeleton family. Fighters sharing a rig share one retargeting bind pose, so this must match a family `anim.ts` knows. |
| `height` | Metres. Scales the model on load. |
| `idle` | Clip that ships **inside** the body GLB — the signature dance or stance. Also what autochess loops during planning. |
| `victory` | Clip played on a win. Often the same as `idle`. |

### Voice

`{ win, announce }`, both nullable. `win` is the victory line; `announce` is a
walk-out line at the opening bell (only Soso has one). Absent means `null`, not
a missing key.

### Combat

`stats` are five 0–100 axes. The roster spans 78–98, so treat 90 as average,
not 50.

| Stat | What it actually does |
| --- | --- |
| `striking` | Weights punch-type move selection, and accuracy. ~8 points of hit chance across the roster. **Never damage.** |
| `speed` | Who attacks next; makes opponents miss; weights the acrobatic moves. |
| `cardio` | Who attacks next (weighted slightly above speed); weights the pressure flurry. |
| `chin` | Damage taken (~9% swing) and flash-KO resistance (~2x swing). Mostly the second. |
| `grappling` | Weights the knee and the leg sweep; makes counters against you less accurate. The thinnest of the five. |

Two scalars sit outside that scale and are the strongest levers in the sim:

- **`counterSkill`** — `0`–`1`. Chance to fire a free counter when the
  opponent's strike misses. Roster: 0.10 (Cotne) to 0.45 (Dato).
- **`powerKO`** — multiplier on flash-KO chance per landed hit. `1` is neutral;
  the roster runs to 4 (Cotne). A flash KO ends the fight outright, so this is
  worth far more than the number suggests. Always set it explicitly.

Damage is `move × defender's chin × luck`. The attacker's stats do not appear —
they buy accuracy and move selection only.

### Kit

The three control-mode buttons, holding **real move objects** imported from
`moves/`, not key strings — so a typo is a compile error, not a dead button
mid-fight. Kit has no effect on auto-sim: that goes through `pickMove` over the
whole catalogue.

## Adding a fighter

1. `public/assets/fighters/<id>/` with `body.glb`, plus `win.m4a` /
   `announce.mp3` if they have them.
2. `fighters/<id>.ts` exporting `<NAME>: Fighter` in the shape above.
3. Import, re-export, and append to `FIGHTERS` in `index.ts`.
4. Give them an autochess identity in `modes/autochess/units.ts`: a `COST` tier,
   an entry in `ABILITIES`, `ATTACK_CLIPS`, `RANGE`, `ROLE`, `BLURB` and `TUNE`.
   These are `Record<string, …>` lookups, so a missing entry is a **runtime**
   failure when the mode loads, not a compile error — check it by entering
   autochess once.
5. Add a row to `RANK_WR` in `main.ts` — the Rankings tab reads a hardcoded
   table, so a new fighter silently defaults to 50%.
6. `npm run check`, then `node tools/regress.mjs` for the octagon matrix and
   `node tools/balance.mjs` for autochess.
7. Bump `PROTOCOL_VERSION` in `net.ts`.

**`FIGHTERS` order is load-bearing.** `anim.ts` loads body models in this order
and `units.ts` keys each autochess unit's `modelIndex` to that position. Append,
never insert.

## Editing a fighter

`stats`, `counterSkill`, `powerKO` and `kit` all change outcomes — run
`npm run check`, then `regress.mjs` and `balance.mjs`, then bump
`PROTOCOL_VERSION`.

`name`, `nick`, `flag`, `record`, `short` are free.

`visual`, `voice.win` and `voice.announce` are plain path strings that Vite does
not resolve — the files live in `public/`, which is copied verbatim. A wrong
path is a 404 at runtime, not a build error.

## Removing a fighter

Remove the file, the three lines in `index.ts`, the asset folder, and every
autochess table entry from step 4 above. Then `grep -rn "<id>" src tools`: those
tables and the `COMPS` list in `ai.ts` address fighters by **id string**, so the
compiler cannot catch a stale reference the way it can for moves.
