export const MERAB = {
  id: 'merab', short: 'MERAB', name: 'Merab Dvalishvili', nick: 'The Machine', flag: '🇬🇪',
  record: '19–4–0', stance: 'Orthodox',
  body: 'assets/merab_body.glb',
  rig: 'athletic',
  builtin: 'idle', // clip that rides along inside the body GLB
  height: 1.8,
  victoryClip: 'victory_cheer',
  voice: 'assets/sounds/merab_win.m4a',
  counterSkill: 0.25,
  stats: { striking: 86, grappling: 97, cardio: 97, chin: 95, speed: 86 },
};

export const ILIA = {
  id: 'ilia', short: 'ILIA', name: 'Ilia Topuria', nick: 'El Matador', flag: '🇬🇪🇪🇸',
  record: '17–0–0', stance: 'Orthodox',
  body: 'assets/ilia_body.glb',
  rig: 'athletic',
  builtin: 'walk',
  height: 1.76,
  victoryClip: 'chest_pound',
  voice: 'assets/sounds/ilia_win.m4a',
  counterSkill: 0.38,
  stats: { striking: 96, grappling: 88, cardio: 88, chin: 92, speed: 90 },
};

export const DAVIT = {
  id: 'davit', short: 'DAVIT', name: 'Davit Panjakidze', nick: 'The Hoking', flag: '🇬🇪',
  record: '12–3–0', stance: 'Southpaw',
  body: 'assets/davit_body.glb',
  rig: 'portrait',
  builtin: 'uppercut',
  height: 1.82,
  victoryClip: 'flex',
  voice: 'assets/sounds/davit_win.m4a',
  counterSkill: 0.3,
  // chin 88→91 after the 30s-round retune: flash KOs weigh more in longer
  // fights and his chin was the soft target in every drifted pairing
  stats: { striking: 90, grappling: 85, cardio: 92, chin: 91, speed: 92 },
};

export const COTNE = {
  id: 'cotne', short: 'COTNE', name: 'Cotne Patchuashvili', nick: 'The Fatso', flag: '🇬🇪',
  record: '9–1–0', stance: 'Orthodox',
  body: 'assets/cotne_body.glb',
  rig: 'bigguy',
  builtin: 'boom_dance',
  height: 1.9,
  victoryClip: 'boom_dance',
  counterSkill: 0.1,
  // one-punch power: 4× flash-KO chance — Monte-Carlo balanced (44-56% vs the
  // roster) to offset the slowest speed/cardio in the game
  powerKO: 4,
  stats: { striking: 96, grappling: 80, cardio: 86, chin: 98, speed: 79 },
};

export const DATO = {
  id: 'dato', short: 'DATO', name: 'Dato Witaishvili', nick: 'The Firuz', flag: '🇬🇪',
  record: '11–2–0', stance: 'Southpaw',
  body: 'assets/dato_body.glb',
  rig: 'dato',
  builtin: 'funny_dance',
  height: 1.85,
  victoryClip: 'funny_dance',
  // counter-brawler: highest counterSkill in the roster + some one-punch pop.
  // Monte-Carlo balanced: 51/50/54/56% vs merab/ilia/davit/cotne (N=3000)
  counterSkill: 0.45,
  powerKO: 1.8,
  stats: { striking: 94, grappling: 86, cardio: 88, chin: 96, speed: 85 },
};

export const LEVAN = {
  id: 'levan', short: 'LEVAN', name: 'Levan Kuprava', nick: 'The CPO', flag: '🇬🇪',
  record: '13–2–0', stance: 'Orthodox',
  body: 'assets/levan_body.glb',
  rig: 'levan',
  builtin: 'gangnam_dance',
  height: 1.8,
  victoryClip: 'gangnam_dance',
  // speed-first volume all-rounder — pressure without Cotne/Dato's one-punch
  // gimmicks. Monte-Carlo balanced 43-57% vs the roster (N=3000): the Merab
  // matchup rides his speed edge, the Cotne one fears the power, like everyone.
  counterSkill: 0.28,
  stats: { striking: 90, grappling: 90, cardio: 92, chin: 91, speed: 93 },
};

export const DAVID = {
  id: 'david', short: 'DAVID', name: 'David Kometiani', nick: 'The CEO', flag: '🇬🇪',
  record: '10–1–0', stance: 'Orthodox',
  body: 'assets/david_body.glb',
  rig: 'david',
  builtin: 'funny_dance_3',
  height: 1.83,
  victoryClip: 'funny_dance_3',
  // boss with heavy hands: high striking + a bit of one-punch pop, weak
  // grappling. Monte-Carlo balanced 48-52% vs the whole roster (N=3000).
  counterSkill: 0.2,
  powerKO: 1.8,
  stats: { striking: 94, grappling: 82, cardio: 90, chin: 94, speed: 87 },
};

export const SOSO = {
  id: 'soso', short: 'SOSO', name: 'Soso Ananov', nick: 'The 17', flag: '🇬🇪',
  record: '5–0–0', stance: 'Southpaw',
  body: 'assets/soso_body.glb',
  rig: 'soso',
  builtin: 'funky_walk',
  height: 1.78,
  victoryClip: 'muscle_flex',
  voice: 'assets/sounds/soso_win.m4a',
  announce: 'assets/sounds/soso_announce.mp3', // Buffer-style walk-out line at the opening bell
  // teenage prodigy: fastest man in the roster with a bottomless gas tank
  // and finishing instinct, green everywhere else — no grappling, chin still
  // developing. powerKO (not striking) is the buff lever here: flash KOs
  // scale on the OPPONENT'S chin, so it lifts him vs the mid-tier without
  // blowing out the merab matchup. Balanced against BOTH sims (simFight
  // N=4000 AND headless live-engine N=200+): 46-61% band, wins mostly
  // finishes. Weak-side story: cotne/david trade bombs with him ~50/50.
  counterSkill: 0.3,
  powerKO: 1.6,
  stats: { striking: 89, grappling: 78, cardio: 93, chin: 90, speed: 94 },
};

export const GIGI = {
  id: 'gigi', short: 'GIGI', name: 'Gigi Gvaramia', nick: 'The Deputy CTO', flag: '🇬🇪',
  record: '14–6–1', stance: 'Southpaw',
  body: 'assets/gigi_body.glb',
  rig: 'gigi',
  builtin: 'pod_groove',
  height: 1.82,
  victoryClip: 'pod_groove',
  voice: 'assets/sounds/gigi_win.m4a',
  // the architect: reads the fight like a system diagram — elite counters
  // (second only to Dato), sturdy chin, real grappling, a step slower than
  // the kids. simFight N=3000: 43-57% — feasts on merab (57), the teenage
  // speed of soso is the one system he can't debug (43).
  counterSkill: 0.42,
  stats: { striking: 94, grappling: 89, cardio: 91, chin: 94, speed: 88 },
};

export const FIGHTERS = [MERAB, ILIA, DAVIT, COTNE, DATO, LEVAN, DAVID, SOSO, GIGI];
