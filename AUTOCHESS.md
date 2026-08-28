# Autochess mode

A TFT-style autobattler built on the existing fighter roster, animations and
rigs. Pick it from the mode selector on the roster screen (**Auto-sim /
Take control / Autochess**), then press **ENTER THE CAGE**.

Auto-sim and control mode are untouched — the only shared file that changed is
`fighter3d.js`, which gained two constructor options that both default to the
old behaviour.

## The loop

**PLANNING (30s)** — buy fighters from the 5-card shop, drag them onto your
half of the board, level up or reroll. **COMBAT (up to 30s)** — hands off; the
sim resolves. **RESOLVE** — damage, gold, streak, then the next round.

Rounds are labelled `stage-round`. Stage 1 is 3 rounds, later stages are 5.

## Controls

| Input | Action |
| --- | --- |
| Click a shop card | Buy |
| Click a bench portrait | Pick up / put down |
| Click a hex | Place the held fighter (or pick up the one standing there) |
| Click an occupied hex while holding | Swap the two |
| Hover a shop card / bench slot | Preview that fighter in the inspector |
| `1`–`5` | Buy that shop slot |
| `D` | Reroll (2g) |
| `F` | Buy XP (4g) |
| `L` | Freeze / unfreeze the shop |
| `E` | Sell the selected fighter |
| `Space` | Start the round early |
| Drag / double-click | Orbit / reset the camera |

**Freezing** holds the current shop through the next round, empty slots
included — that's the point, you keep a pair you can't afford yet. Paying to
reroll clears the freeze.

**Selling** is the button in the inspector panel, showing the exact refund.
Every copy folded into the unit goes back to the shared pool.

**Board capacity** has its own readout in the left rail (`5 / 8 on board`, with
a pip per slot). It equals your level, so it turns gold and tells you to level
up when full. This is the answer to "why can't I place this?".

**The inspector** shows a fighter's stat block and their ability with the real
numbers *for their current star level* — Gigi's System Sweep reads 179 damage
at 1★ and 579 at 3★. Hover a shop card to preview before buying.

## Mechanics

Standard TFT rules, scaled to a nine-fighter roster.

**Economy** — 5 gold base per round, +1 per 10 banked (capped at +5), plus a
streak bonus for win *or* loss streaks: **2/3/4 = +1g, 5 = +2g, 6+ = +3g**.
Reroll 2g, XP 4g for 4xp, 2xp free each round. Board slots = your level.

**Shop odds** by level, `[1,2,3,4,5]`-cost:

| Lv | 1 | 2 | 3 | 4 | 5 |
| -- | - | - | - | - | - |
| 1–2 | 100 | 0 | 0 | 0 | 0 |
| 3 | 75 | 25 | 0 | 0 | 0 |
| 4 | 55 | 30 | 15 | 0 | 0 |
| 5 | 45 | 33 | 20 | 2 | 0 |
| 6 | 30 | 40 | 25 | 5 | 0 |
| 7 | 19 | 30 | 33 | 14 | 4 |
| 8 | 14 | 20 | 30 | 29 | 7 |
| 9 | 10 | 15 | 23 | 33 | 19 |

**Upgrades** — 3 copies at the same star merge into the next star, cascading
(nine 1-stars become a 3-star). Each star multiplies HP and AD by 1.8. The
upgrade inherits a board slot if any of the three held one.

**Pool** — shared and finite: 18/14/11/8/6 copies per champion by cost tier.
Selling returns every copy folded into the unit.

**Combat** — units take the nearest enemy, walk the hex grid toward it (0.42s
per hex), auto-attack on an attack-speed cadence, and cast their signature
ability when mana fills. Attack speed caps at 5.0; crit is 25% for 1.40×.

- Armour and magic resist both use `100/(100+resist)`, with resist clamped at
  0 — TFT has no negative-resist amplification branch.
- Mana: +10 per attack, plus `min(42.5, 1% of pre-mitigation + 7% of
  post-mitigation)` when damaged, with a 1s mana lock after casting. Casting
  **carries the overflow** rather than resetting to zero.
- Each star multiplies HP and AD by **1.8** (not 1.5 — that figure is widely
  published and wrong).

Numbers were cross-checked against a research pass over Riot patch notes and
current-set data; the shop odds, streak breakpoints, sell values and mana rules
above reflect corrections to several widely-mirrored but stale community tables.

## Multiplayer

Pick **Autochess** in the mode selector, then CREATE LOBBY / JOIN with the same
4-digit code the octagon modes use, and both press READY.

It works the way the octagon mode does — by **not** streaming state. `combat.js`
is bit-deterministic (`tools/determinism.mjs` proves it over 200 seeds), so peers
only exchange **boards**: a handful of `{id, star, cell}` per round. Each side
then runs the identical fight locally and reaches the same result. One message
per player per round, and no server.

Two invariants make that safe, both enforced in `netmatch.js`:

- **Canonical coordinates.** The host owns rows 4-7 and the guest rows 0-3, on
  *both* peers. The guest's screen is rotated 180° instead of its data —
  `cellAtPointer()` goes through `root.worldToLocal()`, so picking inverts the
  rotation for free and no coordinate is ever mirrored by hand.
- **Canonical order.** The units array is always `[host…, guest…]`. Feeding the
  same units in a different order produces a *different* fight — the
  determinism test asserts this explicitly.

The board exchange is also the barrier: a round resolves only when both boards
are in hand, so the two clocks re-sync every round with no timing message. The
per-round seed is derived from the match seed, so it costs nothing to agree.

