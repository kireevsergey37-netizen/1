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
  const ROAD_LEFT = 105, ROAD_RIGHT = 855;
  const FINISH = 1400, GATE_APPROACH = 1260, GATE_ENTRY = 1340, GATE_INNER = 1380, BOOST_DURATION = 2.2, SLOW_DURATION = 3, GRAVITY = 18;
  const FINISH_BONUSES = [1000, 500, 250, 150, 100];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const keys = new Set(), steeringPointers = new Map(), brakePointers = new Set();
  let mode = 'idle', cars = [], objects = [], particles = [], messages = [];
  let elapsed = 0, score = 0, player, lastFrame = 0, visualTime = 0;
  let pointer = null, activePointer = null, best = 0, lastHud = '', hitCount = 0;
  let pairCooldowns = new Map(), steerValue = 0, gateOwner = null;
  try { best = Number(localStorage.getItem('convoy-cup-best')) || 0; } catch {}
  $('best').textContent = best;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const random = (min, max) => min + Math.random() * (max - min);


  const motionState = () => ({ height: 0, verticalSpeed: 0, airborne: false, rampLift: 0, pitch: 0, roll: 0, rollSpeed: 0, suspension: 0, suspensionSpeed: 0, sideSpeed: 0, impact: 0, jumpCount: 0 });
  function reset() {
    player = { ...motionState(), id: 'blue', name: 'Синий конвой', color: '#4298ff', x: 480, d: 0, speed: 0, hull: 100, penalty: 0, slow: 0, hitCooldown: 0, boost: 0, boostReady: false, finishTime: null, isPlayer: true };
    const opponents = [
      { id: 'red', name: 'Красный конвой', color: '#ff6479', x: 385, d: -4, parkX: 345, parkD: FINISH, phase: 0 },
      { id: 'yellow', name: 'Жёлтый конвой', color: '#ffd55c', x: 575, d: -8, parkX: 615, parkD: FINISH, phase: 2 },
      { id: 'orange', name: 'Оранжевый конвой', color: '#ff9d4d', x: 295, d: -12, parkX: 345, parkD: FINISH + 20, phase: 4 },
      { id: 'purple', name: 'Фиолетовый конвой', color: '#b58aff', x: 665, d: -16, parkX: 615, parkD: FINISH + 20, phase: 6 }
    ];
    cars = [player, ...opponents.map(car => ({ ...motionState(), ...car, targetX: car.x, speed: 0, boost: 0, boostReady: false, hull: 100, penalty: 0, slow: 0, hitCooldown: 0, finishTime: null }))];
    objects = []; particles = []; messages = []; pairCooldowns = new Map();
    elapsed = score = hitCount = 0; gateOwner = null; keys.clear(); steeringPointers.clear(); brakePointers.clear(); pointer = null; activePointer = null;
    objects.push({ kind: 'person', x: 480, d: 95, taken: false });
    objects.push({ kind: 'employee', x: 480, d: 170, taken: false });
    objects.push({ kind: 'barrier', x: 480, d: 210, taken: false });
    const lanes = [175, 330, 480, 630, 785];
    for (let d = 270; d < FINISH - 110; d += 65) {
      const lane = Math.floor(random(0, lanes.length));
      objects.push({ kind: Math.floor(d / 65) % 3 === 0 ? 'barrier' : 'person', x: lanes[lane], d, taken: false });
      if (Math.floor(d / 65) % 2 === 0) objects.push({ kind: 'cone', x: lanes[(lane + 2) % lanes.length], d: d + 15, taken: false });
      else if (d + 30 < GATE_APPROACH - 30) objects.push({ kind: 'employee', x: lanes[(lane + 1) % lanes.length], d: d + 30, taken: false });
    }
    for (const [d, x] of [[320, 480], [580, 330], [820, 630], [1040, 480], [1170, 520]]) objects.push({ kind: 'ramp', x, d, passedBy: [], taken: false });
    lastHud = ''; updateHud();
  }
  function burst(x, d, color, count = 16) {
    if (reducedMotion) return;
    for (let i = 0; i < count; i++) {
      const angle = random(0, Math.PI * 2), speed = random(20, 90);
      particles.push({ x, d, vx: Math.cos(angle) * speed, vd: Math.sin(angle) * speed / 2.5, life: .65, color });
    }
  }
  function impactBurst(x, d, strength = 1, dust = false) {
    if (reducedMotion) return;
    for (let i = 0; i < (dust ? 10 : 22); i++) {
      const life = random(.3, .75);
      particles.push({ x, d, vx: random(-110, 110) * strength, vd: random(-15, 15), y: dust ? .15 : .8, vy: random(2, 7), life, maxLife: life, kind: dust ? 'dust' : 'spark', color: dust ? '#a9a79c' : ['#ffe3a2', '#ffb451', '#fff2ce'][i % 3] });
    }
  }
  function kick(car, direction, strength = 1) {
    car.sideSpeed = clamp(car.sideSpeed + direction * 105 * strength, -170, 170);
    car.rollSpeed += direction * 1.7 * strength;
    car.suspensionSpeed = 1.3 * strength; car.impact = .65;
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
    mode = 'paused'; keys.clear(); steeringPointers.clear(); brakePointers.clear(); pointer = null; activePointer = null;
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
    mode = 'over'; keys.clear(); steeringPointers.clear(); brakePointers.clear(); pointer = null; activePointer = null;
    $('touch-controls').hidden = true; $('pause').disabled = true;
    const place = raceOrder().findIndex(car => car.isPlayer) + 1;
    if (!wrecked) score += FINISH_BONUSES[place - 1];
    if (score > best) { best = score; try { localStorage.setItem('convoy-cup-best', String(best)); } catch {} }
    $('best').textContent = best;
    const title = wrecked ? 'Автозаку нужен ремонт' : place === 1 ? 'Первым в колонии!' : `${place}-е место. Финиш!`;
    const description = wrecked ? `Кузов не выдержал столкновений. Ты проехал ${Math.floor(player.d)} м и набрал ${score} очков. Объезжай препятствия и попробуй снова.` : `Автозак заехал через шлюз в колонию за ${player.finishTime.toFixed(1)} сек. Твой результат: ${score} очков, бонусных фигурок: ${hitCount}.`;
    const finished = raceOrder().filter(car => car.finishTime !== null).map(car => car.name.replace(' конвой', '')).join(' → ');
    const pending = cars.filter(car => car.finishTime === null).map(car => car.name.replace(' конвой', '').toLowerCase()).join(', ');
    const hint = wrecked ? 'Забор тоже повреждает машину.' : `Финишировали: ${finished}.${pending ? ` Ещё на трассе: ${pending}.` : ''}`;
    showOverlay(wrecked ? 'СХОД С ДИСТАНЦИИ' : 'КОНВОЙНЫЙ КУБОК / РЕЗУЛЬТАТ', title, description, 'Ещё один заезд', hint);
    $('announcement').textContent = `${title}. Очки: ${score}.`; updateHud();
  }
  function boost() {
    if (mode !== 'playing' || !player.boostReady || player.boost > 0 || player.slow > 0 || player.d >= GATE_APPROACH) return;
    if (keys.has('KeyS') || keys.has('ArrowDown') || brakePointers.size) return;
    player.boost = BOOST_DURATION; player.boostReady = false;
    popup('РАЗГОН! 2,2 СЕК', player.x, player.d + 18); updateHud();
  }
  function damage(car, amount, penalty, label) {
    if (car.hitCooldown > 0) return false;
    car.hull = Math.max(0, car.hull - amount); car.penalty = Math.max(car.penalty, penalty); car.hitCooldown = .9;
    impactBurst(car.x, car.d); car.impact = .45; car.suspensionSpeed = .9;
    if (car.isPlayer && label) popup(label, car.x, car.d + 20, '#ffac87');
    if (!car.isPlayer && car.hull <= 0) { car.hull = 55; car.penalty = 3; }
    return true;
  }
  function update(dt) {
    elapsed += dt;
    if (!gateOwner || gateOwner.finishTime !== null) {
      gateOwner = raceOrder().find(car => car.finishTime === null && car.d >= GATE_ENTRY - 20) || null;
    }
    let steer = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    if (!steer && steeringPointers.size) steer = [...steeringPointers.values()].reduce((sum, value) => sum + value, 0);
    if (!steer && pointer !== null) steer = clamp((pointer - player.x) / 45, -1, 1);
    steerValue = player.d >= GATE_APPROACH ? 0 : clamp(steer, -1, 1);
    player.yaw = -steerValue * .12;
    player.x += steerValue * (185 + Math.min(player.speed, 60) * 1.3) * (player.airborne ? .55 : 1) * dt;
    if (player.x < ROAD_LEFT + 29 || player.x > ROAD_RIGHT - 29) {
      player.x = clamp(player.x, ROAD_LEFT + 29, ROAD_RIGHT - 29); damage(player, 5, .5, 'ЗАБОР −5%');
    }
    for (const car of cars) {
      car.impact = Math.max(0, car.impact - dt);
      car.rollSpeed += (-36 * car.roll - 8 * car.rollSpeed) * dt;
      car.roll = clamp(car.roll + car.rollSpeed * dt, -.24, .24);
      car.suspensionSpeed += (-70 * car.suspension - 11 * car.suspensionSpeed) * dt;
      car.suspension = clamp(car.suspension + car.suspensionSpeed * dt, -.2, .2);
      car.x = clamp(car.x + car.sideSpeed * dt, ROAD_LEFT + 29, ROAD_RIGHT - 29);
      car.sideSpeed *= Math.exp(-6 * dt);
      if (car.airborne) {
        car.verticalSpeed -= GRAVITY * dt; car.height += car.verticalSpeed * dt;
        car.pitch = -clamp(car.verticalSpeed * .02, -.19, .22);
        if (car.height <= 0) {
          car.height = 0; car.verticalSpeed = 0; car.airborne = false; car.pitch = 0;
          car.suspensionSpeed = -1.6; car.impact = .3;
          impactBurst(car.x, car.d, .6, true);
          if (car.isPlayer) popup('МЯГКАЯ ПОСАДКА', car.x, car.d + 18, '#b8f7e8');
        }
      } else car.pitch *= Math.exp(-8 * dt);
      car.rampLift = 0;
      car.penalty = Math.max(0, car.penalty - dt); car.slow = Math.max(0, car.slow - dt); car.hitCooldown = Math.max(0, car.hitCooldown - dt); car.boost = Math.max(0, car.boost - dt);
      if (car.finishTime !== null) {
        car.speed = car.d < car.parkD ? 8 : 0;
        car.d = Math.min(car.parkD, car.d + car.speed * dt);
        if (car.d >= car.parkD) car.x += clamp(car.parkX - car.x, -140 * dt, 140 * dt);
        continue;
      }
      let targetSpeed = 38, acceleration = 13;
      const braking = car.isPlayer && (keys.has('KeyS') || keys.has('ArrowDown') || brakePointers.size > 0);
      if (car.isPlayer) {
        if (braking) targetSpeed = 0;
        else if (car.boost > 0) { targetSpeed = 60; acceleration = 38; }
        $('mobile-brake').classList.toggle('pressed', !!braking);
      } else {
        if (car.boostReady && car.boost <= 0 && car.slow <= 0 && car.d < GATE_APPROACH) { car.boost = BOOST_DURATION; car.boostReady = false; }
        if (car.boost > 0) { targetSpeed = 60; acceleration = 38; }
        const obstacle = objects.find(o => !o.taken && o.kind !== 'person' && o.kind !== 'ramp' && o.d > car.d && o.d - car.d < 65 && Math.abs(o.x - car.x) < 60);
        if (obstacle) car.targetX = obstacle.x > car.x ? obstacle.x - 115 : obstacle.x + 115;
        else car.targetX += Math.sin(elapsed * .75 + car.phase) * dt * 16;
        car.targetX = clamp(car.targetX, ROAD_LEFT + 50, ROAD_RIGHT - 50);
        car.yaw = -clamp((car.targetX-car.x)/80, -.13, .13);
        if (car.d < GATE_APPROACH) car.x += clamp(car.targetX - car.x, -100 * dt, 100 * dt);
      }
      if (car.d >= GATE_APPROACH) {
        // Line up with the narrow vehicle gate, then drive through both doors.
        car.x += clamp(480 - car.x, -140 * dt, 140 * dt); car.yaw = 0; car.boost = 0; car.sideSpeed = 0;
        targetSpeed = car === gateOwner ? 12 : car.d < GATE_ENTRY - 18 ? 12 : 0;
      }
      if (car.slow > 0) targetSpeed = Math.min(targetSpeed, 18);
      if (car.penalty > 0) targetSpeed *= .48;
      const deceleration = braking || car.penalty > 0 || car.slow > 0 ? 52 : 38;
      car.speed += clamp(targetSpeed - car.speed, -deceleration * dt, acceleration * dt);
      const oldDistance = car.d; car.d += car.speed * dt;
      if (car.d >= GATE_APPROACH && car !== gateOwner) {
        const queue = raceOrder().filter(other => other.finishTime === null && other !== gateOwner);
        const queuePosition = Math.max(0, queue.findIndex(other => other === car));
        const stopAt = GATE_ENTRY - 16 - queuePosition * 15;
        if (car.d > stopAt) { car.d = Math.max(oldDistance, stopAt); car.speed = 0; }
      }
      if (car.d >= FINISH) { car.finishTime = elapsed - dt + (FINISH - oldDistance) / Math.max(car.speed, .01); car.d = FINISH; }
      for (const object of objects) {
        if (object.kind === 'ramp') {
          if (!car.airborne && Math.abs(object.x - car.x) < 50 && !object.passedBy.includes(car.id)) {
            if (car.d >= object.d - 15 && car.d < object.d) {
              car.rampLift = (car.d - object.d + 15) / 15 * 1.1; car.pitch = -.12;
            }
            if (oldDistance < object.d && car.d >= object.d) {
              object.passedBy.push(car.id); car.height = 1.1;
              car.verticalSpeed = 4 + car.speed * .12; car.airborne = true;
              car.pitch = -.2; car.jumpCount++;
              if (car.isPlayer) { popup('ПРЫЖОК!', car.x, car.d + 18, '#b3fff0'); $('announcement').textContent = 'Прыжок с трамплина! Автозак светится в воздухе.'; }
            }
          }
          continue;
        }
        if (car.height > 1.3) continue;
        if (object.taken || Math.abs(object.d - car.d) > 6 || Math.abs(object.x - car.x) > (object.kind === 'barrier' ? 53 : 32)) continue;
        object.taken = true;
        if (object.kind === 'person') {
          burst(object.x, object.d, '#ffffff', 8);
          car.boostReady = true;
          if (car.isPlayer) { score += 100; hitCount++; popup('+100 · РАЗГОН ГОТОВ', object.x, object.d + 12); $('announcement').textContent = 'Разгон получен. Нажми W, стрелку вверх или пробел.'; }
        } else if (object.kind === 'employee') {
          car.slow = SLOW_DURATION; car.boost = 0; car.speed = Math.min(car.speed, 18);
          burst(object.x, object.d, '#86b9ff', 8);
          if (car.isPlayer) {
            popup('СОТРУДНИК · ЗАМЕДЛЕНИЕ 3 СЕК', object.x, object.d + 12, '#a6cbff');
            $('announcement').textContent = 'Сбит сотрудник. Замедление на три секунды. Разгон временно недоступен.';
          }
        } else damage(car, object.kind === 'barrier' ? 16 : 8, object.kind === 'barrier' ? 1.1 : .6, object.kind === 'barrier' ? 'ПРЕГРАДА −16%' : 'КОНУС −8%');
      }
    }
    for (const [key, time] of pairCooldowns) { if (time <= dt) pairCooldowns.delete(key); else pairCooldowns.set(key, time - dt); }
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j], key = `${a.id}-${b.id}`;
      if (a.finishTime !== null || b.finishTime !== null || Math.abs(a.height - b.height) > 1.4 || pairCooldowns.has(key) || a.d >= GATE_APPROACH || b.d >= GATE_APPROACH || Math.abs(a.d - b.d) > 13 || Math.abs(a.x - b.x) > 52) continue;
      pairCooldowns.set(key, 1.2);
      const direction = a.x <= b.x ? -1 : 1;
      const separation = (54 - Math.abs(a.x - b.x)) / 2 + 2;
      a.x = clamp(a.x + direction * separation, ROAD_LEFT + 29, ROAD_RIGHT - 29);
      b.x = clamp(b.x - direction * separation, ROAD_LEFT + 29, ROAD_RIGHT - 29);
      const strength = clamp(.6 + Math.abs(a.speed - b.speed) / 45, .6, 1.2);
      kick(a, direction, strength); kick(b, -direction, strength);
      impactBurst((a.x + b.x) / 2, (a.d + b.d) / 2, strength);
      if (!a.isPlayer) a.targetX = a.x;
      if (!b.isPlayer) b.targetX = b.x;
      damage(a, 7, .55); damage(b, 12, .8);
      if (a.isPlayer || b.isPlayer) { score += 50; popup('+50 ТАРАН', player.x, player.d + 25); }
    }
    for (const p of particles) { p.x += p.vx * dt; p.d += p.vd * dt; p.life -= dt; if (p.y !== undefined) { p.vy -= 14 * dt; p.y = Math.max(.05, p.y + p.vy * dt); } }
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
      $('place').innerHTML = `${place} <small>/ ${cars.length}</small>`; $('speed').textContent = String(Math.round(player.speed * 3.6));
      $('hull').textContent = `${player.hull}%`; $('hull').classList.toggle('damaged', player.hull < 40);
      $('score').textContent = String(score);
      $('time').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${tenths}`;
      $('distance').textContent = `${Math.floor(Math.max(0, player.d)).toLocaleString('ru-RU')} / 1 400 М`;
      $('progress-fill').style.width = `${clamp(player.d / FINISH, 0, 1) * 100}%`;
      $('standings').innerHTML = order.map((car, i) => `<li><i class="dot car-${car.id}"></i><span>${car.name}${car.isPlayer ? ' <em>ТЫ</em>' : ''}</span><b>${car.finishTime !== null ? '✓' : i + 1}</b></li>`).join('');
      lastHud = signature;
    }
    $('touch-controls').hidden = mode !== 'playing' || player.d >= GATE_APPROACH;
    $('mobile-brake').disabled = mode !== 'playing' || player.d >= GATE_APPROACH;
    if (mode !== 'playing') $('mobile-brake').classList.remove('pressed');
    const disabled = mode !== 'playing' || !player.boostReady || player.boost > 0 || player.slow > 0 || player.d >= GATE_APPROACH;
    $('boost').disabled = disabled; $('mobile-boost').disabled = disabled;
    $('boost-status').textContent = player.d >= GATE_APPROACH ? 'ВЪЕЗД В ШЛЮЗ' : player.slow > 0 ? `ЗАМЕДЛЕН ${player.slow.toFixed(1)} СЕК` : player.boost > 0 ? `${player.boost.toFixed(1)} СЕК` : player.boostReady ? 'ГОТОВ' : 'СБЕЙ ФИГУРКУ';
    $('boost-fill').style.width = `${player.boost > 0 ? 100 * player.boost / BOOST_DURATION : player.boostReady ? 100 : 0}%`;
    $('arena').classList.toggle('slowed', player.slow > 0);
    $('arena').classList.toggle('jumping', player.airborne);
    $('arena').classList.toggle('impact', player.impact > .35 && !reducedMotion);
    $('drive-hint').textContent = player.d >= GATE_APPROACH ? (player === gateOwner ? 'ШЛЮЗ · ВЪЕЗЖАЕМ В КОЛОНИЮ' : 'КПП · ОЖИДАЕМ СВОБОДНЫЙ ШЛЮЗ') : player.airborne ? 'ПРЫЖОК · ЦВЕТНОЕ СВЕЧЕНИЕ' : player.slow > 0 ? `СОТРУДНИК · ЗАМЕДЛЕНИЕ ${player.slow.toFixed(1)} СЕК` : player.boostReady ? 'W / ↑ / SPACE — РАЗГОН НА 2,2 СЕК' : 'ЧЁРНЫЕ → РАЗГОН · СИНИЕ → ЗАМЕДЛЕНИЕ';
  }

  function draw() {
    renderer.draw({player, cars, objects, particles, gate: {owner: gateOwner ? gateOwner.id : null, distance: gateOwner ? gateOwner.d : GATE_APPROACH, entry: GATE_ENTRY, inner: GATE_INNER}, time: visualTime, reduced: reducedMotion, road: {left: ROAD_LEFT, right: ROAD_RIGHT}});
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
      event.preventDefault(); keys.add(event.code); if (['Space', 'KeyW', 'ArrowUp'].includes(event.code) && !event.repeat) boost();
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
  const brakeButton = $('mobile-brake');
  brakeButton.addEventListener('pointerdown', event => {
    if (mode !== 'playing') return;
    event.preventDefault(); brakeButton.setPointerCapture(event.pointerId); brakePointers.add(event.pointerId);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) brakeButton.addEventListener(name, event => brakePointers.delete(event.pointerId));
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); if (mode === 'playing') pause(); $('announcement').textContent = '3D-контекст потерян. Ожидаем восстановления.'; });
  canvas.addEventListener('webglcontextrestored', () => { renderer.init(); resize(); $('announcement').textContent = '3D восстановлено. Можно продолжить гонку.'; });
  window.addEventListener('blur', () => { keys.clear(); steeringPointers.clear(); brakePointers.clear(); if (mode === 'playing') pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'playing') pause(); });
  $('start').addEventListener('click', start); $('pause').addEventListener('click', pause);
  $('boost').addEventListener('click', boost); $('mobile-boost').addEventListener('click', boost);
  $('mobile-boost').addEventListener('pointerdown', event => { event.preventDefault(); boost(); });
  new ResizeObserver(resize).observe($('arena'));
  reset(); resize(); requestAnimationFrame(frame);
})();
