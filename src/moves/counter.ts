import type { CounterMove, CounterClip } from './types.ts';

// Reactive move only: triggered when a strike is dodged, never picked as an attack.
export const COUNTER_MOVE: CounterMove = {
  key: 'counter', label: 'counter', range: 1.2, reach: 1.5, heavy: false,
  impacts: [{ at: 0.58, min: 9, max: 14 }],
};

// Two counter animations chosen at random: the dodge_counter flurry subclip
// and the dedicated Counterstrike clip. Damage math stays COUNTER_MOVE's —
// only the visuals and the impact moment (energy-peak fraction) differ.
export const COUNTER_CLIPS: CounterClip[] = [
  { key: 'counter', at: 0.58 },
  { key: 'counterstrike', at: 0.67 },
];
