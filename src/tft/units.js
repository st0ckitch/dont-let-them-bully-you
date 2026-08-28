// Autochess roster: the nine fighters re-expressed as TFT-style units.
//
// The MMA sim's 0-100 stats (striking/grappling/cardio/chin/speed) stay the
// source of truth for who a fighter IS — they're derived into TFT combat stats
// here rather than hand-authored, so a balance change in config.js still reads
// through into this mode. Cost tier is the one genuinely new axis: it sets the
// power budget, exactly like TFT's 1-5 cost ladder.

import { FIGHTERS } from '../config.js?v=202608281039';

// ---- cost tiers ----
// Thematic ladder: the office crew comes cheap, the two real UFC champions are
// the chase units. Distribution (3/2/2/1/1) mirrors TFT's shape — many cheap
// units to roll into, one apex unit per tier at the top.
export const COST = {
  soso: 1, davit: 1, cotne: 1,
  gigi: 2, dato: 2,
  levan: 3, david: 3,
  merab: 4,
  ilia: 5,
};

// TFT's cost-tier colours (shop card borders, star pips, portrait frames).
export const TIER_COLOR = {
  1: '#8a949e', // grey
  2: '#11b288', // green
  3: '#207ac7', // blue
  4: '#c440da', // purple
  5: '#ffb93b', // gold
};

// Copies of each champion in the shared pool. TFT scales copies inversely with
// cost so cheap units 3-star easily and 5-costs almost never do. Scaled down
// from TFT's 29/22/18/12/10 because this mode has two shops drawing from a
// nine-champion roster, not eight shops drawing from ~60.
export const POOL_COPIES = { 1: 18, 2: 14, 3: 11, 4: 8, 5: 6 };

// Gold to buy = cost; selling refunds full price EXCEPT 2-and-3-star units of
// cost >= 2, which refund one gold less (TFT's anti-abuse rule).
export function sellValue(cost, star) {
  if (star === 1) return cost;
  const copies = star === 2 ? 3 : 9;
  return cost === 1 ? cost * copies : cost * copies - 1;
}

// ---- derived combat stats ----
// Each cost tier gets a power budget; the fighter's own stats then distribute
// that budget across durability / damage / speed. A 1-cost Cotne is still the
// tankiest 1-cost, an Ilia is still the biggest hitter.
// HP sits ~12% below TFT's equivalents: with no items or trait buffs to ramp
// damage, full 6v6 boards at TFT's health pools ran past the round timer four
// times out of five and were decided by the tiebreak instead of a clean wipe.
// Steeper than before: with the old curve a 1-star Merab (790hp/74ad) LOST to
// any 2-star 1-cost (873hp/86ad), which made the premium tiers feel like a
// downgrade the moment the cheap units starred up. TFT's rule of thumb is that
// a 4-cost 1-star should sit BETWEEN a 2-star 2-cost and a 2-star 3-cost; this
// curve puts our tiers back on that line.
const TIER_HP = { 1: 485, 2: 595, 3: 730, 4: 910, 5: 1160 };
const TIER_AD = { 1: 48, 2: 58, 3: 70, 4: 88, 5: 114 };
const TIER_RESIST = { 1: 20, 2: 26, 3: 33, 4: 45, 5: 60 };

// star scaling — TFT's evergreen rule: each star multiplies HP and AD by 1.8
export const STAR_SCALE = [0, 1, 1.8, 3.24];

const lerp = (a, b, t) => a + (b - a) * t;
// map a 0-100 fighter stat onto a multiplier band centred on 1.0
const band = (v, spread) => lerp(1 - spread, 1 + spread, Math.max(0, Math.min(1, (v - 78) / 22)));

// Signature ability per fighter: the clip it plays, its mana cost, and how it
// resolves. `kind` drives the combat engine:
//   burst   — one big hit on the current target
//   flurry  — several smaller hits, all landing on the impact frame
//   cleave  — hits the target and every enemy adjacent to it
//   heal    — damage plus self-sustain
//
// `dmg` and `heal` are multiples of the unit's attack damage, so they inherit
// star scaling for free. Calibrated so one cast is worth roughly a third of a
// same-tier health bar — enough that casts, not autos, decide fights. `heal`
// is a multiple of AD too, NOT of the ability's damage: keying sustain off the
// damage number let Merab out-heal what he was taking and stalemate mirrors.
const ABILITIES = {
  soso: { name: 'Backflip Barrage', clip: 'backflip_hooks', mana: 55, kind: 'flurry', hits: 3, dmg: 4.2 },
  davit: { name: 'Kung-Fu Flurry', clip: 'kung_fu_punch', mana: 60, kind: 'flurry', hits: 4, dmg: 3.6 },
  cotne: { name: 'Boom Drop', clip: 'jumping_punch', mana: 70, kind: 'burst', hits: 1, dmg: 4.2, stun: 0.5 },
  gigi: { name: 'System Sweep', clip: 'leg_sweep', mana: 65, kind: 'cleave', hits: 1, dmg: 3.2, stun: 0.5 },
  dato: { name: 'Pressure Flurry', clip: 'punch_combo_5', mana: 55, kind: 'flurry', hits: 4, dmg: 3.4 },
  levan: { name: 'Spin Cycle', clip: 'lunge_spin_kick', mana: 65, kind: 'cleave', hits: 1, dmg: 3.4 },
  david: { name: 'Executive Decision', clip: 'backflip_kick', mana: 70, kind: 'burst', hits: 1, dmg: 5.0 },
  merab: { name: 'The Machine', clip: 'spartan_kick', mana: 50, kind: 'heal', hits: 1, dmg: 3.4, heal: 1.35 },
  ilia: { name: 'El Matador', clip: 'flying_kick', mana: 80, kind: 'burst', hits: 1, dmg: 6.0 },
};

