// ================================================================
// main2d.js — Survival Evolution (2D istemci, tarayıcıda çalışır)
// server.js'deki socket.io event'lerine bire bir bağlanır:
// register, verifyEmail, login, loginWithToken, forgotPassword,
// verifyResetCode, resetPassword, playerMovement, collect, craft, attack.
// ================================================================

(function () {
  const socket = io();
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  // ─────────────── Auth akışı ───────────────
  const authScreen = document.getElementById('authScreen');
  const gameScreen = document.getElementById('gameScreen');
  const panels = {
    login: document.getElementById('loginPanel'), register: document.getElementById('registerPanel'),
    verify: document.getElementById('verifyPanel'), forgot: document.getElementById('forgotPanel'),
    resetCode: document.getElementById('resetCodePanel'), resetPass: document.getElementById('resetPassPanel')
  };
  function showPanel(name) { Object.keys(panels).forEach(function (k) { panels[k].classList.add('hidden'); }); panels[name].classList.remove('hidden'); }
  function setMsg(id, text) { document.getElementById(id).textContent = text || ''; }

  let pendingUsername = null, pendingResetEmail = null;

  document.getElementById('toRegister').onclick = function () { showPanel('register'); };
  document.getElementById('toLoginFromReg').onclick = function () { showPanel('login'); };
  document.getElementById('toForgot').onclick = function () { showPanel('forgot'); };
  document.getElementById('toLoginFromForgot').onclick = function () { showPanel('login'); };

  document.getElementById('loginBtn').onclick = function () {
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    if (!username || !password) { setMsg('loginMsg', 'Tüm alanları doldur.'); return; }
    socket.emit('login', { username: username, password: password });
  };
  document.getElementById('registerBtn').onclick = function () {
    const username = document.getElementById('regUser').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPass').value;
    setMsg('registerMsg', '');
    socket.emit('register', { username: username, email: email, password: password });
  };
  document.getElementById('verifyBtn').onclick = function () {
    socket.emit('verifyEmail', { username: pendingUsername, code: document.getElementById('verifyCode').value.trim() });
  };
  document.getElementById('resendBtn').onclick = function () {
    socket.emit('resendVerifyCode', { username: pendingUsername });
    setMsg('verifyMsg', 'Yeni kod gönderildi.');
  };
  document.getElementById('forgotBtn').onclick = function () {
    pendingResetEmail = document.getElementById('forgotEmail').value.trim();
    socket.emit('forgotPassword', { email: pendingResetEmail });
  };
  document.getElementById('resetCodeBtn').onclick = function () {
    socket.emit('verifyResetCode', { email: pendingResetEmail, code: document.getElementById('resetCode').value.trim() });
  };
  document.getElementById('resetPassBtn').onclick = function () {
    socket.emit('resetPassword', { email: pendingResetEmail, newPassword: document.getElementById('newPass').value });
  };

  socket.on('loginError', function (msg) {
    if (!msg) return;
    ['loginMsg', 'registerMsg', 'verifyMsg', 'forgotMsg'].forEach(function (id) { setMsg(id, ''); });
    if (!panels.login.classList.contains('hidden')) setMsg('loginMsg', msg);
    else if (!panels.register.classList.contains('hidden')) setMsg('registerMsg', msg);
    else if (!panels.verify.classList.contains('hidden')) setMsg('verifyMsg', msg);
    else if (!panels.forgot.classList.contains('hidden')) setMsg('forgotMsg', msg);
  });
  socket.on('registerSuccess', function (data) { pendingUsername = data.username; showPanel('verify'); setMsg('verifyMsg', ''); });
  socket.on('verifySuccess', function () { setMsg('verifyMsg', 'Doğrulandı!'); });
  socket.on('forgotPasswordCodeSent', function () { showPanel('resetCode'); setMsg('resetCodeMsg', ''); });
  socket.on('resetCodeError', function (msg) { setMsg('resetCodeMsg', msg); });
  socket.on('resetCodeVerified', function () { showPanel('resetPass'); setMsg('resetPassMsg', ''); });
  socket.on('resetPasswordError', function (msg) { setMsg('resetPassMsg', msg); });
  socket.on('resetPasswordSuccess', function () { setMsg('resetPassMsg', 'Şifren değişti.'); setTimeout(function () { showPanel('login'); }, 1200); });

  socket.on('loginSuccess', function (data) {
    localStorage.setItem('survivalToken', data.token);
    authScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    document.getElementById('touchControls').classList.toggle('hidden', !isTouch);
    initGame();
    checkOrientation();
  });
  const savedToken = localStorage.getItem('survivalToken');
  if (savedToken) socket.emit('loginWithToken', savedToken);

  const rotateOverlay = document.getElementById('rotateOverlay');
  function checkOrientation() {
    const inGame = !gameScreen.classList.contains('hidden');
    rotateOverlay.classList.toggle('hidden', !(isTouch && inGame && window.innerHeight > window.innerWidth));
  }
  window.addEventListener('resize', checkOrientation);
  window.addEventListener('orientationchange', function () { setTimeout(checkOrientation, 200); });
  if (isTouch && screen.orientation && screen.orientation.lock) {
    document.addEventListener('click', function once() {
      screen.orientation.lock('landscape').catch(function () {});
      document.removeEventListener('click', once);
    }, { once: true });
  }

  socket.on('updateInventory', function (inv) {
    document.getElementById('invWood').textContent = inv.wood || 0;
    document.getElementById('invStone').textContent = inv.stone || 0;
    document.getElementById('invSword').textContent = inv.sword || 0;
    document.getElementById('invPickaxe').textContent = inv.pickaxe || 0;
    document.getElementById('invAxe').textContent = inv.axe || 0;
  });
  const craftPanel = document.getElementById('craftPanel');
  document.getElementById('craftToggle').onclick = function () { craftPanel.classList.toggle('hidden'); };
  document.querySelectorAll('.craftBtn').forEach(function (btn) {
    btn.onclick = function () { socket.emit('craft', btn.dataset.item); toast('Üretildi: ' + btn.dataset.item); };
  });
  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.add('hidden'); }, 1400);
  }

  let myHp = 100;
  socket.on('hpUpdate', function (data) {
    if (data.id === socket.id) {
      myHp = data.hp;
      const hpEl = document.getElementById('hpbar');
      hpEl.style.width = Math.max(0, myHp) + '%';
      hpEl.style.background = myHp > 40 ? '#5dcaa5' : '#e24b4a';
      shake(10);
      if (myHp <= 0) document.getElementById('overScreen').classList.remove('hidden');
    } else if (others[data.id]) {
      floatText(others[data.id].x, others[data.id].y, '-hasar', '#ff6a5a');
    }
  });
  document.getElementById('respawnBtn').onclick = function () { document.getElementById('overScreen').classList.add('hidden'); };

  // ═══════════════════ 2D PİKSEL SANATI MOTORU ═══════════════════
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const ELEMENTS = [
    { name: 'ateş', base: '#e2543a', glow: '#ffcf6b' },
    { name: 'su', base: '#3aa0e2', glow: '#bdf0ff' },
    { name: 'şimşek', base: '#e2d23a', glow: '#fff7bd' },
    { name: 'rüzgâr', base: '#7fe2b0', glow: '#e6fff2' },
    { name: 'toprak', base: '#a3703f', glow: '#e6c79a' }
  ];

  function makeNinjaSprite(hairColor, clothColor, headbandColor) {
    const cv = document.createElement('canvas'); cv.width = 20; cv.height = 28;
    const c = cv.getContext('2d');
    function px(x, y, color) { c.fillStyle = color; c.fillRect(x, y, 1, 1); }
    const skin = '#f0b98c';
    for (let x = 5; x <= 14; x++) for (let y = 2; y <= 6; y++) px(x, y, hairColor);
    for (let x = 6; x <= 13; x++) for (let y = 5; y <= 11; y++) px(x, y, skin);
    for (let x = 5; x <= 14; x++) px(x, 7, headbandColor);
    for (let x = 5; x <= 14; x++) px(x, 8, headbandColor);
    px(14, 9, headbandColor); px(15, 10, headbandColor);
    px(8, 9, '#20242c'); px(11, 9, '#20242c');
    for (let x = 5; x <= 14; x++) for (let y = 12; y <= 20; y++) px(x, y, clothColor);
    for (let y = 13; y <= 18; y++) { px(4, y, clothColor); px(15, y, skin); }
    px(4, 19, skin); px(15, 19, skin);
    for (let y = 21; y <= 26; y++) { px(7, y, '#2b2f38'); px(12, y, '#2b2f38'); }
    return cv;
  }

  function makeWalkFrame(base, legOffset) {
    const cv = document.createElement('canvas'); cv.width = 20; cv.height = 28;
    const c = cv.getContext('2d');
    c.drawImage(base, 0, 0, 20, 21, 0, 0, 20, 21);
    c.fillStyle = '#2b2f38';
    c.fillRect(7, 21 + legOffset, 2, 6 - legOffset);
    c.fillRect(12, 21 - legOffset, 2, 6 + legOffset);
    return cv;
  }

  function buildCharacterSet(seedColor) {
    const hair = shadeHex(seedColor, -0.3);
    const base = makeNinjaSprite(hair, seedColor, '#20242c');
    return [makeWalkFrame(base, 0), makeWalkFrame(base, 2), makeWalkFrame(base, 0), makeWalkFrame(base, -2)];
  }
  function shadeHex(hex, amt) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, ((num >> 16) & 255) * (1 + amt)));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 255) * (1 + amt)));
    const b = Math.min(255, Math.max(0, (num & 255) * (1 + amt)));
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  const treeSprite = (function () {
    const cv = document.createElement('canvas'); cv.width = 24; cv.height = 30;
    const c = cv.getContext('2d');
    function px(x, y, color) { c.fillStyle = color; c.fillRect(x, y, 1, 1); }
    for (let x = 10; x <= 13; x++) for (let y = 18; y <= 27; y++) px(x, y, '#6b4a2f');
    for (let x = 2; x <= 21; x++) for (let y = 6; y <= 20; y++) {
      if (Math.hypot(x - 11.5, y - 13) < 9.5) px(x, y, (x + y) % 5 === 0 ? '#4fae5a' : '#3f9c4f');
    }
    return cv;
  })();

  const rockSprite = (function () {
    const cv = document.createElement('canvas'); cv.width = 20; cv.height = 16;
    const c = cv.getContext('2d');
    function px(x, y, color) { c.fillStyle = color; c.fillRect(x, y, 1, 1); }
    for (let x = 1; x <= 18; x++) for (let y = 3; y <= 14; y++) {
      if (Math.hypot((x - 9.5) / 1.3, y - 9) < 6) px(x, y, (x + y * 2) % 6 === 0 ? '#9aa0ab' : '#8a8f9a');
    }
    return cv;
  })();

  const WORLD_SIZE = 1600;

  const groundPattern = (function () {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    c.fillStyle = '#6fae52'; c.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 40; i++) {
      c.fillStyle = Math.random() < 0.5 ? '#649e49' : '#7ab85c';
      c.fillRect(Math.floor(Math.random() * 64), Math.floor(Math.random() * 64), 2, 2);
    }
    return c.getImageData(0, 0, 64, 64);
  })();
  const groundCanvas = document.createElement('canvas');
  groundCanvas.width = groundCanvas.height = 64;
  groundCanvas.getContext('2d').putImageData(groundPattern, 0, 0);
  let groundTilePattern = null;

  let resourceNodes = [];
  function seedWorld() {
    resourceNodes = [];
    for (let i = 0; i < 26; i++) resourceNodes.push({ type: 'wood', x: Math.random() * WORLD_SIZE - WORLD_SIZE / 2, y: Math.random() * WORLD_SIZE - WORLD_SIZE / 2, alive: true });
    for (let j = 0; j < 20; j++) resourceNodes.push({ type: 'stone', x: Math.random() * WORLD_SIZE - WORLD_SIZE / 2, y: Math.random() * WORLD_SIZE - WORLD_SIZE / 2, alive: true });
  }

  let myPos = { x: 0, y: 0 };
  let myFrame = 0, myFrameT = 0, myDir = 1, myMoving = false;
  let myColor = '#3ad1ff';
  let mySprites = null;
  let others = {};
  let effects = [];
  let floatTexts = [];
  let shakeAmt = 0;

  function floatText(x, y, text, color) {
    floatTexts.push({ x: x, y: y, text: text, color: color, life: 0.8 });
  }
  function shake(amt) { shakeAmt = Math.min(14, shakeAmt + amt); }

  function jutsuEffect(x, y) {
    const el = ELEMENTS[Math.floor(Math.random() * ELEMENTS.length)];
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 60;
      effects.push({
        x: x, y: y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        life: 0.5 + Math.random() * 0.3, color: Math.random() < 0.5 ? el.base : el.glow, size: 3 + Math.random() * 3
      });
    }
    shake(6);
    return el.name;
  }

  function initGame() {
    myColor = '#' + ('000000' + Math.floor(Math.random() * 0x1000000).toString(16)).slice(-6);
    mySprites = buildCharacterSet(myColor);
    seedWorld();
    resize();
    requestAnimationFrame(loop);
  }

  function resize() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  }
  window.addEventListener('resize', resize);

  // ─────────────── Diğer oyuncular ───────────────
  socket.on('currentPlayers', function (players) {
    Object.keys(players).forEach(function (id) { if (id !== socket.id) addOther(players[id]); });
  });
  socket.on('newPlayer', function (p) { if (p.id !== socket.id) addOther(p); });
  socket.on('playerMoved', function (p) {
    const o = others[p.id];
    if (!o) { addOther(p); return; }
    o.tx = p.x; o.ty = p.z;
    o.dir = (p.rotationY > Math.PI / 2 || p.rotationY < -Math.PI / 2) ? -1 : 1;
  });
  socket.on('playerDisconnected', function (id) { delete others[id]; });
  function addOther(p) {
    const hexColor = '#' + (p.color || 0xd8663c).toString(16).padStart(6, '0');
    others[p.id] = { x: p.x || 0, y: p.z || 0, tx: p.x || 0, ty: p.z || 0, dir: 1, sprites: buildCharacterSet(hexColor), frame: 0, frameT: 0, moving: false };
  }

  // ─────────────── Girdi ───────────────
  const keys = {};
  document.addEventListener('keydown', function (e) { keys[e.key.toLowerCase()] = true; });
  document.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });

  const move = { x: 0, y: 0 };
  const stick = document.getElementById('stick'), stickKnob = document.getElementById('stickKnob');
  let stickTouchId = null, stickCenter = { x: 0, y: 0 };
  stick.addEventListener('touchstart', function (e) {
    stickTouchId = e.changedTouches[0].identifier;
    const rect = stick.getBoundingClientRect();
    stickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    e.preventDefault();
  });
  stick.addEventListener('touchmove', function (e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier !== stickTouchId) continue;
      const dx = t.clientX - stickCenter.x, dy = t.clientY - stickCenter.y;
      const dist = Math.min(40, Math.hypot(dx, dy));
      const ang = Math.atan2(dy, dx);
      stickKnob.style.left = (30 + Math.cos(ang) * dist) + 'px';
      stickKnob.style.top = (30 + Math.sin(ang) * dist) + 'px';
      move.x = Math.cos(ang) * (dist / 40); move.y = Math.sin(ang) * (dist / 40);
    }
    e.preventDefault();
  });
  function resetStick() { stickTouchId = null; move.x = 0; move.y = 0; stickKnob.style.left = '30px'; stickKnob.style.top = '30px'; }
  stick.addEventListener('touchend', resetStick);
  stick.addEventListener('touchcancel', resetStick);

  function nearestInteractable() {
    let best = null, bestDist = 46;
    resourceNodes.forEach(function (n) {
      if (!n.alive) return;
      const d = Math.hypot(myPos.x - n.x, myPos.y - n.y);
      if (d < bestDist) { bestDist = d; best = { kind: 'resource', node: n }; }
    });
    Object.keys(others).forEach(function (id) {
      const o = others[id];
      const d = Math.hypot(myPos.x - o.x, myPos.y - o.y);
      if (d < 56) { bestDist = d; best = { kind: 'player', id: id }; }
    });
    return best;
  }
  function doInteract() {
    const target = nearestInteractable();
    if (!target) return;
    if (target.kind === 'resource') {
      const n = target.node;
      socket.emit('collect', n.type);
      floatText(n.x, n.y, n.type === 'wood' ? '+odun' : '+taş', '#bdf0ff');
      n.alive = false;
      setTimeout(function () { n.alive = true; }, 12000);
    } else {
      socket.emit('attack', target.id);
      const elName = jutsuEffect(others[target.id].x, others[target.id].y);
      floatText(others[target.id].x, others[target.id].y - 10, elName + ' jutsu!', '#ffe08a');
    }
  }
  document.getElementById('interactBtn').addEventListener('touchstart', function (e) { doInteract(); e.preventDefault(); });
  window.addEventListener('keydown', function (e) { if (e.key.toLowerCase() === 'e') doInteract(); });
  canvas.addEventListener('dblclick', doInteract);

  // ─────────────── Döngü ───────────────
  let lastT = performance.now(), lastSent = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;

    let mx = 0, my = 0;
    if (isTouch) { mx = move.x; my = move.y; }
    else {
      if (keys['w']) my -= 1; if (keys['s']) my += 1;
      if (keys['a']) mx -= 1; if (keys['d']) mx += 1;
    }
    const len = Math.hypot(mx, my);
    myMoving = len > 0.05;
    if (myMoving) {
      mx /= len; my /= len;
      myDir = mx < -0.1 ? -1 : (mx > 0.1 ? 1 : myDir);
      const speed = 130 * dt;
      myPos.x = Math.max(-WORLD_SIZE / 2, Math.min(WORLD_SIZE / 2, myPos.x + mx * speed));
      myPos.y = Math.max(-WORLD_SIZE / 2, Math.min(WORLD_SIZE / 2, myPos.y + my * speed));
      myFrameT += dt;
      if (myFrameT > 0.14) { myFrameT = 0; myFrame = (myFrame + 1) % 4; }
    } else { myFrame = 0; }

    lastSent += dt;
    if (lastSent > 0.08) {
      lastSent = 0;
      socket.emit('playerMovement', { x: myPos.x, y: 0, z: myPos.y, rotationY: myDir > 0 ? 0 : Math.PI });
    }

    Object.keys(others).forEach(function (id) {
      const o = others[id];
      const d = Math.hypot(o.tx - o.x, o.ty - o.y);
      o.moving = d > 1;
      o.x += (o.tx - o.x) * 0.2; o.y += (o.ty - o.y) * 0.2;
      if (o.moving) { o.frameT += dt; if (o.frameT > 0.14) { o.frameT = 0; o.frame = (o.frame + 1) % 4; } } else { o.frame = 0; }
    });

    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= 0.9; e.vy *= 0.9; e.life -= dt;
      if (e.life <= 0) effects.splice(i, 1);
    }
    for (let j = floatTexts.length - 1; j >= 0; j--) {
      floatTexts[j].y -= dt * 20; floatTexts[j].life -= dt;
      if (floatTexts[j].life <= 0) floatTexts.splice(j, 1);
    }
    shakeAmt *= 0.85;

    render();
  }

  function render() {
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#5a9c4a';
    ctx.fillRect(0, 0, w, h);

    const sx = -myPos.x + w / 2 + (Math.random() - 0.5) * shakeAmt;
    const sy = -myPos.y + h / 2 + (Math.random() - 0.5) * shakeAmt;

    if (!groundTilePattern) groundTilePattern = ctx.createPattern(groundCanvas, 'repeat');
    ctx.save();
    ctx.translate(sx % 64, sy % 64);
    ctx.fillStyle = groundTilePattern;
    ctx.fillRect(-64, -64, w + 128, h + 128);
    ctx.restore();

    resourceNodes.forEach(function (n) {
      if (!n.alive) return;
      const x = n.x + sx, y = n.y + sy;
      if (x < -40 || x > w + 40 || y < -40 || y > h + 40) return;
      const sprite = n.type === 'wood' ? treeSprite : rockSprite;
      ctx.drawImage(sprite, x - sprite.width, y - sprite.height, sprite.width * 2, sprite.height * 2);
    });

    function drawChar(x, y, sprites, frame, dir) {
      const sp = sprites[frame];
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(dir, 1);
      ctx.drawImage(sp, -sp.width, -sp.height * 1.6, sp.width * 2, sp.height * 1.6);
      ctx.restore();
    }

    Object.keys(others).forEach(function (id) {
      const o = others[id];
      drawChar(o.x + sx, o.y + sy, o.sprites, o.frame, o.dir);
    });
    if (mySprites) drawChar(myPos.x + sx, myPos.y + sy, mySprites, myFrame, myDir);

    effects.forEach(function (e) {
      ctx.fillStyle = e.color;
      ctx.globalAlpha = Math.max(0, e.life);
      ctx.fillRect(e.x + sx - e.size / 2, e.y + sy - e.size / 2, e.size, e.size);
      ctx.globalAlpha = 1;
    });

    floatTexts.forEach(function (f) {
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.fillStyle = f.color;
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x + sx, f.y + sy);
      ctx.globalAlpha = 1;
    });
  }
})();