Each player keeps their **own** economy, shop and pool — there is no contest for
copies. That is a deliberate simplification: a shared pool would need an
authoritative owner and action reconciliation, which is a far larger protocol
for a 1v1.

`tools/nettest.mjs` plays a full 12-round match between two peers over a mock
transport and asserts every damage event matched, in order, on both sides —
including under reversed delivery and duplicate submissions.

## The opponent

The AI plays **the same game you do** (`ai.js`). It owns a roster, gold, XP and
a level, rolls its own 5-card shop out of the **shared pool**, buys, merges,
levels and fields its best units. Nothing is privileged — no stat bonuses, no
invented star levels, no knowledge of your board. Its purchases really do remove
copies you could have bought.

It commits to its board at the start of planning, so you can **scout** it in the
panel on the right before you commit yours.

Difficulty lives entirely in `AI_TUNING` — level tempo, gold reserve, and rolls
per round. Do not tune it with stat bonuses: that breaks the pool-and-star-up
logic the player is learning, and makes a lost round unreadable.

Measured over 300 simulated games (`tools/aitest.mjs`):

| | AI | random baseline |
| --- | --- | --- |
| roster continuity round-to-round | 92% | ~25% |
| distinct fighters used per game | 5.5 of 9 | 9 of 9 |
| boards with 3+ copies at one star | 0 | common |
| boards of ≤1 unit after round 3 | 0% | common |

Against a scripted competent player it wins roughly half of full games
(`tools/gametest.mjs`, ~46-54% player win rate), with games running ~19 rounds —
long enough that level 7-8 and the 4/5-cost endgame are a normal part of a
match rather than a theoretical one. It also commits to a named comp at game
start (Executive Suite / Long Reach / Prodigy Rush / System Control), biasing
its shopping toward one carry and core so its board reads as a strategy, and
treats Merab/Ilia as its late-game payoff once its level can shop them. Its brain: level tempo of a competent
player, interest banking with a committed roll-down when rich, a stabilise mode
that dumps the reserve into rerolls when its own HP drops, and positioning that
puts the tankiest bodies centre-front with reach units behind.

## Reading the shop

A card that would **complete a merge right now** carries an animated up-arrow:
silver for a 2-star, gold when it cascades straight to a 3-star.

## The roster as units

Cost tier sets the power budget; the fighter's existing 0–100 MMA stats
(striking / grappling / cardio / chin / speed) distribute it, so a balance
change in `config.js` still reads through. Reach costs stat budget — the two
range-2 fighters pay for it in HP and AD.

| Cost | Fighters | Ability |
| --- | --- | --- |
| 1 | Soso, Davit, Cotne | Backflip Barrage, Kung-Fu Flurry, Boom Drop |
| 2 | Gigi *(reach 2)*, Dato | System Sweep, Pressure Flurry |
| 3 | Levan *(reach 2)*, David | Spin Cycle, Executive Decision |
| 4 | Merab | The Machine |
| 5 | Ilia | El Matador |

## Animation changes for this mode

Attack clips were authored for the MMA sim, where one strike owns an entire
exchange. Here a unit attacks about once a second, so:

- Basic attacks are restricted to **short single-impact clips** (hook,
  uppercut, knee, elbow) and **time-scaled to exactly fill the attack
  interval**. Long combos would still be winding up when the next attack is due.
- Damage fires on the same normalized clip frame the MMA sim already tuned
  against rotational-energy peaks (`ATTACK_IMPACT_AT`).
- The flashy multi-hit clips (flying kick, backflip kick, kung-fu flurry…)
  became **abilities**, with the sim's cast window derived from the real clip
  length so the impact frame and the damage tick agree.
- Deaths play the real `knock_down` fall, then sink and fade so the board clears.
- During planning, units loop their **signature clip** (each fighter's dance or
  idle) — the same one the roster screen uses.

## Layout

7 columns × 8 rows of pointy-top hexes in odd-r offset. Rows 0–3 are the enemy
half, 4–7 are yours. `hex.js` speaks offset `(col,row)` as the canonical cell
id and derives axial coordinates for distance, neighbours and pathfinding.

## Files

```
src/tft/hex.js       hex grid math + pathfinding
src/tft/units.js     roster -> TFT units, cost tiers, abilities, star scaling
src/tft/combat.js    battle sim (pure: no THREE, no DOM)
src/tft/shop.js      pool, shop odds, economy, roster/merges
src/tft/board3d.js   cage model, hex overlay, pointer picking
src/tft/unitview.js  per-unit visuals (cloned rig, bars, retimed animation)
src/tft/mode.js      phases, rounds, opponent, sim<->visual bridge
src/tft/ui.js        HUD
src/tft/tft.css      HUD styles
```

`combat.js` is deliberately free of THREE and DOM so the same class runs
headless — the balance harness drives it directly, mirroring how `fight.js`
splits `simFight()` from the live `Engine`.

## Tools

Run from `../tools`:

```
node hextest.mjs      # grid math, picking stability, path symmetry
node shoptest.mjs     # merges, pool accounting, shop odds, economy
node combattest.mjs   # structure: mirror symmetry, termination, star/cost effect
node balance.mjs      # roster balance across random boards (the real tuning metric)
node regress.mjs      # the untouched MMA sim's matrix, as a regression guard
```

`balance.mjs` is the one to trust for roster tuning. A 1v1 between two
same-cost units is a near-deterministic damage race that goes bimodal on a few
stat points, so it reports healthy rosters as broken; TFT balances board
contribution, and so does this.

Current state: in-tier spread 1.1–1.3 points, win rate climbing 44.7% → 61.2%
across the cost ladder.