// One-line character reads for the detail panel. These lean on who the fighter
// already is in the MMA sim — the counter specialists, the one-punch merchants,
// the teenage prodigy — so the two modes describe the same people.
// Hand-authored rather than derived. A threshold rule on the 0-100 stats keeps
// mislabelling the extremes — Merab and Ilia both clear any durability bar you
// pick, but one is a grinding wrestler and the other is the game's carry.
const ROLE = {
  merab: 'Bruiser',
  ilia: 'Carry',
  davit: 'Brawler',
  cotne: 'Anchor',
  dato: 'Brawler',
  levan: 'Reach',
  david: 'Carry',
  soso: 'Skirmisher',
  gigi: 'Reach',
};

const BLURB = {
  merab: 'Relentless pressure wrestler. Never stops coming forward, and heals off every kick he lands.',
  ilia: 'The finisher. Highest damage in the cage and an ability that ends rounds on its own.',
  davit: 'Southpaw brawler with a busy guard. Cheap, sturdy, and fine on a front line all game.',
  cotne: 'The wall. Soaks a front line by himself and drops a stunning bomb when the mana fills.',
  dato: 'Counter-brawler. Built to survive the walk in and punish whatever swung first.',
  levan: 'Speed-first all-rounder who kicks from a hex further out than anyone expects.',
  david: 'Heavy hands, thin chin. Burst him in behind a tank and let him delete the carry.',
  soso: 'Teenage prodigy. Fastest hands in the roster and the squishiest body to go with them.',
  gigi: 'Reads the fight like a system diagram. Sweeps a whole cluster and leaves them stunned.',
};

// Human-readable ability text with the real numbers for a given star level.
// Damage is a multiple of AD, so it inherits star scaling automatically.
export function abilityText(unit, star = 1) {
  const ab = unit.ability;
  const s = statsFor(unit, star);
  const total = Math.round(s.ad * ab.dmg);
  const stun = ab.stun ? ` and stuns for ${ab.stun}s` : '';
  switch (ab.kind) {
    case 'flurry':
      return `Unloads ${ab.hits} strikes on the current target for ${total} magic damage in total (${Math.round(total / ab.hits)} each).`;
    case 'cleave':
      return `Sweeps the target and every enemy next to it for ${total} magic damage${stun}.`;
    case 'heal':
      return `Heals himself for ${Math.round(s.ad * ab.heal)} and blasts the target for ${total} magic damage.`;
    default:
      return `Slams the target for ${total} magic damage${stun}.`;
  }
}

// Basic-attack clips. Autochess attacks fire roughly once a second, so the
// pool is restricted to SHORT single-impact strikes — the long multi-hit
// combos read as mush at that cadence and are reserved for abilities.
const ATTACK_CLIPS = {
  soso: ['hook', 'uppercut', 'knee_strike'],
  davit: ['uppercut', 'hook', 'elbow_strike'],
  cotne: ['hook', 'elbow_strike'],
  gigi: ['uppercut', 'elbow_strike', 'knee_strike'],
  dato: ['hook', 'knee_strike', 'uppercut'],
  levan: ['uppercut', 'knee_strike', 'hook'],
  david: ['uppercut', 'hook', 'elbow_strike'],
  merab: ['knee_strike', 'elbow_strike', 'hook'],
  ilia: ['hook', 'uppercut', 'knee_strike'],
};

// The normalized clip time at which each attack clip lands its blow. Lifted
// from the MOVES table in fight.js so the autochess hit lands on the same
// animation frame the sim already tuned against rotational-energy peaks.
export const ATTACK_IMPACT_AT = {
  hook: 0.5, uppercut: 0.5, knee_strike: 0.33, elbow_strike: 0.48,
};

// Range in hexes. Everyone is an MMA fighter, so nobody is a true ranged
// carry — but the long-kick specialists poke from one hex further, which is
// what gives the board a front line and a back line worth positioning around.
const RANGE = { soso: 1, davit: 1, cotne: 1, gigi: 2, dato: 1, levan: 2, david: 1, merab: 1, ilia: 1 };

