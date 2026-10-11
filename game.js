(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const W = 960, H = 600, ROAD_LEFT = 225, ROAD_RIGHT = 735;
  const FINISH = 1400, SCALE = 2.5, PLAYER_Y = 454, BOOST_COOLDOWN = 5;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const keys = new Set(), steeringPointers = new Map();
  let mode = 'idle', cars = [], objects = [], particles = [], messages = [];
  let elapsed = 0, score = 0, player, lastFrame = 0, visualTime = 0, camera = 0;
  let pointer = null, activePointer = null, best = 0, lastHud = '', hitCount = 0;
  let pairCooldowns = new Map();
  try { best = Number(localStorage.getItem('convoy-cup-best')) || 0; } catch {}
  $('best').textContent = best;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const random = (min, max) => min + Math.random() * (max - min);
  const screenY = d => PLAYER_Y - (d - camera) * SCALE;

  function reset() {
    player = { id: 'blue', name: 'Синий конвой', color: '#4298ff', x: 480, d: 0, speed: 0, hull: 100, penalty: 0, hitCooldown: 0, boost: 0, cooldown: 0, finishTime: null, isPlayer: true };
    cars = [player,
      { id: 'red', name: 'Красный конвой', color: '#ff6479', x: 345, targetX: 345, d: -4, speed: 0, cruise: 35.7, hull: 100, penalty: 0, hitCooldown: 0, finishTime: null },
      { id: 'yellow', name: 'Жёлтый конвой', color: '#ffd55c', x: 615, targetX: 615, d: -8, speed: 0, cruise: 36.6, hull: 100, penalty: 0, hitCooldown: 0, finishTime: null }];
    objects = []; particles = []; messages = []; pairCooldowns = new Map();
    elapsed = score = camera = hitCount = 0; keys.clear(); steeringPointers.clear(); pointer = null; activePointer = null;
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
      particles.push({ x, d, vx: Math.cos(angle) * speed, vd: Math.sin(angle) * speed / SCALE, life: .65, color });
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
    mode = 'paused'; keys.clear(); steeringPointers.clear(); pointer = null; activePointer = null;
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
    mode = 'over'; keys.clear(); steeringPointers.clear(); pointer = null; activePointer = null;
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
    player.x += clamp(steer, -1, 1) * 260 * dt;
    if (player.x < ROAD_LEFT + 29 || player.x > ROAD_RIGHT - 29) {
      player.x = clamp(player.x, ROAD_LEFT + 29, ROAD_RIGHT - 29); damage(player, 5, .5, 'ЗАБОР −5%');
    }
    for (const car of cars) {
      car.penalty = Math.max(0, car.penalty - dt); car.hitCooldown = Math.max(0, car.hitCooldown - dt);
      if (car.finishTime !== null) { car.speed = 0; continue; }
      let targetSpeed;
      if (car.isPlayer) {
        targetSpeed = keys.has('KeyS') || keys.has('ArrowDown') ? 20 : keys.has('KeyW') || keys.has('ArrowUp') ? 43 : 36;
        if (car.boost > 0) targetSpeed += 19;
      } else {
        targetSpeed = car.cruise;
        const obstacle = objects.find(o => !o.taken && o.kind !== 'person' && o.d > car.d && o.d - car.d < 65 && Math.abs(o.x - car.x) < 60);
        if (obstacle) car.targetX = obstacle.x > 480 ? obstacle.x - 115 : obstacle.x + 115;
        else car.targetX += Math.sin(elapsed * .75 + (car.id === 'red' ? 0 : 2)) * dt * 16;
        car.targetX = clamp(car.targetX, ROAD_LEFT + 50, ROAD_RIGHT - 50);
        car.x += clamp(car.targetX - car.x, -100 * dt, 100 * dt);
        if (car.hull < 40) targetSpeed -= 4;
      }
      if (car.penalty > 0) targetSpeed *= .48;
      car.speed += (targetSpeed - car.speed) * Math.min(1, dt * 3);
      const oldDistance = car.d; car.d += car.speed * dt;
      if (car.d >= FINISH) { car.finishTime = elapsed - dt + (FINISH - oldDistance) / Math.max(car.speed, .01); car.d = FINISH; }
      for (const object of objects) {
        if (object.taken || Math.abs(object.d - car.d) > 16 || Math.abs(object.x - car.x) > (object.kind === 'barrier' ? 53 : 32)) continue;
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
      if (a.finishTime !== null || b.finishTime !== null || pairCooldowns.has(key) || Math.abs(a.d - b.d) > 27 || Math.abs(a.x - b.x) > 45) continue;
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
    const disabled = mode !== 'playing' || player.cooldown > 0;
    $('boost').disabled = disabled; $('mobile-boost').disabled = disabled;
    $('boost-status').textContent = player.boost > 0 ? 'АКТИВНО' : player.cooldown > 0 ? `${player.cooldown.toFixed(1)} СЕК` : 'ГОТОВО';
    $('boost-fill').style.width = `${100 * (1 - player.cooldown / BOOST_COOLDOWN)}%`;
  }
  function person(x, y, scale = 1, uniform = '#161b25', spectator = false, variant = 0) {
    ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.scale(scale, scale);
    ctx.fillStyle = '#101724'; ctx.fillRect(-7, -19, 14, 5);
    ctx.fillStyle = spectator ? uniform : '#252e3e'; ctx.fillRect(-6, -24, 12, 7); ctx.fillRect(-8, -19, 16, 3);
    ctx.fillStyle = ['#e7bc94', '#c78d66', '#f0cba2', '#a66b4e'][variant % 4]; ctx.fillRect(-5, -16, 10, 8);
    ctx.fillStyle = uniform; ctx.fillRect(-8, -7, 16, 17); ctx.fillRect(-12, -5, 4, 14); ctx.fillRect(8, -5, 4, 14);
    ctx.fillStyle = spectator ? '#96c9e8' : '#f5f6f4'; ctx.fillRect(-8, -3, 16, 3); ctx.fillRect(-11, 1, 3, 2); ctx.fillRect(8, 1, 3, 2);
    ctx.fillStyle = '#ffe494'; ctx.fillRect(2, -6, 4, 4);
    ctx.fillStyle = uniform; ctx.fillRect(-7, 10, 6, 9); ctx.fillRect(2, 10, 6, 9);
    ctx.fillStyle = '#0c1017'; ctx.fillRect(-8, 17, 7, 4); ctx.fillRect(2, 17, 8, 4); ctx.restore();
  }
  function stands(x, y, right = false) {
    ctx.fillStyle = '#1c2d40'; ctx.fillRect(x, y, 145, 162);
    const tones = ['#345a83', '#376d9a', '#28466c', '#467aa3', '#254e7c', '#628da9'];
    for (let row = 0; row < 4; row++) {
      ctx.fillStyle = row % 2 ? '#334355' : '#29394b'; ctx.fillRect(x + 5, y + 12 + row * 35, 135, 30);
      for (let col = 0; col < 6; col++) {
        const variant = (row * 7 + col * 3 + (right ? 2 : 0)) % tones.length;
        person(x + 16 + col * 22, y + 30 + row * 35, .65, tones[variant], true, variant);
      }
    }
    ctx.fillStyle = '#7193a3'; ctx.fillRect(x + 3, y + 156, 139, 5);
    ctx.fillStyle = '#a4bec7'; ctx.fillRect(x + 3, y + 152, 4, 10); ctx.fillRect(x + 138, y + 152, 4, 10);
    ctx.fillStyle = right ? '#ffcf65' : '#4298ff'; ctx.fillRect(x + 15, y - 15, 35, 16);
    ctx.fillStyle = '#9fc0cd'; ctx.fillRect(x + 13, y - 15, 3, 30);
  }
  function drawCar(car) {
    const y = screenY(car.d); if (y < -110 || y > H + 110) return;
    ctx.save(); ctx.translate(Math.round(car.x), Math.round(y));
    if (car.isPlayer && car.boost > 0) {
      ctx.fillStyle = '#77f7dba0'; ctx.fillRect(-14, 47, 10, 22 + (reducedMotion ? 0 : Math.sin(visualTime * 30) * 9)); ctx.fillRect(4, 47, 10, 22);
    }
    ctx.fillStyle = '#0006'; ctx.fillRect(-29, -41, 62, 98);
    ctx.fillStyle = '#0b1016'; ctx.fillRect(-29, -32, 8, 23); ctx.fillRect(21, -32, 8, 23); ctx.fillRect(-29, 21, 8, 23); ctx.fillRect(21, 21, 8, 23);
    ctx.fillStyle = car.color; ctx.fillRect(-24, -46, 48, 95); ctx.fillRect(-20, -50, 40, 4);
    ctx.fillStyle = '#ffffff30'; ctx.fillRect(-21, -45, 4, 80);
    ctx.fillStyle = '#26e676'; ctx.fillRect(-24, -10, 48, 9); ctx.fillRect(-24, 28, 48, 5);
    ctx.fillStyle = '#193647'; ctx.fillRect(-17, -31, 34, 19); ctx.fillRect(-16, 20, 32, 12);
    ctx.fillStyle = '#a4eaff65'; ctx.fillRect(-15, -29, 12, 3);
    ctx.fillStyle = '#253c53'; ctx.fillRect(-19, -7, 38, 23);
    ctx.fillStyle = car.color; ctx.fillRect(-15, -3, 30, 15);
    ctx.fillStyle = '#c7dcdf'; ctx.fillRect(-19, 1, 38, 6);
    const blink = !reducedMotion && Math.floor(visualTime * 7) % 2;
    ctx.fillStyle = blink ? '#77d8ff' : '#2178ff'; ctx.fillRect(-19, 0, 13, 8);
    ctx.fillStyle = blink ? '#2178ff' : '#77d8ff'; ctx.fillRect(6, 0, 13, 8);
    if (!reducedMotion) { ctx.globalAlpha = .11; ctx.fillStyle = '#54aaff'; ctx.beginPath(); ctx.arc(blink ? -12 : 12, 4, 31, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.fillStyle = '#fff4bc'; ctx.fillRect(-19, -48, 10, 5); ctx.fillRect(9, -48, 10, 5);
    ctx.fillStyle = '#ff9c8e'; ctx.fillRect(-19, 44, 9, 4); ctx.fillRect(10, 44, 9, 4);
    ctx.fillStyle = '#a9bac2'; ctx.fillRect(-20, 49, 40, 4);
    if (car.hull < 40) { ctx.fillStyle = '#a5afba60'; ctx.fillRect(-10, -61, 14, 10); ctx.fillRect(2, -70, 11, 8); }
    if (car.isPlayer) { ctx.fillStyle = '#83f5da'; ctx.beginPath(); ctx.moveTo(0, -65); ctx.lineTo(-6, -74); ctx.lineTo(6, -74); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
  function drawFinish() {
    const y = screenY(FINISH); if (y < -220 || y > H + 250) return;
    ctx.fillStyle = '#637081'; ctx.fillRect(35, y - 150, 175, 200); ctx.fillRect(750, y - 150, 175, 200);
    ctx.fillStyle = '#8a95a4'; ctx.fillRect(35, y - 150, 175, 15); ctx.fillRect(750, y - 150, 175, 15);
    ctx.fillStyle = '#243443';
    for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) { ctx.fillRect(47 + col * 31, y - 118 + row * 46, 16, 23); ctx.fillRect(762 + col * 31, y - 118 + row * 46, 16, 23); }
    ctx.fillStyle = '#8598a4'; ctx.fillRect(212, y - 85, 18, 110); ctx.fillRect(730, y - 85, 18, 110);
    ctx.fillStyle = '#243345'; ctx.fillRect(215, y - 100, 530, 53);
    ctx.strokeStyle = '#adc3ce'; ctx.lineWidth = 3; ctx.strokeRect(215, y - 100, 530, 53);
    ctx.fillStyle = '#e1ebee'; ctx.textAlign = 'center'; ctx.font = 'bold 19px monospace'; ctx.fillText('ИСПРАВИТЕЛЬНАЯ КОЛОНИЯ', 480, y - 76);
    ctx.fillStyle = '#83f5da'; ctx.font = 'bold 12px monospace'; ctx.fillText('ФИНИШ · ВОРОТА ОТКРЫТЫ', 480, y - 58);
    for (let col = 0; col < 26; col++) for (let row = 0; row < 2; row++) { ctx.fillStyle = (row + col) % 2 ? '#1b2430' : '#f3f5ee'; ctx.fillRect(ROAD_LEFT + col * 20, y + row * 16, 20, 16); }
  }
  function draw() {
    ctx.clearRect(0, 0, W, H); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#17252c'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#263b3b'; ctx.fillRect(0, 0, 200, H); ctx.fillRect(760, 0, 200, H);
    const standOffset = (camera * SCALE) % 250;
    for (let y = -250 + standOffset; y < H; y += 250) { stands(35, y + 35); stands(780, y + 35, true); }
    ctx.fillStyle = '#34404a'; ctx.fillRect(ROAD_LEFT, 0, ROAD_RIGHT - ROAD_LEFT, H);
    ctx.fillStyle = '#2f3a45'; ctx.fillRect(ROAD_LEFT + 12, 0, ROAD_RIGHT - ROAD_LEFT - 24, H);
    const offset = (camera * SCALE) % 90; ctx.fillStyle = '#b9c4c540';
    for (let y = -90 + offset; y < H; y += 90) { ctx.fillRect(393, y, 5, 42); ctx.fillRect(563, y, 5, 42); }
    for (let y = -40 + (camera * SCALE) % 40; y < H; y += 40) {
      ctx.fillStyle = '#ebf0e6'; ctx.fillRect(213, y, 12, 20); ctx.fillRect(735, y, 12, 20);
      ctx.fillStyle = '#e46164'; ctx.fillRect(213, y + 20, 12, 20); ctx.fillRect(735, y + 20, 12, 20);
    }
    ctx.fillStyle = '#86a2a5'; ctx.fillRect(203, 0, 4, H); ctx.fillRect(753, 0, 4, H);
    for (let y = -50 + (camera * SCALE) % 50; y < H; y += 50) { ctx.fillRect(199, y, 12, 5); ctx.fillRect(749, y, 12, 5); }
    if (camera < 100) { const y = screenY(0); ctx.fillStyle = '#e3e9df99'; ctx.fillRect(ROAD_LEFT, y + 58, ROAD_RIGHT - ROAD_LEFT, 8); ctx.font = 'bold 25px monospace'; ctx.textAlign = 'center'; ctx.fillText('СТАРТ', 480, y + 97); }
    drawFinish();
    for (const object of objects) {
      const y = screenY(object.d); if (object.taken || y < -40 || y > H + 40) continue;
      if (object.kind === 'person') {
        ctx.fillStyle = '#0004'; ctx.fillRect(object.x - 13, y + 17, 27, 7); person(object.x, y, 1, '#11151c', false, Math.floor(object.d / 65));
      } else if (object.kind === 'barrier') {
        ctx.fillStyle = '#101722'; ctx.fillRect(object.x - 40, y + 5, 8, 18); ctx.fillRect(object.x + 32, y + 5, 8, 18);
        ctx.fillStyle = '#efbf65'; ctx.fillRect(object.x - 45, y - 14, 90, 24);
        ctx.fillStyle = '#282c35'; for (let x = -40; x < 45; x += 22) ctx.fillRect(object.x + x, y - 14, 10, 24);
        ctx.fillStyle = '#ffe0a5'; ctx.fillRect(object.x - 45, y - 14, 90, 4);
      } else {
        ctx.fillStyle = '#16232a'; ctx.fillRect(object.x - 14, y + 10, 28, 8);
        ctx.fillStyle = '#ff985b'; ctx.beginPath(); ctx.moveTo(object.x, y - 19); ctx.lineTo(object.x - 12, y + 12); ctx.lineTo(object.x + 12, y + 12); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff2df'; ctx.fillRect(object.x - 7, y - 1, 14, 5);
      }
    }
    [...cars].sort((a, b) => b.d - a.d).forEach(drawCar);
    for (const p of particles) { ctx.globalAlpha = p.life / .65; ctx.fillStyle = p.color; ctx.fillRect(p.x, screenY(p.d), 4, 4); }
    ctx.globalAlpha = 1; ctx.textAlign = 'center'; ctx.font = 'bold 16px monospace';
    for (const message of messages) { ctx.globalAlpha = Math.min(1, message.life * 2); ctx.fillStyle = message.color; ctx.fillText(message.text, message.x, screenY(message.d) - (1.1 - message.life) * 30); }
    ctx.globalAlpha = 1;
    if (mode === 'playing') { ctx.fillStyle = '#111b2bd9'; ctx.fillRect(ROAD_LEFT + 12, 12, 170, 31); ctx.fillStyle = '#dbeae9'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'left'; ctx.fillText(`ДО ФИНИША: ${Math.max(0, Math.ceil(FINISH - player.d))} М`, ROAD_LEFT + 23, 32); }
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(bounds.width * ratio); canvas.height = Math.round(bounds.height * ratio);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0); draw();
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
  function setPointer(event) { const bounds = canvas.getBoundingClientRect(); pointer = clamp((event.clientX - bounds.left) / bounds.width * W, ROAD_LEFT + 29, ROAD_RIGHT - 29); }
  canvas.addEventListener('pointerdown', event => { if (mode !== 'playing' || activePointer !== null) return; event.preventDefault(); activePointer = event.pointerId; canvas.setPointerCapture(event.pointerId); setPointer(event); });
  canvas.addEventListener('pointermove', event => { if (event.pointerId === activePointer) setPointer(event); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, event => { if (event.pointerId === activePointer) { pointer = null; activePointer = null; } });
  for (const [id, value] of [['left', -1], ['right', 1]]) {
    const button = $(id);
    button.addEventListener('pointerdown', event => { if (mode !== 'playing') return; event.preventDefault(); button.setPointerCapture(event.pointerId); steeringPointers.set(event.pointerId, value); });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(eventName, event => steeringPointers.delete(event.pointerId));
    button.addEventListener('click', event => { if (event.detail === 0 && mode === 'playing') player.x = clamp(player.x + value * 35, ROAD_LEFT + 29, ROAD_RIGHT - 29); });
  }
  window.addEventListener('blur', () => { keys.clear(); steeringPointers.clear(); if (mode === 'playing') pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'playing') pause(); });
  $('start').addEventListener('click', start); $('pause').addEventListener('click', pause);
  $('boost').addEventListener('click', boost); $('mobile-boost').addEventListener('click', boost);
  $('mobile-boost').addEventListener('pointerdown', event => { event.preventDefault(); boost(); });
  new ResizeObserver(resize).observe($('arena'));
  reset(); resize(); requestAnimationFrame(frame);
})();
