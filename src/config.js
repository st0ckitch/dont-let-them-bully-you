export const MERAB = {
  id: 'merab', short: 'MERAB', name: 'Merab Dvalishvili', nick: 'The Machine', flag: '🇬🇪',
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
  body: 'assets/davit_body.glb',
  rig: 'portrait',
  builtin: 'uppercut',
  height: 1.82,
  victoryClip: 'flex',
  voice: 'assets/sounds/davit_win.m4a',
  counterSkill: 0.3,
  stats: { striking: 90, grappling: 85, cardio: 92, chin: 88, speed: 92 },
};

export const FIGHTERS = [MERAB, ILIA, DAVIT];
