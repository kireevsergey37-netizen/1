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
      let frames = 0;
      ConvoyRenderer.prototype.draw = function (state) {
        window.observed = JSON.parse(JSON.stringify({ player: state.player, cars: state.cars, objects: state.objects, gate: state.gate }));
        // Keep every physics frame. Render every sixth frame for software GPU tests.
        if (window.renderEveryFrame || ++frames % 6 === 0) return draw.call(this, state);
      };
    });
    await page.clock.runFor(100);
    return page;
  }
  async function screenshot(page, path) {
    await page.evaluate(() => { window.renderEveryFrame = true; });
    await page.clock.runFor(100);
    await page.screenshot({ path, fullPage: true });
    await page.evaluate(() => { window.renderEveryFrame = false; });
  }
  try {
    const page = await open();
    assert(await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl');
      return !!gl && gl.isEnabled(gl.DEPTH_TEST) && gl.getError() === gl.NO_ERROR;
    }), 'WebGL renderer uses depth testing without errors');
    await page.getByRole('button', { name: 'На старт!' }).click();
    assert(await page.locator('#boost').isDisabled(), 'No boost before a bonus collision');
    await page.keyboard.press('Space'); await page.keyboard.down('w');
    await page.clock.runFor(3000); await page.keyboard.up('w');
    const cruising = Number(await page.locator('#speed').textContent());
    assert(cruising >= 135 && cruising <= 138, 'Empty boost keys leave the normal cruise speed');
    assert.equal((await page.evaluate(() => observed.player.boost)), 0);
    assert.equal(await page.locator('#score').textContent(), '0');
    await screenshot(page, '/tmp/convoy-v4-trucks.png');
    await page.clock.runFor(1500);
    assert.equal(await page.locator('#score').textContent(), '100', 'Bonus character scores +100');
    assert(!(await page.locator('#boost').isDisabled()), 'Character collision grants a charge');
    await page.keyboard.press('Space'); await page.clock.runFor(600);
    assert(Number(await page.locator('#speed').textContent()) >= 210, 'Charge enables temporary acceleration');
    assert(await page.locator('#boost').isDisabled(), 'Charge is consumed immediately');
    await page.keyboard.down('d'); await page.clock.runFor(380); await page.keyboard.up('d');
    assert((await page.evaluate(() => observed.player.x)) > 550, 'Steering moves right');
    await page.clock.runFor(1650);
    assert.equal((await page.evaluate(() => observed.player.boost)), 0, 'Boost ends after 2.2 seconds');
    assert(await page.locator('#boost').isDisabled(), 'Waiting does not replenish the charge');
    await page.keyboard.down('s'); await page.clock.runFor(2500); await page.keyboard.up('s');
    assert.equal(await page.locator('#speed').textContent(), '0', 'Brake stops the car');
    await page.keyboard.press('p');
    const paused = await page.locator('#distance').textContent();
    await page.clock.runFor(1000);
    assert.equal(await page.locator('#distance').textContent(), paused, 'Pause freezes racing');
    await page.keyboard.press('Escape'); await page.clock.runFor(150);
    assert(await page.locator('#boost').isDisabled(), 'Pausing does not replenish a charge');
    await page.close();
    console.log('PASS: WebGL, bonus-only boost, empty keys, 2.2s expiry, steering, braking and pause.');

    const ram = await open();
    await ram.getByRole('button', { name: 'На старт!' }).click();
    await ram.keyboard.down('a'); await ram.clock.runFor(650); await ram.keyboard.up('a');
    assert(Number(await ram.locator('#score').textContent()) >= 50, 'Ramming awards points');
    assert(Number((await ram.locator('#hull').textContent()).replace('%', '')) < 100, 'Ramming damages the car');
    assert(await ram.locator('#boost').isDisabled(), 'Ramming does not grant acceleration');
    await ram.close(); console.log('PASS: ramming gives points and damage, without a boost.');

    const race = await open();
    await race.getByRole('button', { name: 'На старт!' }).click();
    let held = null, sawGate = false, sawOuter = false, sawInner = false;
    for (let i = 0; i < 200 && !(await race.locator('#overlay').isVisible()); i++) {
      const state = await race.evaluate(() => observed);
      if (state.player.boostReady && state.player.boost === 0 && state.player.d < 1280) await race.keyboard.press('Space');
      const upcoming = state.objects.filter(o => !o.taken && o.kind !== 'person' && o.d > state.player.d - 5 && o.d < state.player.d + 65);
      const candidates = [295, 385, 480, 575, 665].filter(x => upcoming.every(o => Math.abs(o.x-x) > (o.kind === 'barrier' ? 75 : 50)));
      const target = candidates.sort((a,b) => Math.abs(a-state.player.x)-Math.abs(b-state.player.x))[0] ?? 480;
      const desired = state.player.d >= 1280 || Math.abs(target-state.player.x) < 15 ? null : target > state.player.x ? 'd' : 'a';
      if (held !== desired) { if (held) await race.keyboard.up(held); if (desired) await race.keyboard.down(desired); held = desired; }
      await race.clock.runFor(350);
      const after = await race.evaluate(() => observed);
      if (!sawGate && after.player.d > 1270) { await screenshot(race, '/tmp/convoy-v4-colony.png'); sawGate = true; }
      if (!sawOuter && after.player.d > 1340) {
        assert.equal(after.gate.owner, 'blue', 'Only the sluice owner enters');
        assert(Math.abs(after.player.x-480) < 1, `Truck aligns with the gate: x=${after.player.x}, d=${after.player.d}, speed=${after.player.speed}`);
        assert.equal(after.player.finishTime, null, 'Outer gate is not the finish');
        assert(after.player.speed <= 12, 'Sluice speed is reduced');
        await screenshot(race, '/tmp/convoy-v4-sluice.png'); sawOuter = true;
      }
      if (!sawInner && after.player.d > 1380 && after.player.d < 1400) {
        assert.equal(after.player.finishTime, null, 'Truck traverses the second gate before finishing'); sawInner = true;
      }
    }
    assert(sawGate && sawOuter && sawInner, 'Both gates and colony approach were traversed');
    assert(await race.locator('#overlay').isVisible(), 'Full race completes');
    const final = await race.evaluate(() => observed);
    assert.equal(final.player.d, 1400, 'Finish is inside the colony');
    assert(final.player.finishTime > 0 && final.player.hull > 0);
    assert((await race.locator('#overlay-description').textContent()).includes('заехал через шлюз'));
    assert.equal(await race.locator('#progress-fill').evaluate(e => e.style.width), '100%');
    const record = Number(await race.locator('#best').textContent()); assert(record >= 250);
    await race.getByRole('button', { name: 'Ещё один заезд' }).click();
    assert.equal(await race.locator('#speed').textContent(), '0'); assert.equal(await race.locator('#hull').textContent(), '100%');
    assert(await race.locator('#boost').isDisabled(), 'Replay resets bonus charge');
    await race.reload(); assert.equal(Number(await race.locator('#best').textContent()), record);
    await race.close(); console.log('PASS: full race, alignment, two-stage sluice entry, finish, replay and record.');

    const queued = await open();
    await queued.getByRole('button', { name: 'На старт!' }).click();
    await queued.keyboard.down('s'); await queued.clock.runFor(5000); await queued.keyboard.up('s');
    let queueSteer = null, waited = false, sawHandoff = false;
    for (let i = 0; i < 210 && !(await queued.locator('#overlay').isVisible()); i++) {
      const state = await queued.evaluate(() => observed);
      const obstacles = state.objects.filter(o => !o.taken && o.kind !== 'person' && o.d > state.player.d - 5 && o.d < state.player.d + 65);
      const target = [295, 385, 480, 575, 665].filter(x => obstacles.every(o => Math.abs(o.x-x) > (o.kind === 'barrier' ? 75 : 50))).sort((a,b) => Math.abs(a-state.player.x)-Math.abs(b-state.player.x))[0] ?? 480;
      const steer = state.player.d >= 1280 || Math.abs(target-state.player.x) < 15 ? null : target > state.player.x ? 'd' : 'a';
      if (queueSteer !== steer) { if (queueSteer) await queued.keyboard.up(queueSteer); if (steer) await queued.keyboard.down(steer); queueSteer = steer; }
      if (state.player.d >= 1320 && state.gate.owner !== 'blue') {
        assert(state.player.d < 1330, 'Queued truck stays outside the outer gate');
        assert.equal(state.player.finishTime, null); waited = true;
      }
      if (state.player.d > 1340) {
        assert.equal(state.gate.owner, 'blue', 'Gate ownership transfers before player entry');
        assert(state.cars.some(c => !c.isPlayer && c.finishTime !== null), 'Earlier arrivals finish first');
        sawHandoff = true;
      }
      await queued.clock.runFor(350);
    }
    const queuedFinal = await queued.evaluate(() => observed);
    assert(waited && sawHandoff && queuedFinal.player.finishTime > 0, 'Queued player waits and then finishes');
    assert(queuedFinal.cars.filter(c => !c.isPlayer && c.finishTime !== null).every(c => Math.abs(c.x-480) > 52), 'Finished opponents park clear of the gate lane');
    await screenshot(queued, '/tmp/convoy-v4-queued-finish.png');
    await queued.close(); console.log('PASS: sluice queue, owner transfer, honest finish order and clear parking.');

    const mobile = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await mobile.getByRole('button', { name: 'На старт!' }).tap();
    assert(await mobile.locator('#mobile-boost').isDisabled());
    await mobile.clock.runFor(4500);
    assert(!(await mobile.locator('#mobile-boost').isDisabled()), 'Mobile charge comes from the same bonus collision');
    const left = await mobile.locator('#left').boundingBox(), boost = await mobile.locator('#mobile-boost').boundingBox();
    const session = await mobile.context().newCDPSession(mobile);
    const one = { x: left.x+left.width/2, y: left.y+left.height/2, id: 1 }, two = { x: boost.x+boost.width/2, y: boost.y+boost.height/2, id: 2 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [one] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [one,two] });
    await mobile.clock.runFor(350);
    assert((await mobile.evaluate(() => observed.player.x)) < 435, 'Touch steering works');
    assert((await mobile.evaluate(() => observed.player.boost)) > 0, 'Second finger activates the bonus boost');
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.clock.runFor(250);
    const releasedX = await mobile.evaluate(() => observed.player.x);
    await mobile.clock.runFor(150);
    assert.equal(await mobile.evaluate(() => observed.player.x), releasedX, 'Releasing touch releases steering');
    const brake = await mobile.locator('#mobile-brake').boundingBox();
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: brake.x+brake.width/2, y: brake.y+brake.height/2, id: 3 }] });
    await mobile.clock.runFor(1300);
    assert.equal(await mobile.locator('#speed').textContent(), '0', 'Touch brake stops the truck');
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.clock.runFor(100);
    assert(!(await mobile.locator('#mobile-brake').evaluate(e => e.classList.contains('pressed'))), 'Releasing touch releases the brake');
    await screenshot(mobile, '/tmp/convoy-v4-mobile.png');
    await mobile.setViewportSize({ width: 320, height: 760 });
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Small mobile layout fits');
    await mobile.close();
    assert.deepEqual(errors, [], 'No browser exceptions');
    console.log('PASS: mobile two-finger steering + bonus boost, release, braking and 320px layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