// Reach has to be paid for. This mode has no dive or assassin mechanics to
// punish a back line, so an extra hex of range is otherwise strictly better —
// untaxed, Gigi beat his 2-cost peer 90% of the time. Ranged units trade
// durability and damage for the free hits they land while closing.
const RANGE_TAX = { 1: { hp: 1, ad: 1 }, 2: { hp: 0.9, ad: 0.95 } };

// Per-unit identity multipliers, applied last. The stat derivation captures
// what the MMA sim already says about a fighter; this is where a unit's ROLE
// in autochess gets its final say — Cotne has to actually feel like the 1-cost
// wall, which his 0-100 stat line alone doesn't buy him.
// Kept deliberately small. A 1v1 here is a near-deterministic damage race, so
// a 30% swing flips a matchup from 0% to 100% — these are balanced against
// TEAM win rate across random boards (see tools/balance.mjs), which is what
// TFT actually tunes, not duels.
const TUNE = {
  cotne: { hp: 1.12, ad: 1.0, as: 1.0 }, // the wall: soaks a front line on his own
  davit: { hp: 1.0, ad: 1.0, as: 1.0 },
  soso: { hp: 0.97, ad: 1.03, as: 1.0 }, // glass cannon, leans a little both ways
  dato: { hp: 1.05, ad: 1.0, as: 1.0 },  // counter-brawler survives the closing walk
  gigi: { hp: 1.0, ad: 1.0, as: 1.0 },
  levan: { hp: 1.0, ad: 1.0, as: 1.0 },
  david: { hp: 1.0, ad: 1.0, as: 1.0 },
  merab: { hp: 1.0, ad: 1.0, as: 1.0 },
  ilia: { hp: 1.0, ad: 1.0, as: 1.0 },
};

function buildUnit(cfg, index) {
  const cost = COST[cfg.id];
  const s = cfg.stats;
  // durability leans on chin + grappling, damage on striking, cadence on speed
  const range = RANGE[cfg.id];
  const tax = RANGE_TAX[range];
  const tune = TUNE[cfg.id] || { hp: 1, ad: 1, as: 1 };
  const durability = (s.chin * 0.65 + s.grappling * 0.35);
  const hp = Math.round(TIER_HP[cost] * band(durability, 0.16) * tax.hp * tune.hp / 5) * 5;
  const ad = Math.round(TIER_AD[cost] * band(s.striking, 0.14) * tax.ad * tune.ad);
  // wider band than the other stats: attack speed is the only lever that makes
  // the speed stat legible on screen, and a narrow one left Soso (the fastest
  // man in the roster, and the squishiest) losing 3-to-1 to his 1-cost peers
  const attackSpeed = +(0.62 * band(s.speed, 0.28) * tune.as).toFixed(2);
  const armor = Math.round(TIER_RESIST[cost] * band(s.grappling, 0.3));
  const mr = Math.round(TIER_RESIST[cost] * band(s.chin, 0.3));
  const ability = ABILITIES[cfg.id];
  return {
    id: cfg.id,
    cfg,
    // loadAssets() returns models in FIGHTERS order, and UNITS is built from
    // that same array, so the index lines a unit up with its loaded model.
    modelIndex: index,
    cost,
    name: cfg.name,
    short: cfg.short,
    nick: cfg.nick,
    rig: cfg.rig,
    blurb: BLURB[cfg.id],
    role: ROLE[cfg.id],
    color: TIER_COLOR[cost],
    range,
    attackClips: ATTACK_CLIPS[cfg.id],
    idleClip: cfg.builtin,
    ability,
    base: {
      hp, ad, attackSpeed, armor, mr,
      // Cardio buys a head start on the first cast; the rest is earned in combat.
      startMana: Math.round((s.cardio - 78) * 0.8),
      maxMana: ability.mana,
      critChance: 0.25,
      critMult: 1.4,
    },
  };
}

export const UNITS = FIGHTERS.map(buildUnit);
export const UNIT_BY_ID = Object.fromEntries(UNITS.map(u => [u.id, u]));

// Stats for a specific star level.
export function statsFor(unit, star) {
  const k = STAR_SCALE[star];
  const b = unit.base;
  return {
    maxHp: Math.round(b.hp * k),
    ad: Math.round(b.ad * k),
    attackSpeed: b.attackSpeed,
    armor: b.armor,
    mr: b.mr,
    maxMana: b.maxMana,
    startMana: b.startMana,
    critChance: b.critChance,
    critMult: b.critMult,
    // ability damage scales with star level the same way AD does
    abilityPower: k,
  };
}

export const UNITS_BY_COST = (() => {
  const m = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const u of UNITS) m[u.cost].push(u);
  return m;
})();
