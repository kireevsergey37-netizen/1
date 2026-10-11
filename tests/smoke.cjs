// Run against a development server: node tests/smoke.cjs
// Requires Playwright and Chromium; both are available in the cloud environment.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const baseURL = process.env.GAME_URL || 'http://127.0.0.1:8001/';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  async function open(options = {}) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, ...options });
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.addInitScript(() => { let seed = 12345; Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; });
    const response = await page.goto(baseURL);
    assert.equal(response.status(), 200);
    await page.evaluate(() => {
      const draw = ConvoyRenderer.prototype.draw;
      ConvoyRenderer.prototype.draw = function (state) {
        window.observed = JSON.parse(JSON.stringify({ player: state.player, cars: state.cars, objects: state.objects }));
        return draw.call(this, state);
      };
    });
    await page.clock.runFor(20);
    return page;
  }
  try {
    const page = await open();
    assert(await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl');
      return !!gl && gl.isEnabled(gl.DEPTH_TEST) && gl.getError() === gl.NO_ERROR;
    }), 'Real WebGL renderer uses depth testing without GL errors');
    await page.getByRole('button', { name: 'На старт!' }).click();
    await page.clock.runFor(3000);
    const cruising = Number(await page.locator('#speed').textContent());
    assert(cruising >= 95 && cruising <= 105, 'Automatic cruise is about 100 km/h');
    await page.keyboard.down('w'); await page.clock.runFor(2000);
    const accelerated = Number(await page.locator('#speed').textContent());
    assert(accelerated > cruising + 70, 'Holding gas increases speed gradually');
    assert.equal(await page.locator('#score').textContent(), '100', 'Bonus character scores +100');
    await page.keyboard.down('d'); await page.clock.runFor(380); await page.keyboard.up('d');
    assert((await page.evaluate(() => observed.player.x)) > 550, 'Steering moves right');
    await page.keyboard.press('Space'); await page.clock.runFor(600);
    assert(Number(await page.locator('#speed').textContent()) > 260, 'Turbo accelerates above normal maximum');
    assert(await page.locator('#boost').isDisabled(), 'Turbo has cooldown');
    await page.keyboard.up('w'); await page.keyboard.down('s'); await page.clock.runFor(2500); await page.keyboard.up('s');
    assert.equal(await page.locator('#speed').textContent(), '0', 'Brake stops the car');
    await page.keyboard.press('p');
    const paused = await page.locator('#distance').textContent();
    await page.clock.runFor(1000);
    assert.equal(await page.locator('#distance').textContent(), paused, 'Pause freezes racing');
    await page.keyboard.press('Escape'); await page.clock.runFor(2100);
    assert(!(await page.locator('#boost').isDisabled()), 'Turbo recharges after resuming');
    await page.screenshot({ path: '/tmp/convoy-3d-driving.png', fullPage: true });
    await page.close();
    console.log('PASS: WebGL, steering, gradual acceleration, turbo, braking, bonus, pause and cooldown.');

    const ram = await open();
    await ram.getByRole('button', { name: 'На старт!' }).click();
    await ram.keyboard.down('a'); await ram.clock.runFor(650); await ram.keyboard.up('a');
    assert(Number(await ram.locator('#score').textContent()) >= 50, 'Ramming awards points');
    assert(Number((await ram.locator('#hull').textContent()).replace('%', '')) < 100, 'Ramming damages the car');
    await ram.close();
    console.log('PASS: 3D car collisions and ramming.');

    const race = await open();
    await race.getByRole('button', { name: 'На старт!' }).click();
    await race.keyboard.down('w');
    let held = null, sawGate = false;
    for (let i = 0; i < 110 && !(await race.locator('#overlay').isVisible()); i++) {
      const state = await race.evaluate(() => observed);
      const upcoming = state.objects.filter(o => !o.taken && o.kind !== 'person' && o.d > state.player.d - 5 && o.d < state.player.d + 65);
      const candidates = [295, 385, 480, 575, 665].filter(x => upcoming.every(o => Math.abs(o.x-x) > (o.kind === 'barrier' ? 75 : 50)));
      const target = candidates.sort((a,b) => Math.abs(a-state.player.x)-Math.abs(b-state.player.x))[0] ?? 480;
      const desired = Math.abs(target-state.player.x) < 15 ? null : target > state.player.x ? 'd' : 'a';
      if (held !== desired) { if (held) await race.keyboard.up(held); if (desired) await race.keyboard.down(desired); held = desired; }
      await race.clock.runFor(350);
      if (!sawGate && (await race.evaluate(() => observed.player.d)) > 1270) { await race.screenshot({ path: '/tmp/convoy-3d-gate.png', fullPage: true }); sawGate = true; }
    }
    assert(await race.locator('#overlay').isVisible(), 'Full race completes');
    assert.equal(await race.locator('#overlay-title').textContent(), 'Первым у ворот!', 'Accelerating player can win');
    assert.equal(await race.locator('#progress-fill').evaluate(e => e.style.width), '100%');
    const record = Number(await race.locator('#best').textContent()); assert(record >= 1000);
    await race.getByRole('button', { name: 'Ещё один заезд' }).click();
    assert.equal(await race.locator('#speed').textContent(), '0'); assert.equal(await race.locator('#hull').textContent(), '100%');
    await race.reload(); assert.equal(Number(await race.locator('#best').textContent()), record);
    await race.close(); console.log('PASS: full 3D race, colony finish, victory, replay and persistent record.');

    const mobile = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await mobile.getByRole('button', { name: 'На старт!' }).tap();
    await mobile.clock.runFor(100);
    const left = await mobile.locator('#left').boundingBox(), gas = await mobile.locator('#mobile-gas').boundingBox();
    const session = await mobile.context().newCDPSession(mobile);
    const one = { x: left.x+left.width/2, y: left.y+left.height/2, id: 1 }, two = { x: gas.x+gas.width/2, y: gas.y+gas.height/2, id: 2 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [one] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [one,two] });
    await mobile.clock.runFor(350);
    assert((await mobile.evaluate(() => observed.player.x)) < 435, 'Touch steering works');
    assert(await mobile.locator('#mobile-gas').evaluate(e => e.classList.contains('pressed')), 'Second finger holds gas');
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.clock.runFor(50);
    assert(!(await mobile.locator('#mobile-gas').evaluate(e => e.classList.contains('pressed'))), 'Releasing touch releases gas');
    await mobile.locator('#mobile-boost').tap(); assert(await mobile.locator('#mobile-boost').isDisabled());
    await mobile.screenshot({ path: '/tmp/convoy-3d-mobile.png', fullPage: true });
    await mobile.setViewportSize({ width: 320, height: 760 });
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Small mobile layout fits');
    await mobile.close();
    assert.deepEqual(errors, [], 'No browser exceptions');
    console.log('PASS: mobile WebGL, two-finger steering + gas, release, turbo and 320px layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
