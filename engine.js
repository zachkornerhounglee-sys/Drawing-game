/* ============================================================================
   engine.js - 2D canvas game loop, physics, terrain painting, combat,
   particles, rendering and host/guest state synchronisation.
   Depends on: Net (network.js), WEAPONS / WeaponIcons / DrawPad (classifier.js)
   ============================================================================ */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* constants                                                           */
  /* ------------------------------------------------------------------ */
  const W = 1280, H = 720, CELL = 20, COLS = 64, ROWS = 36, R = 12, TAU = Math.PI * 2, STEP = 1 / 60;
  const T = { EMPTY: 0, WALL: 1, BOOST: 2, ACID: 3, ICE: 4, HEAL: 5 };
  const KEY_ACTIONS = [
    { id:'moveUp', label:'MOVE UP' }, { id:'moveDown', label:'MOVE DOWN' },
    { id:'moveLeft', label:'MOVE LEFT' }, { id:'moveRight', label:'MOVE RIGHT' },
    { id:'fire', label:'ATTACK / FIRE' }, { id:'drawWeapon', label:'DRAW WEAPON' },
    { id:'pause', label:'PAUSE / MENU' }, { id:'toggleEditor', label:'TOGGLE MAP EDITOR' },
    { id:'paintWall', label:'PAINT WALL' }, { id:'paintBoost', label:'PAINT SPEED TILE' },
    { id:'paintAcid', label:'PAINT ACID' }, { id:'paintIce', label:'PAINT ICE' },
    { id:'paintHeal', label:'PAINT HEAL TILE' }, { id:'erase', label:'ERASE TILE' }
  ];
  const PALETTE = ['#ff2e97', '#00f0ff', '#b4ff39', '#ffb000', '#a66bff', '#ff5f5f', '#39ffb6', '#ff8a00'];
  const BOT_NAMES = ['NEON-7', 'GLITCH', 'VANTA', 'CIPHER', 'ROGUE', 'KILOBYTE'];
  const VERSION = 'v9';
  const SIM_SCALE = 0.80;                       /* game-speed factor kept from v8: the sim runs at 80% real time */
  const GRAV = 1050, JUMP_V = -440, TERM_V = 1150;
  const CY = 22, HIT_R = 11;                    /* chest height above the feet; body hit radius */
  const PROJ_TYPES = ['bullet', 'arrow', 'orb', 'star', 'boom', 'bomb', 'twister'];
  const RANGED_AI = { gun: 1, bow: 1, staff: 1, shuriken: 1, boomerang: 1, bomb: 1, lightning: 1, cyclone: 1 };

  const G = {
    isHost: true, myId: 'local', started: false,
    players: new Map(), proj: [], waves: [], parts: [], texts: [], fx: [],
    map: new Uint8Array(COLS * ROWS), changes: [], events: [], pending: [],
    shake: 0, time: 0, nextId: 1, tick: 0, paint: false, brush: T.WALL, brushSize: 2,
    mouse: { x: W / 2, y: H / 2, down: false, right: false, lx: null, ly: null },
    keys: {}, taps: {}, botsOn: true, modalOpen: false, menu: false, pad: false, attract: false, killfeed: [], lastSnap: 0,
    roundsDrawEnabled: false, weaponArts: new Map(), weaponArtImages: new Map(),
    platforms: [], stageDesign: false, stageDrag: null, stageThickness: 14, plist: [], rtt: 0, quality: 1, snaps: [], roster: new Map(), nUsed: new Set(), rosterDirty: true, interpDelay: 100, localInp: { mx: W / 2, my: H / 2, u: 0, d: 0, l: 0, r: 0, f: 0 }, snapEma: 33, lastSnapT: 0
  };
  let pendingInitialDraw = false, lastSelfDead = null;
  window.Game = G;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }
  function me() { return G.players.get(G.myId) || null; }
  function sprOn() { return Settings.sprites && Sprites.ready(); }
  const ELEMS = ['fire', 'water', 'wind', 'lightning', 'rock'];
  const ELEM_COL = { fire: '#ff8a2a', water: '#3da0ff', wind: '#c9d4ff', lightning: '#ffe14d', rock: '#b9825a' };
  const ELEM_LOOP = { fire: [0, 5], water: [0, 7], rock: [0, 2], wind: [0, 3], lightning: [0, 4] };
  function boltFor(hex) {
    if (!hex) return 'boltWhite';
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (b >= r && b >= g) ? 'boltBlue' : (g >= r ? 'boltGreen' : 'boltRed');
  }
  function addSpr(name, x, y, rot, sc, life) {
    if (!sprOn()) return;
    if (G.fx.length > 80) return;
    G.fx.push({ k: 'spr', name: name, x: x, y: y, rot: rot, sc: sc, life: life, max: life });
  }
  function ev(e) { G.events.push(e); }
  /* distance from a point to a player's body (a vertical capsule from knees to head) */
  function bodyDist(t, x, y) {
    const top = t.y - 38, bot = t.y - 6, cy = y < top ? top : y > bot ? bot : y;
    return Math.hypot(x - t.x, y - cy);
  }
  /* first platform whose top surface is crossed while moving down from prevY to y at column x */
  function platformCross(prevY, y, x) {
    const pls = G.platforms;
    let best = null;
    for (let i = 0; i < pls.length; i++) {
      const pl = pls[i];
      if (x >= pl.x && x <= pl.x + pl.w && prevY <= pl.y && y >= pl.y && (!best || pl.y < best.y)) best = pl;
    }
    return best;
  }
  function floorY() {
    let m = 0; const pls = G.platforms;
    for (let i = 0; i < pls.length; i++) if (pls[i].y > m) m = pls[i].y;
    return m;
  }
  function bindCode(action) {
    const code = Settings.keybinds && Settings.keybinds[action];
    return typeof code === 'string' && code ? code : ({ moveUp:'KeyW', moveDown:'KeyS', moveLeft:'KeyA', moveRight:'KeyD', fire:'Space', drawWeapon:'KeyE', pause:'Escape', toggleEditor:'KeyP', paintWall:'Digit1', paintBoost:'Digit2', paintAcid:'Digit3', paintIce:'Digit4', paintHeal:'Digit5', erase:'Digit6' }[action]);
  }
  function keyDown(action) { const c = bindCode(action); return !!(G.keys[c] || G.taps[c]); }
  function setWeaponArt(id, data) {
    if (typeof id !== 'string' || !id) return;
    if (typeof data !== 'string' || data.indexOf('data:image/png;base64,') !== 0 || data.length > 40000) {
      G.weaponArts.delete(id); G.weaponArtImages.delete(id); return;
    }
    G.weaponArts.set(id, data);
    const img = new Image();
    img.onload = function () { /* render loop automatically picks up the loaded art */ };
    img.onerror = function () { G.weaponArtImages.delete(id); };
    img.src = data; G.weaponArtImages.set(id, img);
  }

  /* ------------------------------------------------------------------ */
  /* tile map                                                            */
  /* ------------------------------------------------------------------ */
  function tileAt(x, y) {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return T.WALL;
    return G.map[cy * COLS + cx];
  }
  function solidAt(x, y) { return tileAt(x, y) === T.WALL; }
  function hitsWall(x, y, r) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS || G.map[cy * COLS + cx] === T.WALL) return true;
    }
    return false;
  }
  function losClear(x1, y1, x2, y2) {
    const d = Math.hypot(x2 - x1, y2 - y1), n = Math.ceil(d / 8);
    for (let i = 1; i < n; i++) { const t = i / n; if (solidAt(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false; }
    return true;
  }
  function findFree(x, y) {
    if (!hitsWall(x, y, R + 1)) return { x: x, y: y };
    for (let rad = 1; rad < 40; rad++) {
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos(a / 16 * TAU) * rad * CELL * 0.5, py = y + Math.sin(a / 16 * TAU) * rad * CELL * 0.5;
        if (!hitsWall(px, py, R + 1)) return { x: px, y: py };
      }
    }
    return { x: W / 2, y: H / 2 };
  }
  function rect(x, y, w, h, t) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (i >= 0 && j >= 0 && i < COLS && j < ROWS) G.map[j * COLS + i] = t;
  }
  function borderWalls() {
    for (let i = 0; i < COLS; i++) { G.map[i] = T.WALL; G.map[(ROWS - 1) * COLS + i] = T.WALL; }
    for (let j = 0; j < ROWS; j++) { G.map[j * COLS] = T.WALL; G.map[j * COLS + COLS - 1] = T.WALL; }
  }
  function buildDefaultMap() {
    /* v9: the side-view fighter has no tile walls. The old default tiles were invisible
       but still blocked melee hits and bot line of sight, so only the border remains. */
    G.map.fill(0);
    borderWalls();
  }
  function clearMap() { G.map.fill(0); borderWalls(); }
  function mapToString() { let s = ''; for (let i = 0; i < G.map.length; i++) s += String.fromCharCode(48 + G.map[i]); return s; }
  function mapFromString(s) {
    for (let i = 0; i < G.map.length; i++) { const v = (s.charCodeAt(i) || 48) - 48; G.map[i] = v >= 0 && v <= 5 ? v : 0; }
    borderWalls();
  }
  function relocateStuck() {
    G.players.forEach(function (p) {
      if (!p.dead && hitsWall(p.x, p.y, R)) { const f = findFree(p.x, p.y); p.x = f.x; p.y = f.y; p.vx = p.vy = 0; }
    });
  }

  /* painting: host only, every change is queued as [cellIndex, terrain] */
  function paintCell(cx, cy, t) {
    if (cx <= 0 || cy <= 0 || cx >= COLS - 1 || cy >= ROWS - 1) return false;
    const i = cy * COLS + cx;
    if (G.map[i] === t) return false;
    G.map[i] = t; G.changes.push(i, t);
    return true;
  }
  function paintAt(px, py, t) {
    const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL), s = G.brushSize, rr = (s - 0.5) * (s - 0.5);
    let wall = false;
    for (let dy = -s; dy <= s; dy++) for (let dx = -s; dx <= s; dx++) {
      if (dx * dx + dy * dy <= rr && paintCell(cx + dx, cy + dy, t) && t === T.WALL) wall = true;
    }
    if (wall) relocateStuck();
  }
  function paintStroke(x0, y0, x1, y1, t) {
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / (CELL * 0.5)));
    for (let i = 0; i <= n; i++) paintAt(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, t);
  }
  function flushMapChanges(send) {
    if (!G.changes.length) return;
    if (send) Net.broadcast({ t: 'map', c: G.changes });
    G.changes = [];
  }

  /* ------------------------------------------------------------------ */
  /* players                                                             */
  /* ------------------------------------------------------------------ */
  function blankPlayer(id, name, color) {
    return {
      id: id, name: name, color: color, bot: false, x: W / 2, y: 580, tx: W / 2, ty: 580, vx: 0, vy: 0, a: 0, face: 1, grounded: true, jumps: 0, coyote: 0, dropT: 0, upPrev: 0, lastIn: 0, swing: 0,
      hp: 100, max: 100, weapon: 'gun', cd: 0, dead: false, rt: 0, score: 0, deaths: 0,
      shieldT: 0, shieldAge: 0, acidT: 0, healT: 0, slowed: false,
      inp: { mx: W / 2, my: H / 2, u: 0, d: 0, l: 0, r: 0, f: 0 }, ai: { t: 0, strafe: 1, err: 0 }
    };
  }
  function spawnPoint() {
    const platforms = G.platforms || [];
    if (!platforms.length) return { x: rnd(150, W - 150), y: H - 40 };
    // Prefer the lowest broad platform for safe spawning.
    const candidates = platforms.filter(function (p) { return p.y >= H * 0.58 && p.w >= 150; });
    const pool = candidates.length ? candidates : platforms;
    const floor = pool.reduce(function (a, b) { return b.y > a.y ? b : a; }, pool[0]);
    return { x: rnd(floor.x + Math.min(35, floor.w * 0.15), floor.x + floor.w - Math.min(35, floor.w * 0.15)), y: floor.y };
  }
  function sanitizePlatforms(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 80).map(function (p) {
      const x = clamp(Number(p.x) || 0, 20, W - 40);
      const y = clamp(Number(p.y) || 100, 80, H - 24);
      const w = clamp(Number(p.w) || 0, 40, W - x - 20);
      const h = clamp(Number(p.h) || 14, 8, 28);
      return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    }).filter(function (p) { return p.w >= 40; });
  }
  function setPlatforms(arr) {
    G.platforms = sanitizePlatforms(arr);
    updateStageDesignerUi();
  }
  function publishPlatforms() {
    if (!G.isHost || Net.state.solo) return;
    Net.broadcast({ t: 'stage', p: G.platforms, design: G.stageDesign });
  }
  function updateStageDesignerUi() {
    const panel = $('stageDesigner');
    if (panel) panel.classList.toggle('hidden', !G.stageDesign);
    ['hud','scoreboard','killfeed','hint','deathOverlay'].forEach(function (id) {
      const el = $(id); if (el) el.classList.toggle('hidden', G.stageDesign);
    });
    const hostControls = $('stageHostControls');
    if (hostControls) hostControls.classList.toggle('hidden', !G.isHost);
    const wait = $('stageWait');
    if (wait) wait.classList.toggle('hidden', G.isHost);
    const count = $('stagePlatformCount');
    if (count) count.textContent = G.platforms.length + (G.platforms.length === 1 ? ' PLATFORM' : ' PLATFORMS');
    const start = $('stageStartRound');
    if (start) start.disabled = !G.isHost || G.platforms.length === 0;
    const help = $('stageDrawHelp');
    if (help) help.textContent = G.isHost ? 'Drag across the arena to draw a platform. Each drag creates one solid horizontal platform. Only the host draws the map.' : 'The host is drawing the arena. Your game will start when the map is confirmed.';
  }
  function relocatePlayersToPlatforms() {
    G.players.forEach(function (p) {
      const spot = spawnPoint();
      p.x = p.tx = spot.x; p.y = p.ty = spot.y; p.vx = p.vy = 0;
      p.grounded = true; p.dead = false; p.hp = p.max; p.rt = 0;
    });
  }
  function startRound() {
    if (!G.isHost || !G.stageDesign || !G.platforms.length) return;
    G.stageDesign = false;
    G.started = true;
    G.stageDrag = null;
    relocatePlayersToPlatforms();
    updateStageDesignerUi();
    if (!Net.state.solo) {
      Net.broadcast({ t: 'stage', p: G.platforms, design: false });
      Net.broadcast({ t: 'roundstart', p: G.platforms });
    }
    // Each human draws their weapon after the stage is locked in.
    pendingInitialDraw = false;
    setTimeout(function () { DrawPad.open(true); }, 100);
  }
  function finishStageDrag() {
    if (!G.stageDesign || !G.isHost || !G.stageDrag) return;
    const d = G.stageDrag; G.stageDrag = null;
    const x1 = clamp(Math.min(d.x, d.ex), 20, W - 40);
    const x2 = clamp(Math.max(d.x, d.ex), 20, W - 20);
    const width = x2 - x1;
    if (width < 44) { updateStageDesignerUi(); return; }
    const y = clamp(d.y, 80, H - 24);
    G.platforms.push({ x: Math.round(x1), y: Math.round(y), w: Math.round(width), h: G.stageThickness });
    G.platforms = sanitizePlatforms(G.platforms);
    updateStageDesignerUi();
    publishPlatforms();
  }
  function allocN() { for (let n = 1; n < 250; n++) if (!G.nUsed.has(n)) { G.nUsed.add(n); return n; } return 250; }
  function removePlayer(id) {
    const p = G.players.get(id); if (!p) return;
    G.nUsed.delete(p.n); G.players.delete(id); G.rosterDirty = true;
  }
  function addPlayer(id, name, bot) {
    const color = PALETTE[G.players.size % PALETTE.length];
    const old = G.players.get(id); if (old) G.nUsed.delete(old.n);
    const p = blankPlayer(id, name, color);
    p.n = allocN(); G.rosterDirty = true;
    p.bot = !!bot;
    const s = spawnPoint(); p.x = p.tx = s.x; p.y = p.ty = s.y;
    if (bot) p.weapon = randomWeapon();
    G.players.set(id, p);
    return p;
  }
  function randomWeapon() { return WEAPON_ORDER[Math.floor(Math.random() * WEAPON_ORDER.length)]; }
  function setBots(on) {
    G.botsOn = !!on;
    const bots = [];
    G.players.forEach(function (p) { if (p.bot) bots.push(p.id); });
    bots.forEach(function (id) { removePlayer(id); });
    const count = G.botsOn ? Math.max(0, Math.min(12, Math.round(Settings.aiCount || 0))) : 0;
    for (let i = 0; i < count; i++) addPlayer('bot' + (G.nextId++), BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? '-' + (i + 1) : ''), true);
    const b = $('botsToggle'); if (b) { b.textContent = 'AI: ' + count; b.classList.toggle('on', G.botsOn && count > 0); }
  }
  function respawn(p) {
    const s = spawnPoint();
    p.x = s.x; p.y = s.y; p.vx = p.vy = 0; p.hp = p.max; p.dead = false; p.cd = 0.5;
    // A short shield window gives the human pilot time to draw the next weapon.
    p.shieldT = p.bot ? 0 : 4; p.shieldAge = 0;
    if (p.bot) p.weapon = randomWeapon();
  }

  /* ------------------------------------------------------------------ */
  /* damage + combat (host authority)                                    */
  /* ------------------------------------------------------------------ */
  function kill(t, ownerId) {
    t.dead = true; t.hp = 0; t.rt = 3; t.deaths++; t.vx = t.vy = 0; t.shieldT = 0;
    const o = G.players.get(ownerId);
    if (o && o !== t) o.score++;
    ev({ k: 'death', x: t.x, y: t.y, c: t.color });
    ev({ k: 'kill', v: t.name, b: o && o !== t ? o.name : null });
  }
  /* srcA = angle from the victim toward the attacker (null = unblockable) */
  function dealDamage(t, amt, srcA, ownerId, crit) {
    if (t.dead) return false;
    if (G.attract && t.id === G.myId) return false;
    if (t.shieldT > 0 && srcA !== null && Math.abs(angDiff(t.a, srcA)) < 1.25) {
      ev({ k: 'block', x: t.x + Math.cos(t.a) * 40, y: t.y + Math.sin(t.a) * 40 });
      return false;
    }
    t.hp -= amt;
    ev({ k: 'hit', x: t.x, y: t.y - 14, a: Math.round(amt), c: crit ? 1 : 0 });
    if (t.hp <= 0) kill(t, ownerId);
    return true;
  }
  function meleeHit(p, range, arc, dmg, kb) {
    const ox = p.x, oy = p.y - CY; let hits = 0;
    G.players.forEach(function (t) {
      if (t === p || t.dead) return;
      const dx = t.x - ox, dy = (t.y - CY) - oy, d = Math.hypot(dx, dy);
      if (d > range + 14) return;
      const ang = Math.atan2(dy, dx);
      if (Math.abs(angDiff(p.a, ang)) > arc / 2 && d > 18) return;
      if (dealDamage(t, dmg, Math.atan2(-dy, -dx), p.id, false)) {
        t.vx += Math.cos(ang) * kb; t.vy += Math.sin(ang) * kb * 0.6 - 60; t.grounded = false; hits++;
      }
    });
    return hits;
  }

  function spawnProj(o) {
    o.id = G.nextId++; o.dist = 0; G.proj.push(o); return o;
  }
  function chainLightning(p, w) {
    const ox = p.x, oy = p.y - CY, pts = [ox, oy], used = {}; used[p.id] = 1;
    let first = null, bs = 1e9;
    G.players.forEach(function (t) {
      if (t === p || t.dead) return;
      const dx = t.x - ox, dy = (t.y - CY) - oy, d = Math.hypot(dx, dy);
      if (d > w.range) return;
      const df = Math.abs(angDiff(p.a, Math.atan2(dy, dx)));
      if (df > 0.95) return;
      const sc = d * (1 + df * 1.6); if (sc < bs) { bs = sc; first = t; }
    });
    if (!first) { pts.push(ox + Math.cos(p.a) * 230, oy + Math.sin(p.a) * 230); return pts; }
    let cur = first, lx = ox, ly = oy;
    for (let i = 0; i < w.chain && cur; i++) {
      const cy = cur.y - CY;
      used[cur.id] = 1; pts.push(cur.x, cy);
      dealDamage(cur, w.dmg * [1, 0.8, 0.6][i], Math.atan2(ly - cy, lx - cur.x), p.id, false);
      lx = cur.x; ly = cy;
      let nxt = null, nd = 175;
      G.players.forEach(function (t) {
        if (t.dead || used[t.id]) return;
        const d = Math.hypot(t.x - lx, (t.y - CY) - ly); if (d < nd) { nd = d; nxt = t; }
      });
      cur = nxt;
    }
    return pts;
  }
  function tryFire(p) {
    if (p.cd > 0 || p.dead) return;
    const w = WEAPONS[p.weapon], a = p.a, ca = Math.cos(a), sa = Math.sin(a);
    const ox = p.x, oy = p.y - CY, mx = ox + ca * 18, my = oy + sa * 18;
    if (p.weapon === 'boomerang') {                       /* one boomerang in the air at a time */
      for (let i = 0; i < G.proj.length; i++) if (G.proj[i].ty === 'boom' && G.proj[i].o === p.id) return;
    }
    p.cd = w.cd;
    switch (p.weapon) {
      case 'gun':
        spawnProj({ ty: 'bullet', x: mx, y: my, vx: ca * w.speed, vy: sa * w.speed, a: a, o: p.id, life: 1.3, bounces: 1, r: 3, dmg: w.dmg });
        ev({ k: 'shot', x: mx, y: my, a: a, w: 'gun' });
        break;
      case 'bow':
        spawnProj({ ty: 'arrow', x: mx, y: my, vx: ca * w.speed, vy: sa * w.speed, a: a, o: p.id, life: 1.7, bounces: 0, r: 3, dmg: w.dmg });
        ev({ k: 'shot', x: mx, y: my, a: a, w: 'bow', s: 1 });
        break;
      case 'staff':
        spawnProj({ ty: 'orb', x: mx, y: my, vx: ca * w.speed, vy: sa * w.speed, a: a, o: p.id, life: 4.5, bounces: 0, r: 8, dmg: w.dmg, homing: 3.2, el: ELEMS[Math.floor(Math.random() * ELEMS.length)] });
        ev({ k: 'shot', x: mx, y: my, a: a, w: 'staff' });
        break;
      case 'shuriken':
        for (let i = -1; i <= 1; i++) {
          const aa = a + i * 0.34 + rnd(-0.06, 0.06);
          spawnProj({ ty: 'star', x: mx, y: my, vx: Math.cos(aa) * w.speed, vy: Math.sin(aa) * w.speed, a: aa, o: p.id, life: 1.5, bounces: 2, r: 6, dmg: w.dmg });
        }
        ev({ k: 'shot', x: mx, y: my, a: a, w: 'shuriken' });
        break;
      case 'boomerang':
        spawnProj({ ty: 'boom', x: mx, y: my, vx: ca * w.speed, vy: sa * w.speed, a: a, o: p.id, life: 3.4, r: 9, dmg: w.dmg, phase: 0, t: 0, hit: {} });
        ev({ k: 'shot', x: mx, y: my, a: a, w: 'boomerang' });
        break;
      case 'bomb':
        spawnProj({ ty: 'bomb', x: mx, y: my, vx: ca * w.speed + p.vx * 0.4, vy: sa * w.speed - 140, a: 0, o: p.id, life: 4, r: 9, dmg: w.dmg, fuse: 1.7 });
        ev({ k: 'shot', x: mx, y: my, a: a, w: 'bomb' });
        break;
      case 'cyclone':
        spawnProj({ ty: 'twister', x: ox + (ca >= 0 ? 1 : -1) * 26, y: p.y - 28, vx: (ca >= 0 ? 1 : -1) * w.speed, vy: 0, a: 0, o: p.id, life: 3.6, r: 46, dmg: w.dmg, tick: 0 });
        ev({ k: 'shot', x: ox, y: oy, a: a, w: 'cyclone' });
        break;
      case 'lightning': {
        const pts = chainLightning(p, w);
        ev({ k: 'bolt', p: pts.map(function (v) { return Math.round(v); }), c: w.color });
        break;
      }
      case 'sword':
        meleeHit(p, w.range, w.arc, w.dmg, 180);
        p.swing = (p.swing || 0) ^ 1;          /* alternate crescent / streak slashes */
        ev({ k: 'slash', x: ox, y: oy, a: a, r: w.range, arc: w.arc, w: 'sword', c: w.color, v: p.swing });
        break;
      case 'axe':
        meleeHit(p, w.range, w.arc, w.dmg, 520);
        ev({ k: 'slash', x: ox, y: oy, a: a, r: w.range, arc: w.arc, w: 'axe', c: w.color });
        ev({ k: 'shake', m: 18, x: p.x, y: p.y });
        break;
      case 'spear':
        meleeHit(p, w.range, w.arc, w.dmg, 250);          /* narrow cone: pierces every foe in line */
        ev({ k: 'thrust', x: ox, y: oy, a: a, r: w.range, c: w.color });
        break;
      case 'whip': {
        let tgt = null, bd = 1e9;
        G.players.forEach(function (t) {
          if (t === p || t.dead) return;
          const dx = t.x - ox, dy = (t.y - CY) - oy, d = Math.hypot(dx, dy);
          if (d > w.range + 14 || Math.abs(angDiff(a, Math.atan2(dy, dx))) > w.arc / 2 + 0.12) return;
          if (d < bd) { bd = d; tgt = t; }
        });
        let reach = w.range;
        if (tgt) {
          reach = Math.max(30, bd);
          if (dealDamage(tgt, w.dmg, Math.atan2(oy - (tgt.y - CY), ox - tgt.x), p.id, false)) {
            const dx = ox - tgt.x, d = Math.max(1, Math.abs(dx));
            tgt.vx += dx / d * 430; tgt.vy -= 140; tgt.grounded = false;     /* yank toward the whipper */
          }
        }
        ev({ k: 'whip', x: ox, y: oy, a: a, r: Math.round(reach), c: w.color });
        break;
      }
      case 'hammer': {
        const cx = p.x + (ca >= 0 ? 1 : -1) * 62, cy = p.y - 8;
        G.players.forEach(function (t) {
          if (t === p || t.dead) return;
          const d = Math.hypot(t.x - cx, (t.y - CY) - cy);
          if (d < 85 + R) { const f = 1 - d / (85 + R) * 0.4; dealDamage(t, w.dmg * f, Math.atan2(p.y - t.y, p.x - t.x), p.id, false); }
        });
        G.waves.push({ id: G.nextId++, x: cx, y: cy, r: 90, life: 3, max: 3, o: p.id });
        ev({ k: 'smash', x: cx, y: cy, r: 90, c: w.color });
        ev({ k: 'shake', m: 12, x: cx, y: cy });
        break;
      }
      case 'shield':
        p.shieldT = w.duration; p.shieldAge = 0;
        meleeHit(p, 72, 2.0, w.dmg, 420);
        ev({ k: 'shield', x: ox, y: oy, a: a, c: w.color });
        break;
      default: break;
    }
  }

  function stepBody(p, dt, inp, w) {
    const ix = (inp.r ? 1 : 0) - (inp.l ? 1 : 0), maxV = 235 * w.speedMul;
    if (ix) { if (!(ix * p.vx >= maxV)) p.vx += ix * 1250 * dt; }
    else p.vx *= Math.exp(-(p.grounded ? 7 : 2.6) * dt);
    if (Math.abs(p.vx) > maxV) p.vx *= Math.exp(-4.5 * dt);          /* knockback bleeds off smoothly instead of being clamped away */
    p.x = clamp(p.x + p.vx * dt, 28, W - 28);

    if (p.dropT > 0) p.dropT -= dt;
    p.coyote = p.grounded ? 0.09 : Math.max(0, p.coyote - dt);       /* brief grace after leaving a ledge */
    const upEdge = inp.u && !p.upPrev; p.upPrev = inp.u ? 1 : 0;
    if (inp.u && p.coyote > 0) { p.vy = JUMP_V; p.coyote = 0; p.grounded = false; p.jumps = 1; }
    else if (upEdge && !p.grounded && p.jumps < 2) { p.vy = JUMP_V * 0.92; p.jumps = 2; }   /* one air jump */

    const wasGrounded = p.grounded, prevY = p.y;
    p.vy = Math.min(TERM_V, p.vy + GRAV * dt);
    p.y += p.vy * dt;
    p.grounded = false;

    const pls = G.platforms;
    if (p.vy >= 0) {
      let land = null;
      if (!pls.length) { if (p.y >= H - 30) land = { y: H - 30 }; }   /* safety floor if a stage has no platforms */
      for (let i = 0; i < pls.length; i++) {
        const pl = pls[i];
        if (p.x < pl.x - 12 || p.x > pl.x + pl.w + 12) continue;
        if (p.dropT > 0 && pl.y <= prevY + 8) continue;             /* dropping through this one */
        const crossed = prevY <= pl.y + 0.75 && p.y >= pl.y;
        const sunk = wasGrounded && prevY > pl.y + 0.75 && prevY < pl.y + 10;   /* nudged into a platform: pop back to the top */
        if ((crossed || sunk) && (!land || pl.y < land.y)) land = pl;
      }
      if (land) {
        p.y = land.y; p.vy = 0; p.grounded = true; p.jumps = 0;
        if (inp.d && !inp.u && pls.length && land.y < floorY() - 2) { p.dropT = 0.3; p.grounded = false; p.y += 2; }
      }
    }
  }
  /* falling out of the arena: small penalty, then back onto a real platform (never into thin air) */
  function fellOff(p) {
    ev({ k: 'void', x: p.x, y: H - 20 });
    p.hp -= 10;
    if (p.hp <= 0) { kill(p, null); return; }
    const s = spawnPoint();
    p.x = s.x; p.y = s.y; p.vx = p.vy = 0; p.grounded = true; p.jumps = 0; p.coyote = 0.09;
    p.shieldT = Math.max(p.shieldT, 1.2); p.shieldAge = 0;
  }
  function updatePlayer(p, dt) {
    if (p.dead) { p.rt -= dt; if (p.rt <= 0) respawn(p); return; }
    const w = WEAPONS[p.weapon], inp = p.inp;
    p.cd = Math.max(0, p.cd - dt); p.shieldT = Math.max(0, p.shieldT - dt); p.shieldAge += dt;
    const ax = inp.mx - p.x, ay = inp.my - (p.y - CY);
    if (ax * ax + ay * ay > 9) p.a = Math.atan2(ay, ax);
    if (Math.abs(Math.cos(p.a)) > 0.05) p.face = Math.cos(p.a) >= 0 ? 1 : -1;
    stepBody(p, dt, inp, w);
    if (p.y > H + 90) { fellOff(p); if (p.dead) return; }
    if (inp.f) tryFire(p);
  }

  /* Players are tall capsules, so they only push each other sideways. Pushing vertically (as v8 did)
     shoved the lower player of a stack down through the platform they were standing on. */
  function separatePlayers() {
    const arr = G.plist;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i]; if (a.dead) continue;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j]; if (b.dead) continue;
        const dy = b.y - a.y; if (dy > 34 || dy < -34) continue;
        const dx = b.x - a.x, ad = Math.abs(dx);
        if (ad >= R * 2) continue;
        const dir = dx === 0 ? (i % 2 ? 1 : -1) : Math.sign(dx), push = (R * 2 - ad) / 2;
        a.x = clamp(a.x - dir * push, 28, W - 28); b.x = clamp(b.x + dir * push, 28, W - 28);
      }
    }
  }

  function explode(p) {
    const w = WEAPONS.bomb, rad = w.radius;
    G.players.forEach(function (t) {
      if (t.dead) return;
      const dx = t.x - p.x, dy = (t.y - CY) - p.y, d = Math.hypot(dx, dy);
      if (d > rad + 14) return;
      const f = 1 - Math.min(1, d / (rad + 14)), nx = d > 1 ? dx / d : 0, ny = d > 1 ? dy / d : -1;
      if (t.id !== p.o) dealDamage(t, w.dmg * (0.45 + 0.55 * f), null, p.o, false);
      t.vx += nx * 560 * (0.4 + f); t.vy += ny * 460 * (0.4 + f) - 220 * f; t.grounded = false;   /* the thrower is flung too: rocket jumps */
    });
    ev({ k: 'boom', x: p.x, y: p.y, r: rad }); ev({ k: 'shake', m: 16, x: p.x, y: p.y });
  }
  function stepBoom(p, dt, list) {
    const owner = G.players.get(p.o);
    p.t += dt; p.a += dt * 22;
    if (p.phase === 0 && p.t > 0.55) { p.phase = 1; p.hit = {}; }
    if (p.phase === 1) {
      if (!owner || owner.dead) return true;
      const dx = owner.x - p.x, dy = (owner.y - CY) - p.y, d = Math.hypot(dx, dy);
      if (d < 26) return true;                                   /* caught */
      const k = Math.min(1, dt * 9);
      p.vx += (dx / d * 760 - p.vx) * k; p.vy += (dy / d * 760 - p.vy) * k;
    } else { const k = Math.exp(-1.1 * dt); p.vx *= k; p.vy *= k; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.dead || t.id === p.o || p.hit[t.id]) continue;
      if (bodyDist(t, p.x, p.y) < HIT_R + p.r) { p.hit[t.id] = 1; dealDamage(t, p.dmg, Math.atan2(-p.vy, -p.vx), p.o, false); }
    }
    return false;
  }
  function stepBomb(p, dt, list) {
    p.fuse -= dt; p.vy += 900 * dt; p.a += dt * 6;
    const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, pl = p.vy > 0 ? platformCross(p.y, ny, nx) : null;
    if (pl) {
      p.x = nx; p.y = pl.y - 1; p.vy = -p.vy * 0.42; p.vx *= 0.78;
      if (Math.abs(p.vy) < 70) p.vy = 0;
      ev({ k: 'wall', x: p.x, y: p.y });
    } else { p.x = nx; p.y = ny; }
    if (p.vy === 0) p.vx *= Math.exp(-4 * dt);
    if (p.fuse <= 0) { explode(p); return true; }
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t.dead && t.id !== p.o && bodyDist(t, p.x, p.y) < HIT_R + p.r) { explode(p); return true; }
    }
    return p.y > H + 150 || p.x < -80 || p.x > W + 80;
  }
  function stepTwister(p, dt, list) {
    p.x += p.vx * dt; p.a += dt * 9; p.tick -= dt;
    const dmgNow = p.tick <= 0; if (dmgNow) p.tick = 0.3;
    const rad = WEAPONS.cyclone.radius;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.dead || t.id === p.o) continue;
      const dx = p.x - t.x, cyT = t.y - CY, d = Math.hypot(dx, p.y - cyT);
      if (d > rad) continue;
      const f = 1 - d / rad;
      t.vx += Math.sign(dx || 1) * 1500 * f * dt;                 /* drag toward the core */
      if (d < 95) { t.vy -= 1750 * f * dt; t.grounded = false; }  /* and lift off the ground */
      if (dmgNow && d < 58) dealDamage(t, p.dmg, null, p.o, false);
    }
    return p.x < -80 || p.x > W + 80;
  }
  function updateProjectiles(dt, list) {
    for (let i = G.proj.length - 1; i >= 0; i--) {
      const p = G.proj[i];
      p.life -= dt;
      let remove = false;
      if (p.life <= 0) {
        if (p.ty === 'orb') ev({ k: 'impact', x: p.x, y: p.y, el: p.el });
        if (p.ty === 'bomb') explode(p);
        G.proj.splice(i, 1); continue;
      }
      if (p.ty === 'boom') remove = stepBoom(p, dt, list);
      else if (p.ty === 'bomb') remove = stepBomb(p, dt, list);
      else if (p.ty === 'twister') remove = stepTwister(p, dt, list);
      else {
        if (p.homing) {
          let best = null, bd = 420;
          for (let k = 0; k < list.length; k++) {
            const t = list[k]; if (t.dead || t.id === p.o) continue;
            const d = Math.hypot(t.x - p.x, (t.y - CY) - p.y); if (d < bd) { bd = d; best = t; }
          }
          if (best) {
            const cur = Math.atan2(p.vy, p.vx), want = Math.atan2((best.y - CY) - p.y, best.x - p.x);
            const turn = clamp(angDiff(cur, want), -p.homing * dt, p.homing * dt), sp0 = Math.hypot(p.vx, p.vy);
            p.vx = Math.cos(cur + turn) * sp0; p.vy = Math.sin(cur + turn) * sp0;
          }
        }
        const sp = Math.hypot(p.vx, p.vy), steps = Math.max(1, Math.ceil(sp * dt / 6)), sdt = dt / steps;
        for (let s = 0; s < steps && !remove; s++) {
          const nx = p.x + p.vx * sdt, ny = p.y + p.vy * sdt;
          p.dist += sp * sdt;
          const pl = p.vy > 0 ? platformCross(p.y, ny, nx) : null;
          if (pl) {                                              /* platform tops stop or ricochet shots */
            ev({ k: 'wall', x: nx, y: pl.y });
            if (p.bounces > 0) { p.vy = -p.vy; p.bounces--; p.a = Math.atan2(p.vy, p.vx); p.x = nx; p.y = pl.y - 1; continue; }
            remove = true; break;
          }
          p.x = nx; p.y = ny;
          for (let k = 0; k < list.length; k++) {
            const t = list[k];
            if (t.dead || t.id === p.o || bodyDist(t, p.x, p.y) >= HIT_R + p.r) continue;
            let dmg = p.dmg, crit = false;
            if (p.ty === 'arrow') {
              dmg = 14 + Math.min(p.dist, 1100) * 0.055;
              if (p.dist > 420) { dmg *= 1.45; crit = true; }
              dmg = Math.min(80, dmg);
            }
            dealDamage(t, dmg, Math.atan2(-p.vy, -p.vx), p.o, crit);
            remove = true; break;
          }
        }
        if (!remove && (p.x < -60 || p.x > W + 60 || p.y < -240 || p.y > H + 140)) remove = true;
      }
      if (remove) { if (p.ty === 'orb') ev({ k: 'impact', x: p.x, y: p.y, el: p.el }); G.proj.splice(i, 1); }
    }
  }

  function updateWaves(dt) {
    for (let i = G.waves.length - 1; i >= 0; i--) { G.waves[i].life -= dt; if (G.waves[i].life <= 0) G.waves.splice(i, 1); }
  }

  /* simple bot brain: chase / kite the nearest living opponent */
  function botThink(p, dt, list) {
    const inp = p.inp;
    if (p.dead) { inp.f = 0; return; }
    let tgt = null, bd = 1e9;
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      if (q === p || q.dead || (G.attract && q.id === G.myId)) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; tgt = q; }
    }
    inp.u = inp.d = inp.l = inp.r = inp.f = 0;
    if (!tgt) return;
    const ranged = !!RANGED_AI[p.weapon], w = WEAPONS[p.weapon];
    const dxT = tgt.x - p.x, dyT = (tgt.y - CY) - (p.y - CY);
    let ang = Math.atan2(dyT, dxT);
    if (p.weapon === 'bomb') ang -= Math.min(0.5, bd / 900);            /* lob it */
    p.ai.t -= dt;
    if (p.ai.t <= 0) { p.ai.t = rnd(0.6, 1.8); p.ai.strafe = Math.random() < 0.5 ? 1 : -1; p.ai.err = rnd(-0.14, 0.14); }
    const reachW = w.range || 80;
    const pref = ranged ? (p.weapon === 'lightning' ? 220 : 260) : (p.weapon === 'hammer' ? 70 : Math.min(reachW * 0.75, 140));
    let mvx = 0;
    if (Math.abs(dxT) > pref + 30) mvx = Math.sign(dxT);
    else if (ranged && Math.abs(dxT) < pref - 70) mvx = -Math.sign(dxT);
    else mvx = p.ai.strafe * 0.5;
    /* do not stroll off the platform it is standing on */
    if (p.grounded && G.platforms.length) {
      let onP = null;
      for (let i = 0; i < G.platforms.length; i++) { const pl = G.platforms[i]; if (Math.abs(pl.y - p.y) < 3 && p.x >= pl.x - 6 && p.x <= pl.x + pl.w + 6) { onP = pl; break; } }
      if (onP && ((mvx < 0 && p.x < onP.x + 26) || (mvx > 0 && p.x > onP.x + onP.w - 26)) && tgt.y >= p.y - 40) mvx = 0;
    }
    inp.l = mvx < -0.25 ? 1 : 0; inp.r = mvx > 0.25 ? 1 : 0;
    inp.u = ((tgt.y < p.y - 55 && p.grounded && Math.random() < 0.05) || (p.y > floorY() + 20 && Math.random() < 0.3)) ? 1 : 0;
    inp.mx = p.x + Math.cos(ang + p.ai.err) * 200; inp.my = (p.y - CY) + Math.sin(ang + p.ai.err) * 200;
    const reach = ranged ? (p.weapon === 'lightning' ? w.range - 30 : 560) : reachW + 22;
    inp.f = (bd < reach) ? 1 : 0;
  }

  function hostStep(dt) {
    const list = G.plist; list.length = 0;
    G.players.forEach(function (p) { list.push(p); });
    for (let i = 0; i < list.length; i++) if (list[i].bot) botThink(list[i], dt, list);
    for (let i = 0; i < list.length; i++) updatePlayer(list[i], dt);
    separatePlayers();
    updateProjectiles(dt, list);
    updateWaves(dt);
    const evs = G.events; G.events = [];
    for (let i = 0; i < evs.length; i++) handleEvent(evs[i]);
    if (Net.peerCount() > 0) { for (let i = 0; i < evs.length; i++) G.pending.push(evs[i]); }
  }

  /* ------------------------------------------------------------------ */
  /* network glue                                                        */
  /* ------------------------------------------------------------------ */
  function r1(v) { return Math.round(v * 10) / 10; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }
  /* compact wire format: players are arrays keyed by a small integer (names/colours travel in the roster) */
  function buildSnapshot() {
    const ps = [], pr = [], sw = [];
    G.players.forEach(function (p) {
      ps.push([p.n, r1(p.x), r1(p.y), Math.round(p.vx), Math.round(p.vy), r2(p.a), Math.round(p.hp), WEAPON_ORDER.indexOf(p.weapon), r2(p.cd), r2(p.shieldT),
        (p.dead ? 1 : 0) | (p.grounded ? 2 : 0) | (p.face < 0 ? 4 : 0), Math.round(p.rt * 10) / 10, p.score, p.deaths, r2(p.shieldAge)]);
    });
    for (let i = 0; i < G.proj.length; i++) {
      const q = G.proj[i], on = G.players.get(q.o);
      const ex = q.ty === 'orb' ? ELEMS.indexOf(q.el) : q.ty === 'arrow' ? (q.dist > 420 ? 1 : 0) : q.ty === 'bomb' ? Math.max(0, Math.round(q.fuse * 10)) : 0;
      pr.push([q.id, PROJ_TYPES.indexOf(q.ty), r1(q.x), r1(q.y), r2(q.a), on ? on.n : 0, ex]);
    }
    for (let i = 0; i < G.waves.length; i++) { const q = G.waves[i]; sw.push([q.id, q.x, q.y, q.r, Math.round(q.life * 10) / 10, q.max]); }
    const snap = { t: 's', k: G.tick++, p: ps, pr: pr, sw: sw, ev: G.pending };
    G.pending = [];
    return snap;
  }
  function rosterArray() {
    const r = []; G.players.forEach(function (p) { r.push([p.n, p.id, p.id === G.myId ? 'HOST' : p.name, p.color, p.bot ? 1 : 0]); }); return r;
  }
  function sendRoster(to) {
    const msg = { t: 'roster', r: rosterArray() };
    if (to) Net.sendTo(to, msg); else Net.broadcast(msg);
    G.rosterDirty = false;
  }
  function applyRoster(arr) {
    if (!Array.isArray(arr)) return;
    G.roster.clear();
    arr.forEach(function (a) {
      const r = { n: a[0], id: a[1], name: a[1] === G.myId ? 'YOU' : a[2], color: a[3], bot: !!a[4] }; G.roster.set(r.n, r);
      const p = G.players.get(r.id); if (p) { p.name = r.name; p.color = r.color; p.bot = r.bot; p.n = r.n; }
    });
  }
  function predictOn() {
    const p = me();
    return Settings.predict !== false && !G.isHost && G.started && !G.stageDesign && !!p && !p.dead;
  }

  function applySnapshot(s) {
    const now = performance.now(), seen = {}, pm = {};
    if (G.lastSnapT) { const gap = now - G.lastSnapT; G.snapEma += (Math.min(gap, 400) - G.snapEma) * 0.1; G.interpDelay = clamp(G.snapEma * 2.3, 70, 200); }
    G.lastSnapT = now;
    const predicting = predictOn();
    for (let i = 0; i < s.p.length; i++) {
      const d = s.p[i], r = G.roster.get(d[0]); if (!r) continue;
      seen[r.id] = 1;
      let p = G.players.get(r.id);
      if (!p) { p = blankPlayer(r.id, r.name, r.color); p.n = d[0]; p.x = p.tx = d[1]; p.y = p.ty = d[2]; G.players.set(r.id, p); }
      p.name = r.name; p.color = r.color; p.bot = r.bot;
      const fl = d[10], wasDead = p.dead;
      p.a = d[5]; p.hp = d[6]; p.weapon = WEAPON_ORDER[d[7]] || 'gun'; p.cd = d[8]; p.shieldT = d[9];
      p.dead = !!(fl & 1); p.face = (fl & 4) ? -1 : 1; p.rt = d[11]; p.score = d[12]; p.deaths = d[13]; p.shieldAge = d[14];
      pm[r.id] = { x: d[1], y: d[2], vx: d[3], vy: d[4] };
      if (r.id === G.myId) {
        if (predicting && !wasDead && !p.dead) {
          /* reconcile the locally predicted body with the host: gentle pull, hard snap on big divergence (hits, respawns) */
          const lag = (G.rtt || 50) / 2000, ex = d[1] + d[3] * SIM_SCALE * lag, errx = ex - p.x, erry = d[2] - p.y, err = Math.hypot(errx, erry);
          if (err > 90 || (Math.abs(d[3] - p.vx) > 300 && err > 20)) { p.x = d[1]; p.y = d[2]; p.vx = d[3]; p.vy = d[4]; p.grounded = !!(fl & 2); }
          else { p.x += errx * 0.18; if (Math.abs(erry) > 14) p.y += erry * 0.08; p.vx += (d[3] - p.vx) * 0.1; }
        } else if (!predicting) { p.vx = d[3]; p.vy = d[4]; }
      }
    }
    const gone = []; G.players.forEach(function (p, id) { if (!seen[id]) gone.push(id); });
    gone.forEach(function (id) { G.players.delete(id); });
    const prm = {};
    for (let i = 0; i < s.pr.length; i++) prm[s.pr[i][0]] = s.pr[i];
    G.snaps.push({ t: now, pm: pm, pr: s.pr, prm: prm });
    if (G.snaps.length > 10) G.snaps.shift();
    G.waves = s.sw.map(function (q) { return { id: q[0], x: q[1], y: q[2], r: q[3], life: q[4], max: q[5] }; });
    for (let i = 0; i < s.ev.length; i++) handleEvent(s.ev[i]);
    G.lastSnap = now;
  }

  function getInput() {
    const m = G.mouse;
    if (G.stageDesign) return { t: 'in', mx: Math.round(m.x), my: Math.round(m.y), u: 0, d: 0, l: 0, r: 0, f: 0 };
    const l = keyDown('moveLeft') ? 1 : 0, r = keyDown('moveRight') ? 1 : 0;
    let mx = Math.round(m.x), my = Math.round(m.y);
    if (Settings.aimMouse === false) {                       /* "facing" aim: always attack horizontally in the facing direction */
      const p = me(); let f = p ? (p.face || 1) : 1;
      if (r && !l) f = 1; else if (l && !r) f = -1;
      mx = Math.round((p ? p.x : W / 2) + f * 200); my = Math.round((p ? p.y : H / 2) - CY);
    }
    return {
      t: 'in', mx: mx, my: my, u: keyDown('moveUp') ? 1 : 0, d: keyDown('moveDown') ? 1 : 0, l: l, r: r,
      f: ((m.down && !G.paint) || keyDown('fire')) && !G.modalOpen ? 1 : 0
    };
  }

  function equipWeapon(type, result, artwork) {
    if (!WEAPONS[type]) return;
    if (G.isHost) {
      const p = me(); if (!p) return;
      p.weapon = type; p.cd = 0.3;
      if (artwork) { setWeaponArt(p.id, artwork); if (!Net.state.solo) Net.broadcast({ t: 'weaponart', id: p.id, art: artwork }); }
      ev({ k: 'equip', id: p.id });
    } else Net.sendHost({ t: 'equip', w: type, art: artwork || null });
  }

  function setupNet() {
    Net.on('ready', function (info) {
      // Switching from solo to multiplayer (or back) starts a clean run.
      G.players.clear(); G.proj = []; G.waves = []; G.events = []; G.pending = []; G.snaps = []; G.roster.clear(); G.nUsed.clear();
      G.weaponArts.clear(); G.weaponArtImages.clear();
      G.isHost = info.host; G.myId = info.id; G.started = true;
      G.stageDesign = true;
      G.platforms = [];
      lastSelfDead = null; simAcc = 0; G.lastSnapT = 0; G.rtt = 0;
      const tag = $('hostTag');
      if (info.host) {
        buildDefaultMap();
        addPlayer(G.myId, 'YOU', false);
        setBots(true);
        if (tag) { tag.textContent = 'HOST'; tag.classList.remove('guest'); }
        updateStageDesignerUi();
      } else {
        $('connecting').classList.remove('hidden');
        if (tag) { tag.textContent = 'GUEST'; tag.classList.add('guest'); }
        setPaintEnabled(false);
        updateStageDesignerUi();
      }
      // Initial weapon drawing is deliberately deferred until the host confirms the map.
    });
    Net.on('peerJoin', function (_, id) {
      if (!G.isHost) return;
      const p = addPlayer(id, 'PILOT-' + id.slice(0, 4).toUpperCase(), false);
      p.lastIn = performance.now();
      Net.sendTo(id, { t: 'welcome', id: id, map: mapToString(), platforms: G.platforms, stageDesign: G.stageDesign, roster: rosterArray() });
      /* weapon art goes out one small message at a time so no single message can hit the data-channel size limit */
      let delay = 200; G.weaponArts.forEach(function (art, aid) { setTimeout(function () { Net.sendTo(id, { t: 'weaponart', id: aid, art: art }); }, delay); delay += 120; });
      G.rosterDirty = true;
      pushKill(p.name + ' joined the grid');
    });
    Net.on('peerLeave', function (_, id) {
      if (!G.isHost) return;
      const p = G.players.get(id);
      if (p) { pushKill(p.name + ' left the grid'); removePlayer(id); }
    });
    Net.on('in', function (d, from) {
      if (!G.isHost) return;
      const p = G.players.get(from); if (!p) return;
      p.lastIn = performance.now();
      if (G.stageDesign) return;
      const i = p.inp;
      i.mx = clamp(+d.mx || 0, 0, W); i.my = clamp(+d.my || 0, 0, H);
      i.u = d.u ? 1 : 0; i.d = d.d ? 1 : 0; i.l = d.l ? 1 : 0; i.r = d.r ? 1 : 0; i.f = d.f ? 1 : 0;
    });
    Net.on('bye', function (d, from) { if (G.isHost) Net.drop(from); });
    Net.on('ping', function (d, from) {
      if (!G.isHost) return;
      const p = G.players.get(from); if (p) p.lastIn = performance.now();
      Net.sendTo(from, { t: 'pong', c: d && d.c });
    });
    Net.on('pong', function (d) {
      if (G.isHost || !d || typeof d.c !== 'number') return;
      const rtt = performance.now() - d.c; if (rtt < 0 || rtt > 5000) return;
      G.rtt = G.rtt ? G.rtt + (rtt - G.rtt) * 0.3 : rtt;
      Net.setQuality(Math.round(G.rtt));
    });
    Net.on('roster', function (d) { if (!G.isHost && d) applyRoster(d.r); });
    Net.on('equip', function (d, from) {
      if (!G.isHost || !WEAPONS[d.w]) return;
      const p = G.players.get(from); if (!p) return;
      p.weapon = d.w; p.cd = 0.3;
      if (typeof d.art === 'string') { setWeaponArt(p.id, d.art); if (!Net.state.solo) Net.broadcast({ t: 'weaponart', id: p.id, art: d.art }); }
      ev({ k: 'equip', id: p.id });
    });
    Net.on('weaponart', function (d) { if (!G.isHost && d && d.id && d.art) setWeaponArt(d.id, d.art); });
    Net.on('welcome', function (d) {
      if (G.isHost) return;
      G.myId = d.id; mapFromString(d.map);
      applyRoster(d.roster);
      setPlatforms(d.platforms || []);
      G.stageDesign = d.stageDesign !== false;
      (d.arts || []).forEach(function (a) { if (a && a.id && a.art) setWeaponArt(a.id, a.art); });
      $('connecting').classList.add('hidden');
      updateStageDesignerUi();
      if (!G.stageDesign) setTimeout(function () { DrawPad.open(true); }, 100);
    });
    Net.on('stage', function (d) {
      if (G.isHost || !d) return;
      setPlatforms(d.p || []);
      if (typeof d.design === 'boolean') G.stageDesign = d.design;
      updateStageDesignerUi();
    });
    Net.on('roundstart', function (d) {
      if (G.isHost) return;
      if (d && d.p) setPlatforms(d.p);
      G.stageDesign = false; G.started = true; G.stageDrag = null;
      updateStageDesignerUi();
      setTimeout(function () { DrawPad.open(true); }, 100);
    });
    Net.on('map', function (d) {
      if (G.isHost) return;
      const c = d.c;
      for (let i = 0; i + 1 < c.length; i += 2) { const idx = c[i]; if (idx > 0 && idx < G.map.length) G.map[idx] = c[i + 1]; }
    });
    Net.on('mapfull', function (d) { if (!G.isHost) mapFromString(d.m); });
    Net.on('s', function (d) { if (!G.isHost) { applySnapshot(d); $('connecting').classList.add('hidden'); } });
    Net.on('hostLeft', function () { G.players.clear(); G.proj = []; G.waves = []; G.snaps = []; $('connecting').textContent = 'HOST DISCONNECTED'; $('connecting').classList.remove('hidden'); });
  }

  /* ------------------------------------------------------------------ */
  /* audio                                                               */
  /* ------------------------------------------------------------------ */
  let actx = null; const lastSfx = {};
  function audio() {
    if (actx === null) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = false; } }
    return actx || null;
  }
  function tone(f, dur, type, vol, slide) {
    const a = audio(); if (!a) return;
    vol *= Settings.vol / 100; if (vol < 0.0005) return;
    const o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime;
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur);
  }
  function sfx(k) {
    const now = performance.now();
    if (lastSfx[k] && now - lastSfx[k] < 45) return;
    lastSfx[k] = now;
    switch (k) {
      case 'gun': tone(780, 0.09, 'square', 0.04, 0.35); break;
      case 'staff': tone(300, 0.25, 'sine', 0.06, 2.2); break;
      case 'shuriken': tone(1100, 0.12, 'triangle', 0.04, 0.5); break;
      case 'sword': tone(500, 0.12, 'sawtooth', 0.035, 0.4); break;
      case 'axe': tone(180, 0.28, 'sawtooth', 0.07, 0.4); break;
      case 'hammer': tone(90, 0.4, 'square', 0.1, 0.3); break;
      case 'shield': tone(240, 0.3, 'sine', 0.06, 2.4); break;
      case 'hit': tone(200, 0.08, 'square', 0.04, 0.6); break;
      case 'block': tone(1400, 0.1, 'triangle', 0.05, 0.7); break;
      case 'death': tone(140, 0.5, 'sawtooth', 0.07, 0.25); break;
      case 'spear': tone(620, 0.1, 'sawtooth', 0.04, 0.5); break;
      case 'whip': tone(900, 0.13, 'sawtooth', 0.03, 0.3); break;
      case 'lightning': tone(1500, 0.2, 'sawtooth', 0.05, 0.22); break;
      case 'boomerang': tone(480, 0.16, 'triangle', 0.04, 1.6); break;
      case 'bomb': tone(260, 0.1, 'square', 0.04, 0.7); break;
      case 'boom': tone(70, 0.5, 'sawtooth', 0.12, 0.3); break;
      case 'cyclone': tone(200, 0.45, 'sine', 0.06, 1.8); break;
      case 'void': tone(320, 0.45, 'triangle', 0.05, 0.2); break;
      case 'equip': tone(520, 0.1, 'square', 0.04, 1.6); setTimeout(function () { tone(780, 0.14, 'square', 0.04, 1.4); }, 90); break;
      default: break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* effects                                                             */
  /* ------------------------------------------------------------------ */
  function burst(x, y, col, n, speed, life, size) {
    n = Math.round(n * Settings.fx / 100 * G.quality);
    if (n <= 0 || G.parts.length > 700) return;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), s = rnd(0.25, 1) * speed;
      G.parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * rnd(0.6, 1), max: life, size: size || rnd(1.5, 3.2), col: col });
    }
  }
  function floatText(x, y, text, col, size) { G.texts.push({ x: x, y: y, text: text, col: col, size: size || 14, life: 0.9, max: 0.9 }); }
  function shakeNear(x, y, mag) {
    const m = me(), d = m ? Math.hypot(m.x - x, m.y - y) : 300;
    G.shake = Math.min(26, Math.max(G.shake, mag * Settings.shake / 100 * clamp(1 - d / 900, 0.25, 1)));
  }
  function pushKill(text) {
    G.killfeed.push({ text: text, t: 5 });
    if (G.killfeed.length > 5) G.killfeed.shift();
    renderKillfeed();
  }
  function renderKillfeed() {
    const el = $('killfeed'); el.innerHTML = '';
    G.killfeed.forEach(function (k) {
      const d = document.createElement('div'); d.className = 'kf' + (k.t < 0.6 ? ' fade' : ''); d.textContent = k.text; el.appendChild(d);
    });
  }

  function handleEvent(e) {
    switch (e.k) {
      case 'hit':
        floatText(e.x, e.y, String(e.a) + (e.c ? '!' : ''), e.c ? '#ffe14d' : '#ffffff', e.c ? 20 : 14);
        burst(e.x, e.y + 14, '#ff5470', 8, 170, 0.4); shakeNear(e.x, e.y, e.c ? 7 : 3); sfx('hit');
        if (e.c) addSpr('lightning', e.x, e.y + 8, 0, 0.8, 0.4);
        break;
      case 'block':
        burst(e.x, e.y, '#7df9ff', 12, 240, 0.35); floatText(e.x, e.y - 10, 'BLOCKED', '#7df9ff', 12); sfx('block'); break;
      case 'shot':
        burst(e.x + Math.cos(e.a) * 4, e.y + Math.sin(e.a) * 4, WEAPONS[e.w].color, 4, 120, 0.18, 2);
        if (!e.s) sfx(e.w); break;
      case 'slash': {
        const axe = e.w === 'axe', dx = Math.cos(e.a), dy = Math.sin(e.a);
        G.fx.push({ k: 'arc', x: e.x, y: e.y, a: e.a, r: e.r, arc: e.arc, life: axe ? 0.32 : 0.2, max: axe ? 0.32 : 0.2, c: e.c, wide: axe ? 12 : 6 });
        if (!axe && e.v) addSpr('streak', e.x + dx * e.r * 0.5, e.y + dy * e.r * 0.5, e.a + 0.5, e.r * 2 / 175, 0.22);
        else addSpr('crescent', e.x + dx * e.r * 0.55, e.y + dy * e.r * 0.55, e.a, axe ? 1.9 : 1.15, axe ? 0.34 : 0.22);
        sfx(e.w); break;
      }
      case 'smash':
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: e.r, life: 0.45, max: 0.45, c: e.c });
        burst(e.x, e.y, e.c, 34, 320, 0.7, 3); sfx('hammer');
        addSpr('rock', e.x, e.y, 0, 1.9, 0.6);
        break;
      case 'shield': sfx('shield'); addSpr('wind', e.x, e.y, 0, 1.5, 0.5); break;
      case 'impact': addSpr(e.el || 'fire', e.x, e.y, 0, e.el === 'fire' ? 0.8 : 0.9, 0.5); burst(e.x, e.y, ELEM_COL[e.el] || '#fff', 10, 180, 0.4, 2.4); break;
      case 'wall': burst(e.x, e.y, '#ffcf6b', 5, 130, 0.25, 2); break;
      case 'shake': shakeNear(e.x, e.y, e.m); break;
      case 'death':
        burst(e.x, e.y, e.c, 46, 360, 0.9, 3.4); burst(e.x, e.y, '#ffffff', 14, 240, 0.5, 2); shakeNear(e.x, e.y, 9); sfx('death');
        addSpr('fire', e.x, e.y - 10, 0, 1.1, 0.55); addSpr('lightning', e.x, e.y, 0, 1.0, 0.45);
        break;
      case 'kill': pushKill(e.b ? e.b + '  >  ' + e.v : e.v + ' dissolved'); break;
      case 'equip': {
        const p = G.players.get(e.id);
        if (p) { floatText(p.x, p.y - 34, WEAPONS[p.weapon].name + ' ONLINE', WEAPONS[p.weapon].color, 13); burst(p.x, p.y, WEAPONS[p.weapon].color, 22, 200, 0.6, 2.5); }
        if (e.id === G.myId) sfx('equip');
        break;
      }
      case 'bolt': {
        G.fx.push({ k: 'bolt', pts: e.p, life: 0.24, max: 0.24, c: e.c, seed: Math.floor(rnd(0, 99)) });
        for (let i = 2; i < e.p.length; i += 2) { addSpr('lightning', e.p[i], e.p[i + 1], 0, 0.75, 0.35); burst(e.p[i], e.p[i + 1], '#fff27a', 8, 220, 0.35, 2.2); }
        sfx('lightning'); shakeNear(e.p[0], e.p[1], 3); break;
      }
      case 'whip': G.fx.push({ k: 'whip', x: e.x, y: e.y, a: e.a, r: e.r, life: 0.22, max: 0.22, c: e.c }); sfx('whip'); break;
      case 'thrust': {
        G.fx.push({ k: 'thrust', x: e.x, y: e.y, a: e.a, r: e.r, life: 0.18, max: 0.18, c: e.c });
        addSpr('streak', e.x + Math.cos(e.a) * e.r * 0.5, e.y + Math.sin(e.a) * e.r * 0.5, e.a + 0.5, e.r * 2 / 175, 0.2); sfx('spear'); break;
      }
      case 'boom':
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: e.r, life: 0.4, max: 0.4, c: '#ffb04a' });
        burst(e.x, e.y, '#ff7a2a', 36, 380, 0.7, 3.2); burst(e.x, e.y, '#fff3a0', 14, 260, 0.45, 2.2);
        addSpr('fire', e.x, e.y - 8, 0, 1.9, 0.55); addSpr('rock', e.x, e.y, 0, 1.2, 0.5); sfx('boom'); break;
      case 'void': burst(e.x, e.y, '#7a8bff', 24, 300, 0.7, 3); sfx('void'); break;
      default: break;
    }
  }

  function updateFx(dt) {
    G.shake *= Math.exp(-dt * 8); if (G.shake < 0.2) G.shake = 0;
    for (let i = G.parts.length - 1; i >= 0; i--) {
      const p = G.parts[i]; p.life -= dt;
      if (p.life <= 0) { G.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; const k = Math.exp(-3 * dt); p.vx *= k; p.vy *= k;
    }
    for (let i = G.texts.length - 1; i >= 0; i--) {
      const t = G.texts[i]; t.life -= dt; t.y -= 38 * dt; if (t.life <= 0) G.texts.splice(i, 1);
    }
    for (let i = G.fx.length - 1; i >= 0; i--) { G.fx[i].life -= dt; if (G.fx[i].life <= 0) G.fx.splice(i, 1); }
    for (let i = G.killfeed.length - 1; i >= 0; i--) { G.killfeed[i].t -= dt; }
    if (G.killfeed.length && G.killfeed[0].t <= 0) { G.killfeed.shift(); renderKillfeed(); }
    /* terrain ambience + trails */
    G.players.forEach(function (p) {
      if (p.dead) return;
      const tl = tileAt(p.x, p.y);
      if (tl === T.BOOST && Math.random() < dt * 40) burst(p.x, p.y, '#00f0ff', 1, 60, 0.3, 2);
      else if (tl === T.ACID && Math.random() < dt * 25) burst(p.x, p.y, '#ff4d5e', 1, 50, 0.45, 2.4);
      else if (tl === T.HEAL && Math.random() < dt * 25) { G.parts.push({ x: p.x + rnd(-8, 8), y: p.y + 6, vx: 0, vy: -50, life: 0.6, max: 0.6, size: 2.4, col: '#39ff88' }); }
      else if (tl === T.ICE && Math.hypot(p.vx || 0, p.vy || 0) > 140 && Math.random() < dt * 30) burst(p.x, p.y, '#bfe3ff', 1, 40, 0.3, 1.8);
    });
    G.proj.forEach(function (q) { if (q.ty === 'orb' && Math.random() < dt * 40) burst(q.x, q.y, '#c77dff', 1, 30, 0.3, 2.4); });
  }

  function clientStep(dt, now) {
    const sn = G.snaps, n = sn.length, predicting = predictOn(), mine = me();
    if (mine) {                                                   /* the held weapon follows the mouse instantly */
      const aim = G.localInp;
      if (!mine.dead) { mine.a = Math.atan2(aim.my - (mine.y - CY), aim.mx - mine.x); if (Math.abs(Math.cos(mine.a)) > 0.05) mine.face = Math.cos(mine.a) >= 0 ? 1 : -1; }
    }
    if (!n) return;
    const rt = now - G.interpDelay;
    let A = sn[0], B = sn[0], alpha = 0, extra = 0;
    if (rt >= sn[n - 1].t) { A = B = sn[n - 1]; extra = Math.min(120, rt - sn[n - 1].t) / 1000; }
    else if (rt > sn[0].t) { for (let i = n - 1; i >= 1; i--) if (sn[i - 1].t <= rt) { A = sn[i - 1]; B = sn[i]; alpha = (rt - A.t) / Math.max(1, B.t - A.t); break; } }
    G.players.forEach(function (p) {
      if (predicting && p === mine) return;
      const b = B.pm[p.id]; if (!b) return;
      const a = A.pm[p.id] || b;
      if (Math.abs(b.x - a.x) > 160 || Math.abs(b.y - a.y) > 160) { p.x = b.x; p.y = b.y; }
      else if (extra > 0) { p.x = b.x + b.vx * SIM_SCALE * extra; p.y = b.y; }
      else { p.x = a.x + (b.x - a.x) * alpha; p.y = a.y + (b.y - a.y) * alpha; }
      p.vx = b.vx; p.vy = b.vy;
    });
    const out = [];
    for (let i = 0; i < B.pr.length; i++) {
      const q = B.pr[i], o = A.prm[q[0]] || q, ow = G.roster.get(q[5]), ex = q[6], ty = PROJ_TYPES[q[1]] || 'bullet';
      let x = o[2] + (q[2] - o[2]) * alpha, y = o[3] + (q[3] - o[3]) * alpha;
      if (extra > 0) { x = q[2]; y = q[3]; }
      out.push({ id: q[0], ty: ty, x: x, y: y, a: q[4], o: ow ? ow.id : '', el: ty === 'orb' ? ELEMS[ex] : undefined, f: ex, fuse: ty === 'bomb' ? ex / 10 : 0 });
    }
    G.proj = out;
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                           */
  /* ------------------------------------------------------------------ */
  const gridLayer = document.createElement('canvas'); gridLayer.width = W; gridLayer.height = H;
  (function () {
    const g = gridLayer.getContext('2d'); g.strokeStyle = 'rgba(0,240,255,0.14)'; g.lineWidth = 1; g.beginPath();
    for (let x = 0; x <= W; x += CELL) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += CELL) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
    g.stroke();
  })();
  const bgLayer = document.createElement('canvas'); bgLayer.width = W; bgLayer.height = H;
  (function () {
    const g = bgLayer.getContext('2d');
    const gr = g.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, 760);
    gr.addColorStop(0, '#0f1530'); gr.addColorStop(1, '#05060e'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(120,150,255,0.10)';
    for (let y = 10; y < H; y += CELL) for (let x = 10; x < W; x += CELL) g.fillRect(x, y, 2, 2);
    g.fillStyle = 'rgba(0,0,0,0.16)'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
  })();

  /* The sky + skyline never change and platforms only change when the stage is edited, so both are
     rendered once into offscreen layers (v8 rebuilt a gradient and blurred every platform each frame). */
  const skyLayer = document.createElement('canvas'); skyLayer.width = W; skyLayer.height = H;
  const platLayer = document.createElement('canvas'); platLayer.width = W; platLayer.height = H;
  let platKey = -1;
  (function () {
    const g = skyLayer.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#10102e'); sky.addColorStop(0.62, '#22234a'); sky.addColorStop(1, '#080b19');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 16; i++) { const x = i * 88 - 20, hh = 80 + (i * 47) % 130; g.fillStyle = 'rgba(10,14,39,.8)'; g.fillRect(x, 500 - hh, 62, hh); g.fillStyle = 'rgba(75,104,255,.25)'; for (let yy = 510 - hh; yy < 495; yy += 17) g.fillRect(x + 10, yy, 4, 6); }
  })();
  function platHash() {
    const pls = G.platforms || []; let h = pls.length + 1;
    for (let i = 0; i < pls.length; i++) { const q = pls[i]; h = (h * 31 + q.x * 7 + q.y * 13 + q.w * 17 + q.h * 3) % 1000000007; }
    return h;
  }
  function buildPlatLayer() {
    const g = platLayer.getContext('2d'); g.clearRect(0, 0, W, H);
    (G.platforms || []).forEach(function (p, i) {
      g.fillStyle = '#0a1025'; g.fillRect(p.x, p.y, p.w, p.h);
      g.fillStyle = i === 0 ? '#38f5ff' : '#a66bff'; g.shadowColor = g.fillStyle; g.shadowBlur = 18; g.fillRect(p.x, p.y, p.w, 4); g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(p.x, p.y + 6, p.w, 2); g.fillStyle = 'rgba(4,8,22,.75)'; g.fillRect(p.x, p.y + p.h - 3, p.w, 3);
    });
  }
  function drawTerrain() {
    ctx.drawImage(skyLayer, 0, 0);
    ctx.fillStyle = '#b8d9ff';
    for (let i = 0; i < 48; i++) { const x = (i * 173 + G.time * 8) % W, y = (i * 71) % 430; ctx.globalAlpha = 0.25 + 0.25 * Math.sin(G.time * 1.4 + i); ctx.fillRect(x, y, 2, 2); }
    ctx.globalAlpha = 1;
    const k = platHash();
    if (k !== platKey) { buildPlatLayer(); platKey = k; }
    ctx.drawImage(platLayer, 0, 0);
  }

  function drawWaves() {
    G.waves.forEach(function (w) {
      const f = clamp(w.life / w.max, 0, 1), a = Math.min(1, f * 3);
      ctx.save(); ctx.translate(w.x, w.y);
      ctx.fillStyle = 'rgba(255,150,30,' + 0.12 * a + ')'; ctx.beginPath(); ctx.arc(0, 0, w.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,176,0,' + 0.8 * a + ')'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]); ctx.lineDashOffset = -G.time * 30;
      ctx.beginPath(); ctx.arc(0, 0, w.r, 0, TAU); ctx.stroke();
      if (sprOn()) {
        ctx.save(); ctx.globalAlpha = 0.6 * a; ctx.rotate(G.time * 1.1); ctx.scale(w.r * 2.1 / 129, w.r * 2.1 / 95);
        Sprites.draw(ctx, 'whirl', 2 + Math.floor(G.time * 9) % 3, 0, 0, 0, 1); ctx.restore();
      }
      ctx.setLineDash([]); ctx.strokeStyle = 'rgba(255,220,120,' + 0.4 * a + ')'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, w.r * (0.55 + 0.1 * Math.sin(G.time * 5)), 0, TAU); ctx.stroke();
      ctx.restore();
    });
  }

  function drawProjectiles() {
    const usp = sprOn(), t = G.time;
    G.proj.forEach(function (q) {
      const owner = G.players.get(q.o), col = owner ? owner.color : '#fff', ca = Math.cos(q.a), sa = Math.sin(q.a);
      if (q.ty === 'boom') {
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(t * 22 + q.id); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = WEAPONS.boomerang.color; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(11, -15); ctx.lineTo(-7, 0); ctx.lineTo(11, 15); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10, -13); ctx.lineTo(-5, 0); ctx.lineTo(10, 13); ctx.stroke();
        ctx.restore(); return;
      }
      if (q.ty === 'bomb') {
        ctx.save(); ctx.translate(q.x, q.y);
        ctx.fillStyle = '#15111a'; ctx.strokeStyle = WEAPONS.bomb.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(-3, -3, 2.5, 0, TAU); ctx.fill();
        const blink = Math.floor(t * (7 + Math.max(0, 1.7 - q.fuse) * 12)) % 2;
        ctx.strokeStyle = '#c9b28a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(4, -8); ctx.quadraticCurveTo(8, -14, 12, -12); ctx.stroke();
        ctx.fillStyle = blink ? '#fff3a0' : '#ff7a2a'; ctx.beginPath(); ctx.arc(12, -12, blink ? 3.4 : 2.4, 0, TAU); ctx.fill();
        ctx.restore(); return;
      }
      if (q.ty === 'twister') {
        ctx.save(); ctx.translate(q.x, q.y); ctx.lineCap = 'round';
        for (let k = 0; k < 6; k++) {
          const yy = 30 - k * 12, ww = 12 + k * 9, wob = Math.sin(t * 9 + k * 1.3) * 5;
          ctx.strokeStyle = 'rgba(200,214,255,' + (0.85 - k * 0.1) + ')'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(wob, yy, ww, 4.5, 0, Math.PI * (0.1 + ((t * 3 + k * 0.5) % 1)), Math.PI * (1.1 + ((t * 3 + k * 0.5) % 1))); ctx.stroke();
        }
        ctx.restore();
        if (usp) Sprites.draw(ctx, 'wind', 2 + Math.floor(t * 12) % 4, q.x, q.y - 4, t * 6, 1.1, 0.7);
        return;
      }
      if (usp && q.ty === 'bullet') {
        Sprites.draw(ctx, boltFor(owner ? owner.color : null), 2 + Math.floor(t * 18 + q.id) % 4, q.x, q.y, q.a, 0.85);
        return;
      }
      if (usp && q.ty === 'arrow') {
        Sprites.draw(ctx, q.f ? 'arrowPierce' : 'arrow', Math.floor(t * 16 + q.id) % 5, q.x, q.y, q.a, 0.85);
        return;
      }
      if (usp && q.ty === 'orb') {
        const el = q.el || 'fire', lp = ELEM_LOOP[el] || [0, 3], fi = lp[0] + Math.floor(t * 14 + q.id) % (lp[1] - lp[0] + 1);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
        const gr = ctx.createRadialGradient(q.x, q.y, 1, q.x, q.y, 24);
        gr.addColorStop(0, ELEM_COL[el] || '#fff'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(q.x, q.y, 24, 0, TAU); ctx.fill(); ctx.restore();
        const rot = el === 'fire' ? q.a - Math.PI / 2 : (el === 'wind' || el === 'rock') ? t * 7 : 0;
        Sprites.draw(ctx, el, fi, q.x, q.y, rot, 0.62);
        return;
      }
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      if (q.ty === 'bullet') {
        ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.shadowColor = col; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.moveTo(q.x - ca * 16, q.y - sa * 16); ctx.lineTo(q.x, q.y); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(q.x - ca * 8, q.y - sa * 8); ctx.lineTo(q.x, q.y); ctx.stroke();
      } else if (q.ty === 'arrow') {
        ctx.shadowColor = '#ffd27d'; ctx.shadowBlur = 8; ctx.strokeStyle = '#ffd27d'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(q.x - ca * 26, q.y - sa * 26); ctx.lineTo(q.x, q.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - ca * 7 - sa * 4, q.y - sa * 7 + ca * 4);
        ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - ca * 7 + sa * 4, q.y - sa * 7 - ca * 4); ctx.stroke();
      } else if (q.ty === 'orb') {
        const r = 9 + Math.sin(t * 12 + q.id) * 1.5, gr = ctx.createRadialGradient(q.x, q.y, 1, q.x, q.y, r * 1.8);
        gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, '#d9a6ff'); gr.addColorStop(1, 'rgba(160,80,255,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(q.x, q.y, r * 1.8, 0, TAU); ctx.fill();
      } else if (q.ty === 'star') {
        ctx.shadowColor = '#ff4d8d'; ctx.shadowBlur = 10; ctx.fillStyle = '#ff7fb0';
        ctx.translate(q.x, q.y); ctx.rotate(t * 24 + q.id);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 2.6 : 8; if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.moveTo(r, 0); }
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    });
  }

  const glowCache = {};
  function glowSprite(col) {
    let c = glowCache[col];
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = 96;
      const g = c.getContext('2d'), gr = g.createRadialGradient(48, 48, 6, 48, 48, 46);
      gr.addColorStop(0, col + '55'); gr.addColorStop(1, col + '00');
      g.fillStyle = gr; g.fillRect(0, 0, 96, 96); glowCache[col] = c;
    }
    return c;
  }
  function drawPlayer(p) {
    if (p.dead) return;
    const isMe = p.id === G.myId, w = WEAPONS[p.weapon] || WEAPONS.gun, face = p.face || 1;
    ctx.drawImage(glowSprite(p.color.length === 7 ? p.color : '#38f5ff'), p.x - 48, p.y - 70, 96, 96);
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(face, 1);
    /* shadow, boots, body, head: a readable side-on fighter silhouette */
    ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.beginPath(); ctx.ellipse(0, 10, 22, 5, 0, 0, TAU); ctx.fill();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0a0b19'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(-5, -8); ctx.lineTo(-9, 4); ctx.moveTo(5, -8); ctx.lineTo(10, 4); ctx.stroke();
    ctx.strokeStyle = p.color; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-5, -8); ctx.lineTo(-9, 3); ctx.moveTo(5, -8); ctx.lineTo(10, 3); ctx.stroke();
    ctx.fillStyle = '#0a1025'; ctx.strokeStyle = p.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(-11, -32, 22, 26, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f1c9a6'; ctx.beginPath(); ctx.arc(1, -41, 9, 0, TAU); ctx.fill(); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(0, -44, 10, Math.PI, TAU); ctx.fill();
    /* the arm and the held weapon swing toward the aim direction (clamped so it never bends backwards) */
    const la = clamp(Math.atan2(Math.sin(p.a), Math.cos(p.a) * face), -1.45, 1.45), sx = 4, sy = -26, hx = sx + Math.cos(la) * 15, hy = sy + Math.sin(la) * 15;
    ctx.strokeStyle = '#10172a'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.strokeStyle = p.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(la);
    const art = G.weaponArtImages.get(p.id);
    if (art && art.complete && art.naturalWidth > 0) { const ww = 34, hh = Math.max(8, Math.min(24, ww * art.naturalHeight / art.naturalWidth)); ctx.imageSmoothingEnabled = false; ctx.drawImage(art, 12, -hh / 2, ww, hh); }
    else WeaponIcons.draw(ctx, p.weapon, 26, 0, 17, w.color, 0, 0);
    ctx.restore();
    ctx.fillStyle = '#f1c9a6'; ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, TAU); ctx.fill();
    ctx.restore();
    if (p.shieldT > 0) {
      const prog = Math.min(1, p.shieldAge / 0.25), rr = 26 + prog * 8, al = Math.min(1, p.shieldT / 0.3);
      ctx.fillStyle = 'rgba(0,200,255,' + 0.14 * al + ')'; ctx.beginPath(); ctx.moveTo(p.x, p.y - CY); ctx.arc(p.x, p.y - CY, rr, p.a - 1.25, p.a + 1.25); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(120,240,255,' + al + ')'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x, p.y - CY, rr, p.a - 1.25, p.a + 1.25); ctx.stroke();
    }
    const bw = 42, f = clamp(p.hp / p.max, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(p.x - bw / 2, p.y - 64, bw, 6); ctx.fillStyle = f > 0.5 ? '#39ff88' : f > 0.25 ? '#ffb000' : '#ff3d5e'; ctx.fillRect(p.x - bw / 2, p.y - 64, bw * f, 4);
    ctx.font = '11px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = isMe ? '#fff' : p.color; ctx.fillText(p.name, p.x, p.y - 69);
  }

  function drawFx() {
    G.fx.forEach(function (f) {
      const t = 1 - f.life / f.max;
      if (f.k === 'spr') {
        const d = SPRITE_DEFS[f.name];
        if (d) { ctx.save(); ctx.globalAlpha = clamp((1 - t) / 0.25, 0, 1); Sprites.draw(ctx, f.name, Math.min(d.n - 1, Math.floor(t * d.n)), f.x, f.y, f.rot, f.sc); ctx.restore(); }
        return;
      }
      if (f.k === 'bolt') {                       /* chain lightning: jagged flickering segments */
        const pts = f.pts; ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        const flick = Math.floor(G.time * 40) + f.seed;
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass ? '#ffffff' : f.c; ctx.lineWidth = pass ? 2 : 7; ctx.globalAlpha = (1 - t) * (pass ? 1 : 0.55);
          ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
          for (let i = 2; i < pts.length; i += 2) {
            const x0 = pts[i - 2], y0 = pts[i - 1], x1 = pts[i], y1 = pts[i + 1], dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, segs = Math.max(3, Math.floor(len / 22));
            for (let k = 1; k < segs; k++) { const u = k / segs, off = (Math.sin((k * 12.9898 + flick * 7.233 + i) * 43758.5453) % 1) * 14; ctx.lineTo(x0 + dx * u + nx * off, y0 + dy * u + ny * off); }
            ctx.lineTo(x1, y1);
          }
          ctx.stroke();
        }
        ctx.restore(); return;
      }
      if (f.k === 'whip') {                       /* a travelling wave along the lash */
        const reach = f.r * Math.min(1, t * 3.2), n = 18; ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass ? '#ffffff' : f.c; ctx.lineWidth = pass ? 1.6 : 4; ctx.globalAlpha = 1 - t * t; ctx.beginPath();
          for (let i = 0; i <= n; i++) { const u = i / n, x = u * reach, y = Math.sin(u * 9 - t * 26) * 9 * u * (1 - t); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
          ctx.stroke();
        }
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(reach, 0, 3 * (1 - t) + 1, 0, TAU); ctx.fill(); ctx.restore(); return;
      }
      if (f.k === 'thrust') {
        const reach = f.r * Math.min(1, t * 4), tip = reach; ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a); ctx.globalAlpha = 1 - t * t;
        ctx.fillStyle = f.c; ctx.beginPath(); ctx.moveTo(tip + 10, 0); ctx.lineTo(tip - 14, -6); ctx.lineTo(tip - 14, 6); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = f.c; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(tip - 12, 0); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(tip - 12, 0); ctx.stroke(); ctx.restore(); return;
      }
      ctx.save(); ctx.translate(f.x, f.y); ctx.globalAlpha = (1 - t * t) * (f.k === 'arc' && sprOn() ? 0.55 : 1);
      if (f.k === 'arc') {
        const end = f.a - f.arc / 2 + f.arc * Math.min(1, t * 2.4);
        ctx.strokeStyle = f.c; ctx.shadowColor = f.c; ctx.shadowBlur = 16; ctx.lineCap = 'round';
        ctx.lineWidth = f.wide * (1 - t * 0.6); ctx.beginPath(); ctx.arc(0, 0, f.r * (0.72 + 0.28 * t), f.a - f.arc / 2, end); ctx.stroke();
        ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, f.r * (0.8 + 0.2 * t), f.a - f.arc / 2, end); ctx.stroke();
      } else if (f.k === 'ring') {
        ctx.strokeStyle = f.c; ctx.shadowColor = f.c; ctx.shadowBlur = 18; ctx.lineWidth = 6 * (1 - t);
        ctx.beginPath(); ctx.arc(0, 0, f.r * (0.2 + 0.9 * t), 0, TAU); ctx.stroke();
      }
      ctx.restore();
    });
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    G.parts.forEach(function (p) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.col; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    });
    ctx.restore();
    ctx.textAlign = 'center';
    G.texts.forEach(function (t) {
      ctx.globalAlpha = clamp(t.life / (t.max * 0.5), 0, 1); ctx.font = 'bold ' + t.size + 'px monospace';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(t.text, t.x, t.y); ctx.fillStyle = t.col; ctx.fillText(t.text, t.x, t.y);
    });
    ctx.globalAlpha = 1;
  }

  function currentBrushColor() {
    return ['#fff', '#000', '#00f0ff', '#ff2e43', '#3d7bff', '#39ff88'][G.brush] || '#fff';
  }
  function drawBrushPreview() {
    const s = G.brushSize, rr = (s - 0.5) * (s - 0.5), cx = Math.floor(G.mouse.x / CELL), cy = Math.floor(G.mouse.y / CELL);
    ctx.save(); ctx.globalAlpha = 0.45; ctx.fillStyle = G.brush === 0 ? '#ffffff' : currentBrushColor();
    for (let dy = -s; dy <= s; dy++) for (let dx = -s; dx <= s; dx++) if (dx * dx + dy * dy <= rr) ctx.fillRect((cx + dx) * CELL, (cy + dy) * CELL, CELL, CELL);
    ctx.globalAlpha = 1; ctx.strokeStyle = G.brush === 1 ? '#ff2e97' : '#b4ff39'; ctx.lineWidth = 1;
    for (let dy = -s; dy <= s; dy++) for (let dx = -s; dx <= s; dx++) if (dx * dx + dy * dy <= rr) ctx.strokeRect((cx + dx) * CELL + 0.5, (cy + dy) * CELL + 0.5, CELL - 1, CELL - 1);
    ctx.restore();
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (G.shake > 0) ctx.translate(rnd(-G.shake, G.shake), rnd(-G.shake, G.shake));
    drawTerrain();
    ctx.save();ctx.font='bold 12px monospace';ctx.fillStyle='rgba(220,235,255,.7)';ctx.textAlign='left';ctx.fillText('ARENA BRAWL  •  SIDE-VIEW PLATFORM FIGHTER',18,24);ctx.restore();
    if (G.paint) { ctx.drawImage(gridLayer, 0, 0); }
    if (!G.stageDesign) {
      drawWaves();
      G.players.forEach(drawPlayer);
      drawProjectiles();
      drawFx();
    } else {
      // Platform placement preview is only a guide; the host commits with mouse-up.
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1; ctx.setLineDash([5,9]);
      for (let y=100; y<H; y+=80) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.fillStyle='rgba(255,255,255,.85)';ctx.textAlign='center';ctx.font='900 18px ui-monospace, monospace';
      ctx.fillText(G.isHost ? 'DRAW YOUR ARENA' : 'ARENA UNDER CONSTRUCTION', W/2, H-52);
      ctx.font='12px ui-monospace, monospace';ctx.fillStyle='rgba(215,226,255,.70)';
      ctx.fillText(G.isHost ? 'CLICK + DRAG TO PLACE PLATFORMS  •  MINIMUM LENGTH 44 PX' : 'WAITING FOR HOST TO CONFIRM THE STAGE', W/2, H-28);
      if (G.stageDrag && G.isHost) {
        const x=Math.min(G.stageDrag.x,G.stageDrag.ex), w=Math.abs(G.stageDrag.ex-G.stageDrag.x), y=G.stageDrag.y, h=G.stageThickness;
        ctx.fillStyle='rgba(56,245,255,.24)';ctx.fillRect(x,y,w,h);
        ctx.strokeStyle='#38f5ff';ctx.lineWidth=2;ctx.shadowColor='#38f5ff';ctx.shadowBlur=14;ctx.strokeRect(x,y,w,h);ctx.shadowBlur=0;
      }
      ctx.restore();
    }
    if (G.paint && G.isHost) drawBrushPreview();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (G.paint && !G.stageDesign) {
      ctx.fillStyle = 'rgba(180,255,57,0.9)'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
      ctx.fillText(G.isHost ? 'PAINT MODE: LMB paints, RMB erases' : 'PAINT MODE: HOST ONLY (you can watch)', W / 2, 20);
    }
  }

  /* ------------------------------------------------------------------ */
  /* HUD                                                                 */
  /* ------------------------------------------------------------------ */
  let hudWeapon = '', scoreTimer = 0; const hudCache = {};
  function updateHud(dt) {
    const p = me();
    if (p) {
      if (G.roundsDrawEnabled && lastSelfDead === true && !p.dead) DrawPad.open(true);
      lastSelfDead = !!p.dead;
      const w = WEAPONS[p.weapon];
      const hpW = Math.round(clamp(p.hp / p.max, 0, 1) * 100) + '%', hpT = Math.max(0, Math.round(p.hp)), cdW = Math.round((w.cd > 0 ? clamp(1 - p.cd / w.cd, 0, 1) : 1) * 100) + '%';
      if (hudCache.hpW !== hpW) { hudCache.hpW = hpW; $('hpFill').style.width = hpW; }
      if (hudCache.hpT !== hpT) { hudCache.hpT = hpT; $('hpText').textContent = hpT; }
      if (hudCache.cdW !== cdW) { hudCache.cdW = cdW; $('cdFill').style.width = cdW; }
      if (hudWeapon !== p.weapon) {
        hudWeapon = p.weapon;
        $('wName').textContent = w.name; $('wName').style.color = w.color;
        $('wMeta').textContent = w.stats[0][1] + ' | ' + w.stats[1][1];
        const c = $('hudIcon').getContext('2d'); c.clearRect(0, 0, 56, 56);
        WeaponIcons.draw(c, p.weapon, 28, 28, 20, w.color, -0.5, 10);
      }
      const dead = p.dead;
      $('deathOverlay').classList.toggle('hidden', !dead);   /* every frame on purpose: updateStageDesignerUi() can un-hide it */
      if (dead) { const dt2 = 'Respawning in ' + Math.max(1, Math.ceil(p.rt)); if (hudCache.dt !== dt2) { hudCache.dt = dt2; $('deathTimer').textContent = dt2; } }
    }
    scoreTimer -= dt;
    if (scoreTimer <= 0) {
      scoreTimer = 0.3;
      const arr = []; G.players.forEach(function (q) { arr.push(q); });
      arr.sort(function (a, b) { return b.score - a.score || a.deaths - b.deaths; });
      let sig = G.myId; for (let i = 0; i < arr.length && i < 8; i++) sig += '|' + arr[i].id + ':' + arr[i].name + ':' + arr[i].score + ':' + arr[i].deaths;
      if (sig === hudCache.sig) return;
      hudCache.sig = sig;
      const box = $('scoreList'); box.innerHTML = '';
      arr.slice(0, 8).forEach(function (q) {
        const row = document.createElement('div'); row.className = 'sc-row' + (q.id === G.myId ? ' me' : '');
        const dot = document.createElement('i'); dot.style.color = q.color;
        const nm = document.createElement('span'); nm.className = 'sc-name'; nm.textContent = q.name;
        const k = document.createElement('span'); k.className = 'sc-k'; k.textContent = q.score;
        const d = document.createElement('span'); d.className = 'sc-d'; d.textContent = q.deaths;
        row.appendChild(dot); row.appendChild(nm); row.appendChild(k); row.appendChild(d); box.appendChild(row);
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* input + UI wiring                                                   */
  /* ------------------------------------------------------------------ */
  let capturingBind = null;
  function keyLabel(code) {
    if (!code) return 'UNBOUND';
    if (code === 'Space') return 'SPACE';
    if (code === 'Escape') return 'ESC';
    if (code.indexOf('Arrow') === 0) return code.slice(5).toUpperCase() + ' ARROW';
    if (code.indexOf('Key') === 0) return code.slice(3).toUpperCase();
    if (code.indexOf('Digit') === 0) return code.slice(5);
    if (code.indexOf('Numpad') === 0) return 'NUM ' + code.slice(6);
    return code.toUpperCase();
  }
  function renderKeybinds() {
    const box = $('keybindRows'); if (!box) return;
    box.innerHTML = '';
    KEY_ACTIONS.forEach(function (action) {
      const row = document.createElement('div'); row.className = 'keybind-row';
      const label = document.createElement('span'); label.textContent = action.label;
      const button = document.createElement('button');
      const listening = capturingBind === action.id;
      button.type = 'button'; button.className = listening ? 'listening' : '';
      button.textContent = listening ? 'PRESS A KEY…' : keyLabel(bindCode(action.id));
      button.setAttribute('aria-label', 'Change keybind for ' + action.label);
      button.addEventListener('click', function () { capturingBind = action.id; renderKeybinds(); });
      row.appendChild(label); row.appendChild(button); box.appendChild(row);
    });
  }
  function updateKeybindLabels() {
    const put = function (id, text) { const el = $(id); if (el) el.textContent = text; };
    put('drawKeyHint', keyLabel(bindCode('drawWeapon')));
    put('editorKeyHint', keyLabel(bindCode('toggleEditor')));
    put('menuPauseHint', keyLabel(bindCode('pause')));
    put('hintMove', [bindCode('moveUp'), bindCode('moveLeft'), bindCode('moveDown'), bindCode('moveRight')].map(keyLabel).join('/'));
    put('hintFire', 'Click / ' + keyLabel(bindCode('fire')));
    put('hintDraw', keyLabel(bindCode('drawWeapon')));
    put('hintPaint', keyLabel(bindCode('toggleEditor')));
    put('hintPause', keyLabel(bindCode('pause')));
    const brushBinds = { '1':'paintWall', '2':'paintBoost', '3':'paintAcid', '4':'paintIce', '5':'paintHeal', '0':'erase' };
    document.querySelectorAll('.brush').forEach(function (b) {
      const action = brushBinds[b.dataset.brush]; const cap = b.querySelector('kbd');
      if (action && cap) cap.textContent = keyLabel(bindCode(action));
    });
    put('hintBrushes', ['paintWall','paintBoost','paintAcid','paintIce','paintHeal','erase'].map(function (a) { return keyLabel(bindCode(a)); }).join('/'));
  }
  function initKeybinds() {
    renderKeybinds(); updateKeybindLabels();
    const reset = $('resetBinds');
    if (reset) reset.addEventListener('click', function () {
      Settings.keybinds = { moveUp:'KeyW', moveDown:'KeyS', moveLeft:'KeyA', moveRight:'KeyD', fire:'Space', drawWeapon:'KeyE', pause:'Escape', toggleEditor:'KeyP', paintWall:'Digit1', paintBoost:'Digit2', paintAcid:'Digit3', paintIce:'Digit4', paintHeal:'Digit5', erase:'Digit6' };
      Settings.save(); capturingBind = null; renderKeybinds(); updateKeybindLabels();
    });
  }
  function setPaintEnabled(on) {
    $('paintToggle').disabled = !on; $('mapDefault').disabled = !on; $('mapClear').disabled = !on; $('botsToggle').disabled = !on;
    document.querySelectorAll('.brush').forEach(function (b) { b.disabled = !on; });
    $('brushSize').disabled = !on;
    $('paintNote').textContent = on ? 'Right-click erases while painting. Edits sync live to every guest.' : 'Only the host can paint. You will see edits live.';
  }
  function setPaint(on) {
    G.paint = on && G.isHost; document.body.classList.toggle('paint-mode', G.paint);
    $('paintToggle').classList.toggle('on', G.paint);
    G.mouse.lx = null;
  }
  function setBrush(id) {
    G.brush = id;
    document.querySelectorAll('.brush').forEach(function (b) { b.classList.toggle('active', +b.dataset.brush === id); });
  }
  function setBrushSize(n) {
    G.brushSize = clamp(n, 1, 6); $('brushSize').value = G.brushSize; $('brushSizeLabel').textContent = G.brushSize;
  }
  function setStageThickness(n) {
    G.stageThickness = clamp(Math.round(n / 2) * 2, 8, 28);
    const input = $('stageThickness'), label = $('stageThicknessLabel');
    if (input) input.value = G.stageThickness;
    if (label) label.textContent = String(G.stageThickness);
  }
  function mouseToCanvas(e) {
    const r = canvas.getBoundingClientRect();
    G.mouse.x = clamp((e.clientX - r.left) * W / r.width, 0, W); G.mouse.y = clamp((e.clientY - r.top) * H / r.height, 0, H);
  }
  function resize() {
    const st = $('stage'), s = Math.min(st.clientWidth / W, st.clientHeight / H);
    canvas.style.width = Math.floor(W * s) + 'px'; canvas.style.height = Math.floor(H * s) + 'px';
  }
  function releaseInputs() { G.keys = {}; G.mouse.down = false; G.mouse.right = false; G.mouse.lx = null; }
  function syncModal() { G.modalOpen = G.menu || G.pad; releaseInputs(); }

  function wireUi() {
    window.addEventListener('resize', resize); resize();
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('mousemove', function (e) {
      mouseToCanvas(e);
      if (G.stageDesign && G.isHost && G.stageDrag) {
        G.stageDrag.ex = G.mouse.x;
        G.stageDrag.ey = G.mouse.y;
        return;
      }
      if (G.paint && G.isHost && (G.mouse.down || G.mouse.right)) {
        const t = G.mouse.right ? T.EMPTY : G.brush;
        if (G.mouse.lx === null) paintAt(G.mouse.x, G.mouse.y, t); else paintStroke(G.mouse.lx, G.mouse.ly, G.mouse.x, G.mouse.y, t);
        G.mouse.lx = G.mouse.x; G.mouse.ly = G.mouse.y;
      }
    });
    canvas.addEventListener('mousedown', function (e) {
      mouseToCanvas(e);
      if (actx && actx.state === 'suspended') actx.resume();
      if (G.stageDesign) {
        e.preventDefault();
        if (G.isHost && e.button === 0) G.stageDrag = { x: G.mouse.x, y: G.mouse.y, ex: G.mouse.x, ey: G.mouse.y };
        return;
      }
      if (e.button === 2) G.mouse.right = true; else G.mouse.down = true;
      if (G.paint && G.isHost) {
        const t = e.button === 2 ? T.EMPTY : G.brush;
        paintAt(G.mouse.x, G.mouse.y, t); G.mouse.lx = G.mouse.x; G.mouse.ly = G.mouse.y;
      }
    });
    window.addEventListener('mouseup', function (e) {
      if (G.stageDesign && G.stageDrag) { finishStageDrag(); G.mouse.down = false; G.mouse.right = false; return; }
      if (e.button === 2) G.mouse.right = false; else G.mouse.down = false; G.mouse.lx = null;
    });
    canvas.addEventListener('wheel', function (e) { if (G.stageDesign && G.isHost) { e.preventDefault(); setStageThickness(G.stageThickness + (e.deltaY < 0 ? 2 : -2)); return; } if (!G.paint || !G.isHost) return; e.preventDefault(); setBrushSize(G.brushSize + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
    window.addEventListener('blur', releaseInputs);

    window.addEventListener('keydown', function (e) {
      if (capturingBind) {
        e.preventDefault(); e.stopPropagation();
        if (e.code === 'Backspace') { capturingBind = null; renderKeybinds(); return; }
        const target = capturingBind, previous = bindCode(target);
        const conflict = KEY_ACTIONS.find(function (a) { return a.id !== target && bindCode(a.id) === e.code; });
        if (conflict) Settings.keybinds[conflict.id] = previous;
        Settings.keybinds[target] = e.code;
        Settings.save(); capturingBind = null; renderKeybinds(); updateKeybindLabels(); return;
      }
      if (e.target && (e.target.tagName === 'INPUT') && e.target.type !== 'range') return;
      if (e.code === bindCode('pause')) { if (Menu.isOpen()) Menu.escape(); else if (DrawPad.isOpen()) DrawPad.close(); else if (G.paint) setPaint(false); else Menu.open(); return; }
      if (G.modalOpen) return;
      G.keys[e.code] = true; G.taps[e.code] = true;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') e.preventDefault();
      if (e.code === bindCode('drawWeapon') && !G.stageDesign) DrawPad.open();
      // Platform maps are designed only in the pre-round drawing phase; the legacy tile editor is disabled.
      else if (e.code === bindCode('toggleEditor')) { /* intentionally unused in side-view mode */ }
    });
    window.addEventListener('keyup', function (e) { G.keys[e.code] = false; if (e.code === 'Space') e.preventDefault(); });
    document.addEventListener('click', function (e) { if (e.target && e.target.tagName === 'BUTTON') e.target.blur(); });

    $('forgeBtn').addEventListener('click', function () { if (!G.stageDesign) DrawPad.open(); });
    $('paintToggle').addEventListener('click', function () { setPaint(!G.paint); });
    document.querySelectorAll('.brush').forEach(function (b) { b.addEventListener('click', function () { setBrush(+b.dataset.brush); if (!G.paint) setPaint(true); }); });
    $('brushSize').addEventListener('input', function (e) { setBrushSize(+e.target.value); });
    $('mapDefault').addEventListener('click', function () {
      if (!G.isHost) return; buildDefaultMap(); relocateStuck(); G.changes = []; Net.broadcast({ t: 'mapfull', m: mapToString() });
    });
    $('mapClear').addEventListener('click', function () {
      if (!G.isHost) return; clearMap(); G.changes = []; Net.broadcast({ t: 'mapfull', m: mapToString() });
    });
    $('botsToggle').addEventListener('click', function () { if (G.isHost) setBots(!G.botsOn); });
    $('stageThickness').addEventListener('input', function (e) { setStageThickness(+e.target.value); });
    $('stageUndo').addEventListener('click', function () { if (!G.isHost || !G.stageDesign) return; G.platforms.pop(); updateStageDesignerUi(); publishPlatforms(); });
    $('stageClear').addEventListener('click', function () { if (!G.isHost || !G.stageDesign) return; G.platforms = []; G.stageDrag = null; updateStageDesignerUi(); publishPlatforms(); });
    $('stageStartRound').addEventListener('click', startRound);
    setBrush(T.WALL); setBrushSize(2); setStageThickness(14); updateStageDesignerUi();

    initKeybinds();
    DrawPad.init({
      onEquip: equipWeapon,
      onOpen: function () { G.pad = true; syncModal(); },
      onClose: function () { G.pad = false; syncModal(); }
    });
    Menu.init({
      onOpen: function () { G.menu = true; syncModal(); },
      onClose: function () { G.menu = false; syncModal(); },
      onPlay: function () { const a = audio(); if (a && a.state === 'suspended') a.resume(); },
      onSolo: function () {
        pendingInitialDraw = true; G.roundsDrawEnabled = true;
        Net.startSolo();
      },
      onMultiplayer: function () {
        pendingInitialDraw = true; G.roundsDrawEnabled = true;
        if (Net.state.ready && !Net.state.solo) {
          pendingInitialDraw = false;
          setTimeout(function () { DrawPad.open(true); }, 90);
        } else Net.init();
      },
      onChange: function (key) { if (key === 'aiCount' && G.isHost && G.started) setBots(G.botsOn); }
    });
  }

  /* ------------------------------------------------------------------ */
  /* main loop                                                           */
  /* ------------------------------------------------------------------ */
  /* ---- simulation clock ------------------------------------------------------------------
     The host sim, snapshot broadcast and guest input all run from pump(). pump() is driven by a
     Web Worker timer so it keeps ticking at full rate when the browser tab is in the background
     (requestAnimationFrame and normal timers are throttled there, which froze v8 matches). */
  let simAcc = 0, pumpLast = performance.now(), bAcc = 0, iAcc = 0, hbAcc = 0, pingAcc = 0, chkAcc = 0, lastSig = '', lastRoster = 0, inPump = false;
  function broadcastTick() {
    if (Net.peerCount() === 0) { flushMapChanges(false); G.pending = []; return; }
    flushMapChanges(true);
    const now = performance.now();
    if (G.rosterDirty || now - lastRoster > 4000) { sendRoster(); lastRoster = now; }
    Net.sendSnapshot(buildSnapshot());
  }
  function pump() {
    if (inPump) return; inPump = true;
    try {
      const now = performance.now(); let dt = (now - pumpLast) / 1000; pumpLast = now;
      if (dt > 0.25) dt = 0.25; if (dt <= 0) return;
      G.attract = G.menu && Net.peerCount() === 0;
      G.localInp = getInput(); G.taps = {};
      if (G.isHost && G.started && !G.stageDesign) {
        const p = me();
        if (p) { const inp = G.localInp; p.inp.mx = inp.mx; p.inp.my = inp.my; p.inp.u = inp.u; p.inp.d = inp.d; p.inp.l = inp.l; p.inp.r = inp.r; p.inp.f = inp.f; }
        simAcc += dt; let n = 0;
        while (simAcc >= STEP && n < 6) { hostStep(STEP * SIM_SCALE); simAcc -= STEP; n++; }
        if (simAcc > STEP * 6) simAcc = 0;
        bAcc += dt; if (bAcc >= 1 / 30) { bAcc = 0; broadcastTick(); }
        chkAcc += dt;
        if (chkAcc >= 1) {                                       /* drop guests that went silent (closed laptop, lost link) */
          chkAcc = 0; const t = performance.now();
          G.players.forEach(function (q) { if (!q.bot && q.id !== G.myId && q.lastIn && t - q.lastIn > 15000) Net.drop(q.id); });
        }
      } else if (G.isHost && !Net.state.solo && Net.peerCount() > 0) {
        bAcc += dt; if (bAcc >= 1 / 30) { bAcc = 0; flushMapChanges(true); if (G.rosterDirty) sendRoster(); }
      } else if (!G.isHost && Net.state.ready) {
        /* local prediction runs on the same fixed 60 Hz clock as the host sim, so a quick key tap can never fall
           between two render frames (the render loop may be much slower than 60 fps) */
        const mine = me();
        if (predictOn()) {
          simAcc += dt; let n = 0;
          while (simAcc >= STEP && n < 6) { stepBody(mine, STEP * SIM_SCALE, G.localInp, WEAPONS[mine.weapon] || WEAPONS.gun); if (mine.y > H + 100) mine.y = H + 100; simAcc -= STEP; n++; }
          if (simAcc > STEP * 6) simAcc = 0;
        } else simAcc = 0;
        iAcc += dt; hbAcc += dt;
        const i = G.localInp, sig = '' + i.u + i.d + i.l + i.r + i.f + '|' + (i.mx >> 3) + '|' + (i.my >> 3);
        if ((sig !== lastSig && iAcc >= 1 / 30) || hbAcc >= 0.1) { iAcc = 0; hbAcc = 0; lastSig = sig; Net.sendHost(i); }
        pingAcc += dt; if (pingAcc >= 2) { pingAcc = 0; Net.sendHost({ t: 'ping', c: performance.now() }); }
      }
    } finally { inPump = false; }
  }
  const Ticker = {
    w: null, t: null,
    start: function (fn) {
      const fallback = function () { if (!Ticker.t) Ticker.t = setInterval(fn, 1000 / 60); };
      try {
        const blob = new Blob(['setInterval(function(){postMessage(0)},1000/60);'], { type: 'text/javascript' });
        Ticker.w = new Worker(URL.createObjectURL(blob));
        Ticker.w.onmessage = fn;
        Ticker.w.onerror = function () { try { Ticker.w.terminate(); } catch (e) { /* ignore */ } Ticker.w = null; fallback(); };
      } catch (e) { Ticker.w = null; fallback(); }
    }
  };
  let last = performance.now(), qEma = 0.016;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    G.time += dt;
    if (!G.isHost) clientStep(dt, now);
    updateFx(dt);
    render();
    updateHud(dt);
    /* adaptive quality: shed particle load if frames get slow, restore it when there is headroom */
    qEma += (dt - qEma) * 0.05;
    if (qEma > 0.024) G.quality = Math.max(0.35, G.quality - 0.01); else if (qEma < 0.019) G.quality = Math.min(1, G.quality + 0.004);
    requestAnimationFrame(frame);
  }

  /* debug / test hooks (harmless in play) */
  G.api = { stepBody: stepBody, hostStep: hostStep, addPlayer: addPlayer, setPlatforms: setPlatforms, tryFire: tryFire, spawnPoint: spawnPoint, buildSnapshot: buildSnapshot, applySnapshot: applySnapshot, applyRoster: applyRoster, sendRoster: sendRoster, handleEvent: handleEvent, dealDamage: dealDamage, clientStep: clientStep, pump: pump, getInput: getInput, WEAPONS: WEAPONS, SIM_SCALE: SIM_SCALE, explode: explode };
  function boot() {
    buildDefaultMap();
    G.platforms = []; G.stageDesign = false;
    wireUi();
    updateStageDesignerUi();
    setupNet();
    // Invite links immediately join their target room and bypass the title menu.
    const roomInvite = new URLSearchParams(window.location.search).get('room');
    if (roomInvite) {
      G.started = false; G.isHost = false;
      const joinOverlay = $('connecting'); if (joinOverlay) { joinOverlay.textContent = 'CONNECTING TO ROOM...'; joinOverlay.classList.remove('hidden'); }
      Net.init();
    } else {
      const status = $('netStatus');
      if (status) { status.textContent = 'CHOOSE MODE'; status.className = 'chip'; }
      const count = $('peerCount'); if (count) count.textContent = '1 PILOT';
      Menu.open();
    }
    Ticker.start(pump);
    requestAnimationFrame(frame);
  }
  boot();
})();
