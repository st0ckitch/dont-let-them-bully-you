/** Injected by Vite's `define` at build time — replaces the old stamp.mjs
 *  timestamp, and is shown on the loading screen so "did it update?" is
 *  answerable at a glance. */
declare const __BUILD__: string;

interface Window {
  /** build stamp, read by the autochess HUD's corner label */
  __BUILD?: string;
}
