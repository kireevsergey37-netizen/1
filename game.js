(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('game');
  let renderer;
  try { renderer = new ConvoyRenderer(canvas); } catch (error) {
    $('overlay-title').textContent = '3D пока недоступно';
    $('overlay-description').textContent = error.message + ' Включи аппаратное ускорение или попробуй другой браузер.';
    $('start').disabled = true; return;
  }
  const ROAD_LEFT = 225, ROAD_RIGHT = 735;
  const FINISH = 1400, BOOST_COOLDOWN = 5;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const keys = new Set(), steeringPointers = new Map(), throttlePointers = new Map();
  let mode = 'idle', cars = [], objects = [], particles = [], messages = [];
  let elapsed = 0, score = 0, player, lastFrame = 0, visualTime = 0, camera = 0;
  let pointer = null, activePointer = null, best = 0, lastHud = '', hitCount = 0;
  let pairCooldowns = new Map(), steerValue = 0, throttleLatch = false;
  try { best = Number(localStorage.getItem('convoy-cup-best')) || 0; } catch {}
  $('best').textContent = best;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const random = (min, max) => min + Math.random() * (max - min);


  function reset() {
    player = { id: 'blue', name: 'Синий конвой', color: '#4298ff', x: 480, d: 0, speed: 0, hull: 100, penalty: 0, hitCooldown: 0, boost: 0, cooldown: 0, finishTime: null, isPlayer: true };
    cars = [player,
      { id: 'red', name: 'Красный конвой', color: '#ff6479', x: 345, targetX: 345, d: -4, speed: 0, boost: 0, cruise: 36.5, hull: 100, penalty: 0, hitCooldown: 0, finishTime: null },
      { id: 'yellow', name: 'Жёлтый конвой', color: '#ffd55c', x: 615, targetX: 615, d: -8, speed: 0, boost: 0, cruise: 38, hull: 100, penalty: 0, hitCooldown: 0, finishTime: null }];
    objects = []; particles = []; messages = []; pairCooldowns = new Map();
    elapsed = score = camera = hitCount = 0; keys.clear(); steeringPointers.clear(); throttlePointers.clear(); throttleLatch = false; pointer = null; activePointer = null;
    objects.push({ kind: 'person', x: 480, d: 95, taken: false });
    objects.push({ kind: 'barrier', x: 480, d: 210, taken: false });
    const lanes = [295, 385, 480, 575, 665];
    for (let d = 270; d < FINISH - 110; d += 65) {
      const lane = Math.floor(random(0, lanes.length));
      objects.push({ kind: Math.floor(d / 65) % 3 === 0 ? 'barrier' : 'person', x: lanes[lane], d, taken: false });
      if (Math.floor(d / 65) % 2 === 0) objects.push({ kind: 'cone', x: lanes[(lane + 2) % lanes.length], d: d + 15, taken: false });
    }
    lastHud = ''; updateHud();
  }
  function burst(x, d, color, count = 16) {
    if (reducedMotion) return;
    for (let i = 0; i < count; i++) {
      const angle = random(0, Math.PI * 2), speed = random(20, 90);
      particles.push({ x, d, vx: Math.cos(angle) * speed, vd: Math.sin(angle) * speed / 2.5, life: .65, color });
    }
  }
  function popup(text, x, d, color = '#83f5da') { messages.push({ text, x, d, life: 1.1, color }); }
  function showOverlay(kicker, title, description, button, hint) {
    $('overlay-kicker').textContent = kicker; $('overlay-title').textContent = title;
    $('overlay-description').textContent = description;
    $('start').innerHTML = `${button} <span aria-hidden="true">→</span>`;
    $('overlay-hint').textContent = hint; $('overlay').hidden = false;
    $('start').focus({ preventScroll: true });
  }
  function start() {
    if (mode !== 'paused') reset();
    mode = 'playing'; $('overlay').hidden = true; $('touch-controls').hidden = false;
    $('pause').disabled = false; $('pause').setAttribute('aria-label', 'Пауза');
    $('pause').innerHTML = '<span class="pause-symbol" aria-hidden="true"></span>';
    canvas.focus({ preventScroll: true }); $('announcement').textContent = 'Гонка началась. Ты управляешь синей машиной.';
    updateHud();
  }
  function pause() {
    if (mode === 'paused') return start();
    if (mode !== 'playing') return;
    mode = 'paused'; keys.clear(); steeringPointers.clear(); throttlePointers.clear(); throttleLatch = false; pointer = null; activePointer = null;
    $('touch-controls').hidden = true;
    $('pause').setAttribute('aria-label', 'Продолжить'); $('pause').textContent = '▶';
    showOverlay('ПИТ-СТОП', 'Гонка на паузе', 'Машины, соперники и трибуны подождут. Продолжай, когда будешь готов.', 'Продолжить', 'P или Esc — вернуться на трассу.');
    updateHud();
  }
  function raceOrder() {
    return [...cars].sort((a, b) => {
      if (a.finishTime !== null && b.finishTime !== null) return a.finishTime - b.finishTime;
      if (a.finishTime !== null) return -1;
      if (b.finishTime !== null) return 1;
      return b.d - a.d;
    });
  }
  function finish(wrecked = false) {
    mode = 'over'; keys.clear(); steeringPointers.clear(); throttlePointers.clear(); throttleLatch = false; pointer = null; activePointer = null;
    $('touch-controls').hidden = true; $('pause').disabled = true;
    const place = raceOrder().findIndex(car => car.isPlayer) + 1;
    if (!wrecked) score += [1000, 500, 250][place - 1];
    if (score > best) { best = score; try { localStorage.setItem('convoy-cup-best', String(best)); } catch {} }
    $('best').textContent = best;
    const title = wrecked ? 'Конвою нужен ремонт' : place === 1 ? 'Первым у ворот!' : `${place}-е место. Финиш!`;
    const description = wrecked ? `Кузов не выдержал столкновений. Ты проехал ${Math.floor(player.d)} м и набрал ${score} очков. Объезжай препятствия и попробуй снова.` : `Исправительная колония достигнута за ${player.finishTime.toFixed(1)} сек. Твой результат: ${score} очков, бонусных фигурок: ${hitCount}.`;
    const finished = raceOrder().filter(car => car.finishTime !== null).map(car => car.name.replace(' конвой', '')).join(' → ');
    const pending = cars.filter(car => car.finishTime === null).map(car => car.name.replace(' конвой', '').toLowerCase()).join(', ');
    const hint = wrecked ? 'Забор тоже повреждает машину.' : `Финишировали: ${finished}.${pending ? ` Ещё на трассе: ${pending}.` : ''}`;
    showOverlay(wrecked ? 'СХОД С ДИСТАНЦИИ' : 'КОНВОЙНЫЙ КУБОК / РЕЗУЛЬТАТ', title, description, 'Ещё один заезд', hint);
    $('announcement').textContent = `${title}. Очки: ${score}.`; updateHud();
  }
  function boost() {
    if (mode !== 'playing' || player.cooldown > 0) return;
    player.boost = 1.4; player.cooldown = BOOST_COOLDOWN;
    popup('ТУРБО!', player.x, player.d + 18); updateHud();
  }
  function damage(car, amount, penalty, label) {
    if (car.hitCooldown > 0) return false;
    car.hull = Math.max(0, car.hull - amount); car.penalty = Math.max(car.penalty, penalty); car.hitCooldown = .9;
    burst(car.x, car.d, '#ffcf6b');
    if (car.isPlayer && label) popup(label, car.x, car.d + 20, '#ffac87');
    if (!car.isPlayer && car.hull <= 0) { car.hull = 55; car.penalty = 3; }
    return true;
  }
  function update(dt) {
    elapsed += dt; player.cooldown = Math.max(0, player.cooldown - dt); player.boost = Math.max(0, player.boost - dt);
    let steer = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    if (!steer && steeringPointers.size) steer = [...steeringPointers.values()].reduce((sum, value) => sum + value, 0);
    if (!steer && pointer !== null) steer = clamp((pointer - player.x) / 45, -1, 1);
    steerValue = clamp(steer, -1, 1);
    player.yaw = -steerValue * .12;
    player.x += steerValue * (185 + Math.min(player.speed, 60) * 1.3) * dt;
    if (player.x < ROAD_LEFT + 29 || player.x > ROAD_RIGHT - 29) {
      player.x = clamp(player.x, ROAD_LEFT + 29, ROAD_RIGHT - 29); damage(player, 5, .5, 'ЗАБОР −5%');
    }
    for (const car of cars) {
      car.penalty = Math.max(0, car.penalty - dt); car.hitCooldown = Math.max(0, car.hitCooldown - dt);
      if (car.finishTime !== null) { car.speed = 0; continue; }
      let targetSpeed, acceleration = 10;
      const pedalValues = [...throttlePointers.values()];
      if (car.isPlayer) {
        const braking = keys.has('KeyS') || keys.has('ArrowDown') || pedalValues.includes(-1);
        const accelerating = keys.has('KeyW') || keys.has('ArrowUp') || pedalValues.includes(1) || throttleLatch;
        targetSpeed = braking ? 0 : accelerating ? 60 : 28;
        acceleration = braking ? 42 : accelerating ? 14 : 10;
        if (car.boost > 0 && !braking) { targetSpeed += 22; acceleration = 34; }
        $('gas').classList.toggle('pressed', accelerating && !braking);
        $('mobile-gas').classList.toggle('pressed', accelerating && !braking);
        $('mobile-brake').classList.toggle('pressed', braking);
      } else {
        car.boost = elapsed > 5 && (elapsed + (car.id === 'red' ? 0 : 4)) % 12 < 1.7 ? 1 : 0;
        targetSpeed = car.cruise + Math.sin(elapsed * .55) * 3 + (car.boost > 0 ? 13 : 0);
        const obstacle = objects.find(o => !o.taken && o.kind !== 'person' && o.d > car.d && o.d - car.d < 65 && Math.abs(o.x - car.x) < 60);
        if (obstacle) car.targetX = obstacle.x > 480 ? obstacle.x - 115 : obstacle.x + 115;
        else car.targetX += Math.sin(elapsed * .75 + (car.id === 'red' ? 0 : 2)) * dt * 16;
        car.targetX = clamp(car.targetX, ROAD_LEFT + 50, ROAD_RIGHT - 50);
        car.yaw = -clamp((car.targetX-car.x)/80, -.13, .13);
        car.x += clamp(car.targetX - car.x, -100 * dt, 100 * dt);
        if (car.hull < 40) targetSpeed -= 4;
      }
      if (car.penalty > 0) targetSpeed *= .48;
      const deceleration = car.penalty > 0 ? 52 : car.isPlayer && targetSpeed === 28 ? 5 : 30;
      car.speed += clamp(targetSpeed - car.speed, -deceleration * dt, acceleration * dt);
      const oldDistance = car.d; car.d += car.speed * dt;
      if (car.d >= FINISH) { car.finishTime = elapsed - dt + (FINISH - oldDistance) / Math.max(car.speed, .01); car.d = FINISH; }
      for (const object of objects) {
        if (object.taken || Math.abs(object.d - car.d) > 6 || Math.abs(object.x - car.x) > (object.kind === 'barrier' ? 53 : 32)) continue;
        object.taken = true;
        if (object.kind === 'person') {
          burst(object.x, object.d, '#ffffff', 8);
          if (car.isPlayer) { score += 100; hitCount++; popup('+100 БОНУС', object.x, object.d + 12); }
        } else damage(car, object.kind === 'barrier' ? 16 : 8, object.kind === 'barrier' ? 1.1 : .6, object.kind === 'barrier' ? 'ПРЕГРАДА −16%' : 'КОНУС −8%');
      }
    }
    for (const [key, time] of pairCooldowns) { if (time <= dt) pairCooldowns.delete(key); else pairCooldowns.set(key, time - dt); }
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j], key = `${a.id}-${b.id}`;
      if (a.finishTime !== null || b.finishTime !== null || pairCooldowns.has(key) || Math.abs(a.d - b.d) > 10 || Math.abs(a.x - b.x) > 45) continue;
      pairCooldowns.set(key, 1.2);
      const direction = a.x <= b.x ? -1 : 1;
      a.x = clamp(a.x + direction * 24, ROAD_LEFT + 29, ROAD_RIGHT - 29);
      b.x = clamp(b.x - direction * 24, ROAD_LEFT + 29, ROAD_RIGHT - 29);
      if (!a.isPlayer) a.targetX = a.x;
      if (!b.isPlayer) b.targetX = b.x;
      damage(a, 7, .55); damage(b, 12, .8);
      if (a.isPlayer || b.isPlayer) { score += 50; popup('+50 ТАРАН', player.x, player.d + 25); }
    }
    camera = player.d;
    for (const p of particles) { p.x += p.vx * dt; p.d += p.vd * dt; p.life -= dt; }
    particles = particles.filter(p => p.life > 0);
    for (const m of messages) m.life -= dt;
    messages = messages.filter(m => m.life > 0);
    if (player.hull <= 0) finish(true); else if (player.finishTime !== null) finish(); else updateHud();
  }
  function updateHud() {
    const order = raceOrder(), place = order.findIndex(car => car.isPlayer) + 1;
    const seconds = Math.floor(elapsed), tenths = Math.floor(elapsed * 10) % 10;
    const signature = `${place}:${Math.round(player.speed * 3.6)}:${player.hull}:${score}:${seconds}:${tenths}:${Math.floor(player.d)}:${order.map(c => c.id).join()}`;
    if (signature !== lastHud) {
      $('place').innerHTML = `${place} <small>/ 3</small>`; $('speed').textContent = String(Math.round(player.speed * 3.6));
      $('hull').textContent = `${player.hull}%`; $('hull').classList.toggle('damaged', player.hull < 40);
      $('score').textContent = String(score);
      $('time').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${tenths}`;
      $('distance').textContent = `${Math.floor(Math.max(0, player.d)).toLocaleString('ru-RU')} / 1 400 М`;
      $('progress-fill').style.width = `${clamp(player.d / FINISH, 0, 1) * 100}%`;
      $('standings').innerHTML = order.map((car, i) => `<li><i class="dot car-${car.id}"></i><span>${car.name}${car.isPlayer ? ' <em>ТЫ</em>' : ''}</span><b>${car.finishTime !== null ? '✓' : i + 1}</b></li>`).join('');
      lastHud = signature;
    }
    $('gas').disabled = mode !== 'playing';
    $('mobile-gas').disabled = mode !== 'playing';
    $('mobile-brake').disabled = mode !== 'playing';
    if (mode !== 'playing') { for (const id of ['gas', 'mobile-gas', 'mobile-brake']) $(id).classList.remove('pressed'); }
    const disabled = mode !== 'playing' || player.cooldown > 0;
    $('boost').disabled = disabled; $('mobile-boost').disabled = disabled;
    $('boost-status').textContent = player.boost > 0 ? 'АКТИВНО' : player.cooldown > 0 ? `${player.cooldown.toFixed(1)} СЕК` : 'ГОТОВО';
    $('boost-fill').style.width = `${100 * (1 - player.cooldown / BOOST_COOLDOWN)}%`;
  }
  function draw() {
    renderer.draw({player, cars, objects, particles, time: visualTime, reduced: reducedMotion});
    const message = messages.at(-1);
    $('race-message').textContent = message ? message.text : '';
    $('race-message').hidden = !message;
    $('race-message').style.color = message ? message.color : '';
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(bounds.width * ratio); canvas.height = Math.round(bounds.height * ratio);
    draw();
  }
  function frame(now) {
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, .04) : 0; lastFrame = now;
    if (mode === 'playing' || mode === 'idle') visualTime += dt;
    if (mode === 'playing') update(dt);
    draw(); requestAnimationFrame(frame);
  }
  const movementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  window.addEventListener('keydown', event => {
    if (mode === 'playing' && (movementKeys.includes(event.code) || event.code === 'Space')) {
      if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return;
      event.preventDefault(); keys.add(event.code); if (event.code === 'Space' && !event.repeat) boost();
    }
    if (['KeyP', 'Escape'].includes(event.code) && !event.repeat && ['playing', 'paused'].includes(mode)) { event.preventDefault(); pause(); }
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  function setPointer(event) { const bounds = canvas.getBoundingClientRect(); pointer = clamp(player.x + ((event.clientX - bounds.left) / bounds.width - .5) * 450, ROAD_LEFT + 29, ROAD_RIGHT - 29); }
  canvas.addEventListener('pointerdown', event => { if (mode !== 'playing' || activePointer !== null) return; event.preventDefault(); activePointer = event.pointerId; canvas.setPointerCapture(event.pointerId); setPointer(event); });
  canvas.addEventListener('pointermove', event => { if (event.pointerId === activePointer) setPointer(event); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, event => { if (event.pointerId === activePointer) { pointer = null; activePointer = null; } });
  for (const [id, value] of [['left', -1], ['right', 1]]) {
    const button = $(id);
    button.addEventListener('pointerdown', event => { if (mode !== 'playing') return; event.preventDefault(); button.setPointerCapture(event.pointerId); steeringPointers.set(event.pointerId, value); });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(eventName, event => steeringPointers.delete(event.pointerId));
    button.addEventListener('click', event => { if (event.detail === 0 && !event.pointerType && mode === 'playing') player.x = clamp(player.x + value * 35, ROAD_LEFT + 29, ROAD_RIGHT - 29); });
  }
  for (const [id, value] of [['gas', 1], ['mobile-gas', 1], ['mobile-brake', -1]]) {
    const button = $(id);
    button.addEventListener('pointerdown', event => {
      if (mode !== 'playing') return;
      event.preventDefault(); button.setPointerCapture(event.pointerId); throttlePointers.set(event.pointerId, value);
    });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(eventName, event => throttlePointers.delete(event.pointerId));
    button.addEventListener('click', event => { if (event.detail === 0 && !event.pointerType && mode === 'playing' && value === 1) throttleLatch = !throttleLatch; });
  }
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); if (mode === 'playing') pause(); $('announcement').textContent = '3D-контекст потерян. Ожидаем восстановления.'; });
  canvas.addEventListener('webglcontextrestored', () => { renderer.init(); resize(); $('announcement').textContent = '3D восстановлено. Можно продолжить гонку.'; });
  window.addEventListener('blur', () => { keys.clear(); steeringPointers.clear(); throttlePointers.clear(); throttleLatch = false; if (mode === 'playing') pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'playing') pause(); });
  $('start').addEventListener('click', start); $('pause').addEventListener('click', pause);
  $('boost').addEventListener('click', boost); $('mobile-boost').addEventListener('click', boost);
  $('mobile-boost').addEventListener('pointerdown', event => { event.preventDefault(); boost(); });
  new ResizeObserver(resize).observe($('arena'));
  reset(); resize(); requestAnimationFrame(frame);
})();
