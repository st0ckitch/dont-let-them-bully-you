// Upgrade arrow + Play Again, on real engines.
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 850 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:8124/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__fight?.fighters && Object.keys(window.__fight.fighters).length === 9, null, { timeout: 120000 });
await page.click('.modeBtn[data-mode="autochess"]');
await page.click('#menuFightBtn');
await page.waitForFunction(() => window.__tft?.board?.loaded, null, { timeout: 60000 });

// ---- upgrade arrow: 2 copies held + card in shop -> bouncing s2 arrow ----
const arrows = await page.evaluate(() => {
  const m = window.__tft;
  m.paused = true; m.econ.gold = 60;
  m.pool.take('soso'); m.roster.add('soso');
  m.pool.take('soso'); m.roster.add('soso');            // pair of 1-stars
  m.shop = ['soso', 'davit', 'cotne', 'dato', 'gigi'];
  m.ui.onState(m.snapshot());
  const a2 = document.querySelector('.acCard .acUp');
  // cascade case: two 2-stars + a pair of 1-stars -> the third 1-star cascades to 3
  for (let i = 0; i < 6; i++) { m.pool.take('davit'); m.roster.add('davit'); }  // -> two 2-stars
  m.pool.take('davit'); m.roster.add('davit');
  m.pool.take('davit'); m.roster.add('davit');           // + pair of 1-stars
  m.ui.onState(m.snapshot());
  const cards = [...document.querySelectorAll('.acCard')];
  const davitCard = cards.find(c => c.dataset.shopId === 'davit');
  return {
    s2: a2 ? a2.className : null,
    s3: davitCard?.querySelector('.acUp')?.className ?? null,
    noArrowOnOthers: !cards.find(c => c.dataset.shopId === 'gigi')?.querySelector('.acUp'),
  };
});

// ---- play again: force a loss, tap the button, expect a fresh game ----
const again = await page.evaluate(async () => {
  const m = window.__tft;
  m.econ.hp = 1; m.oppHp = 100;
  const H = await import('/src/modes/autochess/hex.js?v=x');
  if (!m.roster.board.length) {
    const e = m.roster.bench[0] || m.roster.add('soso').entry;
    m.place(e, H.cellId(3, 6));
  }
  m.roundIndex = 20;                    // stacked enemy, guaranteed loss
  m.paused = false; m.beginCombat(); m.paused = true;
  let g = 60 * 40;
  while (m.phase === 'combat' && g-- > 0) { m.paused = false; m.update(1/60); m.paused = true; }
  return {
    phase: m.phase,
    btn: document.querySelector('.acAgain')?.textContent ?? null,
    bannerShown: !document.querySelector('.acBanner').classList.contains('hidden'),
  };
});
await page.waitForTimeout(3000);        // outlive the round-end auto-hide
const survived = await page.evaluate(() => !document.querySelector('.acBanner').classList.contains('hidden'));
await page.click('.acAgain');
await page.waitForTimeout(400);
const fresh = await page.evaluate(() => {
  const m = window.__tft;
  return { phase: m.phase, hp: m.econ.hp, oppHp: m.oppHp, label: `${m.stage}-${m.round}`, roster: m.roster.entries.length, bannerHidden: document.querySelector('.acBanner').classList.contains('hidden') };
});
console.log(JSON.stringify({ arrows, again, bannerSurvivesAutoHide: survived, fresh, errs }, null, 2));
await browser.close();
