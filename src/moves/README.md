# moves

Every strike the sim can throw, one file per move, re-exported through
`index.ts`. A move is **inert data** — it knows its animation clip, the
distances it works at, and the damage each impact does. It does not know who
throws it or what happens on landing; that is `modes/octagon/fight.ts`.

```
moves/
  index.ts          barrel — imports all, exports MOVES + MOVE_BY_KEY
  types.ts          Move, Impact, CounterMove, CounterClip
  counter.ts        COUNTER_MOVE + COUNTER_CLIPS (reactive only)
  hook.ts           one file per move, named after its key
  leg_sweep.ts
  ...
```

Imports carry an explicit `.ts` extension. That is what lets `node tools/*.mjs`
import these modules directly — Node strips types natively — while Vite resolves
them the same way. Do not write extensionless imports; Node's ESM loader rejects
them and the harnesses stop running.

## The model

```ts
import type { Move } from './types.ts';

export const HOOK: Move = {
  key: 'hook',            // identity; also the animation clip name
  label: 'left hook',     // shown in commentary and the feed
  range: 1.05,            // distance the attacker closes to before striking
  reach: 1.3,             // max distance an impact can still land at
  heavy: false,           // heavy strikes get 1.5x flash-KO chance
  impacts: [{ at: 0.5, min: 8, max: 14 }],
  w: f => 25 + f.stats.striking * 0.3,
};
```

The `Move` annotation is what makes a missing or misspelled field a compile
error. `w` takes a `Weighable` (`{ stats }`) rather than a `Fighter`, which is
what keeps `moves/` from importing `fighters/`.

| Field | Meaning |
| --- | --- |
| `key` | Unique id. **Must match the clip name** in `anim.ts` and the GLB in `assets/anim/`. Also the filename. |
| `label` | Human text. Appears in commentary lines and the fighter detail card. |
| `range` | How close the attacker walks before starting the strike. |
| `reach` | Air gate. If the defender is further than this when the impact frame arrives, the strike whiffs regardless of the accuracy roll. Always `> range`. |
| `heavy` | Multiplies flash-KO chance by 1.5. Use it for committed kicks, not for punches. |
| `impacts` | One entry per blow. `at` is normalized clip time (0–1) tuned to the clip's rotational-energy peak; `min`/`max` are the raw damage roll. |
| `w` | Weight function — see below. |

### `impacts` is also the flash-KO count

Every impact rolls separately for hit/block/miss **and separately for a flash
KO**. A four-hit combo is four chances to end the fight outright, which is why
adding a hit to a combo is a bigger balance change than it looks. `fight.ts`
carries a note about exactly this: a fourth impact on `backflip_hooks` moved
Cotne's matchup by nine points.

### `w` — weight

`w(fighter)` returns that fighter's **relative share of their own move budget**.
It is not a probability. `pickMove` sums every weight and draws once across the
total:

    P(move) = w(fighter) / Σ w(fighter) over all moves

Three consequences:

- **Only ratios matter.** Doubling every weight changes nothing.
- **Adding a move dilutes every other move**, because it grows the denominator.
- **Zero would mean never** — but no move currently reaches zero. Every formula
  has a positive base constant, so all nine fighters can throw all 24 moves.
  The stat terms only change how often.

`punch_combo` has a base of 55 against the next-highest 25, so it is 17–21% of
every fighter's output. Read a fighter's real distribution from their detail
card (the `i` badge on a roster tile) rather than from the formulas.

## Adding a move

1. Put the clip at `public/assets/anim/<key>.glb` and register it in `anim.ts`.
2. Create `moves/<key>.ts` exporting `<KEY>: Move` with the fields above.
3. Add the import, the re-export, and the `MOVES` entry in `index.ts`.
4. `npm run check` — then `node tools/regress.mjs` to see the matrix, since a
   new move takes share from every existing one and shifts the whole thing.
5. Bump `PROTOCOL_VERSION` in `net.ts`. Move selection is part of the seeded
   replay: two clients on different builds will replay one seed into different
   winners with no error.

**`MOVES` order is load-bearing.** `pickMove` walks the array, so reordering it
lands a given roll on a different move. Append rather than insert.

## Editing a move

Damage, `at`, `range`/`reach` and `w` all change fight outcomes — same
verification as above: `npm run check`, then `node tools/regress.mjs`, then bump `PROTOCOL_VERSION`.

`label` alone is free. So is `doc`-style commentary.

Changing `key` is the expensive one: it is the animation clip name, the
filename, and the lookup used by `MOVE_BY_KEY` and the autochess clip tables.
Rename all four together.

## Removing a move

Delete the file and drop its three lines from `index.ts`. You do not need to
grep: kits hold move *objects*, so a kit still naming a deleted move is a
compile error from `npm run typecheck`. That is the point of the object kit.
