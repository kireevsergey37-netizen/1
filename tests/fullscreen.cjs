// Run against the development server: node tests/fullscreen.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const baseURL = process.env.GAME_URL || 'http://127.0.0.1:8001/';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  async function fits(page) {
    await page.clock.runFor(100);
    const sizes = await page.evaluate(() => {
      const panel = document.querySelector('#game-panel').getBoundingClientRect();
      const canvas = document.querySelector('canvas'), field = canvas.getBoundingClientRect();
      const controls = document.querySelector('.touch-controls').getBoundingClientRect();
      return { w: innerWidth, h: innerHeight, panel: { x: panel.x, y: panel.y, w: panel.width, h: panel.height }, canvas: { w: canvas.width, h: canvas.height, cssW: field.width, cssH: field.height }, controlsBottom: controls.bottom, fieldBottom: field.bottom, glError: canvas.getContext('webgl').getError() };
    });
    assert.equal(sizes.panel.x, 0); assert.equal(sizes.panel.y, 0);
    assert.equal(sizes.panel.w, sizes.w); assert.equal(sizes.panel.h, sizes.h);
    assert(sizes.canvas.cssH > 200, 'Canvas fills the remaining screen height');
    assert.equal(sizes.canvas.w, Math.round(sizes.canvas.cssW));
    assert.equal(sizes.canvas.h, Math.round(sizes.canvas.cssH));
    assert(sizes.controlsBottom <= sizes.fieldBottom, 'Touch controls stay inside the field');
    assert.equal(sizes.glError, 0);
  }
  try {
    for (const fallback of [false, true]) {
      const page = await browser.newPage({ viewport: fallback ? { width: 844, height: 390 } : { width: 1000, height: 800 }, deviceScaleFactor: 1, ...(fallback ? { isMobile: true, hasTouch: true } : {}) });
      page.on('pageerror', error => errors.push(error.message));
      const now = new Date(); await page.clock.install({ time: now }); await page.clock.pauseAt(now);
      if (fallback) await page.addInitScript(() => {
        Object.defineProperty(Element.prototype, 'requestFullscreen', { value: undefined, configurable: true });
        Object.defineProperty(Element.prototype, 'webkitRequestFullscreen', { value: undefined, configurable: true });
      });
      await page.goto(baseURL);
      const originalHeight = await page.locator('canvas').evaluate(e => e.getBoundingClientRect().height);
      await page.getByRole('button', { name: 'На весь экран', exact: true }).click();
      assert.equal(await page.locator('#fullscreen').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => document.fullscreenElement?.id ?? null), fallback ? null : 'game-panel');
      await fits(page);
      await page.getByRole('button', { name: 'На старт!' }).click();
      if (fallback) assert(await page.locator('#touch-controls').isVisible());
      await page.keyboard.down('d'); await page.clock.runFor(300); await page.keyboard.up('d');
      assert(Number(await page.locator('#speed').textContent()) > 0, 'Race continues in fullscreen');
      await page.keyboard.press('p');
      const pausedDistance = await page.locator('#distance').textContent();
      await page.screenshot({ path: fallback ? '/tmp/convoy-fullscreen-mobile.png' : '/tmp/convoy-fullscreen-desktop.png' });
      await page.getByRole('button', { name: 'Свернуть игру', exact: true }).click();
      await page.clock.runFor(100);
      assert.equal(await page.locator('#fullscreen').getAttribute('aria-pressed'), 'false');
      assert.equal(await page.evaluate(() => document.fullscreenElement), null);
      assert.equal(await page.locator('canvas').evaluate(e => e.getBoundingClientRect().height), originalHeight);
      assert.equal(await page.locator('#distance').textContent(), pausedDistance, 'Resizing preserves paused race');
      await page.getByRole('button', { name: 'На весь экран', exact: true }).click();
      await page.keyboard.press('Escape'); await page.clock.runFor(100);
      assert.equal(await page.locator('#fullscreen').getAttribute('aria-pressed'), 'false', 'Escape exits fullscreen');
      assert.equal(await page.locator('#distance').textContent(), pausedDistance, 'Escape exit does not resume a paused race');
      if (fallback) {
        await page.setViewportSize({ width: 320, height: 760 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Toolbar fits a small phone');
      }
      await page.close();
      console.log(`PASS: ${fallback ? 'mobile window fallback' : 'native fullscreen'}, canvas resize, controls, button/Escape exit and preserved race.`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
