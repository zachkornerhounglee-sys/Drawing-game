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
  const PALETTE = ['#ff2e97', '#00f0ff', '#b4ff39', '#ffb000', '#a66bff', '#ff5f5f', '#39ffb6', '#ff8a00'];
  const BOT_NAMES = ['NEON-7', 'GLITCH', 'VANTA', 'CIPHER', 'ROGUE', 'KILOBYTE'];

  const G = {
    isHost: true, myId: 'local', started: false,
    players: new Map(), proj: [], waves: [], parts: [], texts: [], fx: [],
    map: new Uint8Array(COLS * ROWS), changes: [], events: [], pending: [],
    shake: 0, time: 0, nextId: 1, tick: 0, paint: false, brush: T.WALL, brushSize: 2,
    mouse: { x: W / 2, y: H / 2, down: false, right: false, lx: null, ly: null },
    keys: {}, botsOn: true, modalOpen: false, menu: false, pad: false, attract: false, killfeed: [], lastSnap: 0
  };
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
    G.map.fill(0);
    borderWalls();
    rect(30, 16, 4, 4, T.WALL); rect(14, 8, 2, 8, T.WALL); rect(48, 20, 2, 8, T.WALL);
    rect(8, 26, 10, 2, T.WALL); rect(46, 8, 10, 2, T.WALL);
    rect(20, 4, 24, 2, T.BOOST); rect(20, 30, 24, 2, T.BOOST);
    rect(4, 12, 8, 12, T.ICE); rect(54, 10, 6, 14, T.ICE);
    rect(18, 17, 6, 3, T.ACID); rect(40, 17, 6, 3, T.ACID);
    rect(30, 10, 4, 3, T.HEAL); rect(30, 23, 4, 3, T.HEAL);
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
      id: id, name: name, color: color, bot: false, x: W / 2, y: H / 2, tx: W / 2, ty: H / 2, vx: 0, vy: 0, a: 0,
      hp: 100, max: 100, weapon: 'gun', cd: 0, dead: false, rt: 0, score: 0, deaths: 0,
      shieldT: 0, shieldAge: 0, acidT: 0, healT: 0, slowed: false,
      inp: { mx: W / 2, my: H / 2, u: 0, d: 0, l: 0, r: 0, f: 0 }, ai: { t: 0, strafe: 1, err: 0 }
    };
  }
  function spawnPoint() {
    for (let i = 0; i < 80; i++) {
      const x = rnd(60, W - 60), y = rnd(60, H - 60), tl = tileAt(x, y);
      if (!hitsWall(x, y, R + 6) && tl !== T.ACID) return { x: x, y: y };
    }
    return { x: W / 2, y: H / 2 };
  }
  function addPlayer(id, name, bot) {
    const color = PALETTE[G.players.size % PALETTE.length];
    const p = blankPlayer(id, name, color);
    p.bot = !!bot;
    const s = spawnPoint(); p.x = p.tx = s.x; p.y = p.ty = s.y;
    if (bot) p.weapon = randomWeapon();
    G.players.set(id, p);
    return p;
  }
  function randomWeapon() { return WEAPON_ORDER[Math.floor(Math.random() * WEAPON_ORDER.length)]; }
  function setBots(on) {
    G.botsOn = on;
    const bots = [];
    G.players.forEach(function (p) { if (p.bot) bots.push(p.id); });
    bots.forEach(function (id) { G.players.delete(id); });
    if (on) for (let i = 0; i < 3; i++) addPlayer('bot' + (G.nextId++), BOT_NAMES[i % BOT_NAMES.length], true);
    const b = $('botsToggle'); if (b) { b.textContent = 'BOTS: ' + (on ? 'ON' : 'OFF'); b.classList.toggle('on', on); }
  }
  function respawn(p) {
    const s = spawnPoint();
    p.x = s.x; p.y = s.y; p.vx = p.vy = 0; p.hp = p.max; p.dead = false; p.cd = 0.5; p.shieldT = 0;
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
    G.players.forEach(function (t) {
      if (t === p || t.dead) return;
      const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
      if (d > range + R) return;
      const ang = Math.atan2(dy, dx);
      if (Math.abs(angDiff(p.a, ang)) > arc / 2 && d > R + 10) return;
      if (!losClear(p.x, p.y, t.x, t.y)) return;
      if (dealDamage(t, dmg, Math.atan2(-dy, -dx), p.id, false)) { t.vx += Math.cos(ang) * kb; t.vy += Math.sin(ang) * kb; }
    });
  }
  function spawnProj(o) {
    o.id = G.nextId++; o.dist = 0; G.proj.push(o); return o;
  }
  function tryFire(p) {
    if (p.cd > 0 || p.dead) return;
    const w = WEAPONS[p.weapon], a = p.a, ca = Math.cos(a), sa = Math.sin(a);
    p.cd = w.cd;
    const mx = p.x + ca * (R + 6), my = p.y + sa * (R + 6);
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
      case 'sword':
        meleeHit(p, w.range, w.arc, w.dmg, 180);
        p.swing = (p.swing || 0) ^ 1;          /* alternate crescent / streak slashes */
        ev({ k: 'slash', x: p.x, y: p.y, a: a, r: w.range, arc: w.arc, w: 'sword', c: w.color, v: p.swing });
        break;
      case 'axe':
        meleeHit(p, w.range, w.arc, w.dmg, 520);
        ev({ k: 'slash', x: p.x, y: p.y, a: a, r: w.range, arc: w.arc, w: 'axe', c: w.color });
        ev({ k: 'shake', m: 18, x: p.x, y: p.y });
        break;
      case 'hammer': {
        let cx = p.x + ca * 70, cy = p.y + sa * 70;
        if (solidAt(cx, cy)) { cx = p.x; cy = p.y; }
        G.players.forEach(function (t) {
          if (t === p || t.dead) return;
          const d = Math.hypot(t.x - cx, t.y - cy);
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
        ev({ k: 'shield', x: p.x, y: p.y, a: a, c: w.color });
        break;
      default: break;
    }
  }

  function updatePlayer(p, dt) {
    if (p.dead) { p.rt -= dt; if (p.rt <= 0) respawn(p); return; }
    const w = WEAPONS[p.weapon], inp = p.inp;
    p.cd = Math.max(0, p.cd - dt);
    p.shieldT = Math.max(0, p.shieldT - dt); p.shieldAge += dt;
    if (Math.hypot(inp.mx - p.x, inp.my - p.y) > 3) p.a = Math.atan2(inp.my - p.y, inp.mx - p.x);

    const tile = tileAt(p.x, p.y);
    p.slowed = false;
    for (let i = 0; i < G.waves.length; i++) {
      const sw = G.waves[i];
      if (sw.o !== p.id && Math.hypot(p.x - sw.x, p.y - sw.y) < sw.r) { p.slowed = true; break; }
    }
    let maxV = 250 * w.speedMul, damp = 10;
    if (tile === T.BOOST) maxV *= 2.2;                       /* speed lane: higher cap + proportional acceleration */
    if (p.slowed) { maxV *= 0.45; }
    let ix = (inp.r ? 1 : 0) - (inp.l ? 1 : 0), iy = (inp.d ? 1 : 0) - (inp.u ? 1 : 0);
    const il = Math.hypot(ix, iy); if (il > 0) { ix /= il; iy /= il; }
    let accel;
    if (tile === T.ICE) { damp = 0; accel = 900; }          /* frictionless: zero damping, weak steering */
    else accel = maxV * damp;
    p.vx += ix * accel * dt; p.vy += iy * accel * dt;
    if (damp > 0) { const k = Math.exp(-damp * dt); p.vx *= k; p.vy *= k; }
    const sp = Math.hypot(p.vx, p.vy), cap = tile === T.ICE ? 560 : maxV * 1.02;
    if (sp > cap) { const s = tile === T.ICE ? cap / sp : Math.max(cap / sp, 1 - 8 * dt); p.vx *= s; p.vy *= s; }

    const nx = p.x + p.vx * dt;
    if (!hitsWall(nx, p.y, R)) p.x = nx; else p.vx = tile === T.ICE ? -p.vx * 0.7 : 0;
    const ny = p.y + p.vy * dt;
    if (!hitsWall(p.x, ny, R)) p.y = ny; else p.vy = tile === T.ICE ? -p.vy * 0.7 : 0;

    if (tile === T.ACID) {
      p.acidT += dt;
      while (p.acidT >= 0.25) { p.acidT -= 0.25; p.hp -= 3.5; if (p.hp <= 0) { kill(p, null); break; } }
    } else p.acidT = 0;
    if (!p.dead && tile === T.HEAL) {
      p.healT += dt;
      while (p.healT >= 0.25) { p.healT -= 0.25; p.hp = Math.min(p.max, p.hp + 4); }
    } else p.healT = 0;

    if (!p.dead && inp.f) tryFire(p);
  }

  function separatePlayers() {
    const arr = []; G.players.forEach(function (p) { if (!p.dead) arr.push(p); });
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d > 0.01 && d < R * 2) {
        const push = (R * 2 - d) / 2, nx = dx / d, ny = dy / d;
        if (!hitsWall(a.x - nx * push, a.y - ny * push, R)) { a.x -= nx * push; a.y -= ny * push; }
        if (!hitsWall(b.x + nx * push, b.y + ny * push, R)) { b.x += nx * push; b.y += ny * push; }
      }
    }
  }

  function updateProjectiles(dt) {
    for (let i = G.proj.length - 1; i >= 0; i--) {
      const p = G.proj[i];
      p.life -= dt;
      if (p.life <= 0) { if (p.ty === 'orb') ev({ k: 'impact', x: p.x, y: p.y, el: p.el }); G.proj.splice(i, 1); continue; }
      if (p.homing) {
        let best = null, bd = 420;
        G.players.forEach(function (t) {
          if (t.dead || t.id === p.o) return;
          const d = Math.hypot(t.x - p.x, t.y - p.y);
          if (d < bd) { bd = d; best = t; }
        });
        if (best) {
          const cur = Math.atan2(p.vy, p.vx), want = Math.atan2(best.y - p.y, best.x - p.x);
          const turn = clamp(angDiff(cur, want), -p.homing * dt, p.homing * dt), sp0 = Math.hypot(p.vx, p.vy);
          p.vx = Math.cos(cur + turn) * sp0; p.vy = Math.sin(cur + turn) * sp0;
        }
      }
      const sp = Math.hypot(p.vx, p.vy), steps = Math.max(1, Math.ceil(sp * dt / 6)), sdt = dt / steps;
      let removed = false;
      for (let s = 0; s < steps && !removed; s++) {
        const nx = p.x + p.vx * sdt, ny = p.y + p.vy * sdt;
        p.dist += sp * sdt;
        if (solidAt(nx, ny)) {
          ev({ k: 'wall', x: p.x, y: p.y });
          if (p.bounces > 0) {
            const bx = solidAt(nx, p.y), by = solidAt(p.x, ny);
            if (bx || (!bx && !by)) p.vx = -p.vx;
            if (by || (!bx && !by)) p.vy = -p.vy;
            p.bounces--; p.a = Math.atan2(p.vy, p.vx);
          } else { removed = true; break; }
        } else { p.x = nx; p.y = ny; }
        const keys = G.players;
        keys.forEach(function (t) {
          if (removed || t.dead || t.id === p.o) return;
          const rr = R + p.r;
          if ((t.x - p.x) * (t.x - p.x) + (t.y - p.y) * (t.y - p.y) < rr * rr) {
            let dmg = p.dmg, crit = false;
            if (p.ty === 'arrow') {
              dmg = 14 + Math.min(p.dist, 1100) * 0.055;
              if (p.dist > 420) { dmg *= 1.45; crit = true; }
              dmg = Math.min(80, dmg);
            }
            dealDamage(t, dmg, Math.atan2(-p.vy, -p.vx), p.o, crit);
            removed = true;
          }
        });
      }
      if (removed) { if (p.ty === 'orb') ev({ k: 'impact', x: p.x, y: p.y, el: p.el }); G.proj.splice(i, 1); }
    }
  }

  function updateWaves(dt) {
    for (let i = G.waves.length - 1; i >= 0; i--) { G.waves[i].life -= dt; if (G.waves[i].life <= 0) G.waves.splice(i, 1); }
  }

  /* simple bot brain: chase / kite the nearest living opponent */
  function botThink(p, dt) {
    const inp = p.inp;
    if (p.dead) { inp.f = 0; return; }
    let tgt = null, bd = 1e9;
    G.players.forEach(function (q) {
      if (q === p || q.dead || (G.attract && q.id === G.myId)) return;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; tgt = q; }
    });
    inp.u = inp.d = inp.l = inp.r = inp.f = 0;
    if (!tgt) return;
    const ranged = p.weapon === 'gun' || p.weapon === 'bow' || p.weapon === 'staff' || p.weapon === 'shuriken';
    const w = WEAPONS[p.weapon], ang = Math.atan2(tgt.y - p.y, tgt.x - p.x);
    p.ai.t -= dt;
    if (p.ai.t <= 0) { p.ai.t = rnd(0.6, 1.8); p.ai.strafe = Math.random() < 0.5 ? 1 : -1; p.ai.err = rnd(-0.14, 0.14); }
    const pref = ranged ? 260 : (p.weapon === 'hammer' ? 70 : 52);
    let mx = 0, my = 0;
    if (bd > pref + 30) { mx = Math.cos(ang); my = Math.sin(ang); }
    else if (ranged && bd < pref - 70) { mx = -Math.cos(ang); my = -Math.sin(ang); }
    mx += -Math.sin(ang) * p.ai.strafe * 0.7; my += Math.cos(ang) * p.ai.strafe * 0.7;
    inp.l = mx < -0.3 ? 1 : 0; inp.r = mx > 0.3 ? 1 : 0; inp.u = my < -0.3 ? 1 : 0; inp.d = my > 0.3 ? 1 : 0;
    inp.mx = p.x + Math.cos(ang + p.ai.err) * 200; inp.my = p.y + Math.sin(ang + p.ai.err) * 200;
    const reach = ranged ? 560 : (w.range || 80) + 22;
    inp.f = (bd < reach && losClear(p.x, p.y, tgt.x, tgt.y)) ? 1 : 0;
  }

  function hostStep(dt) {
    G.players.forEach(function (p) { if (p.bot) botThink(p, dt); });
    G.players.forEach(function (p) { updatePlayer(p, dt); });
    separatePlayers();
    updateProjectiles(dt);
    updateWaves(dt);
    const evs = G.events; G.events = [];
    for (let i = 0; i < evs.length; i++) handleEvent(evs[i]);
    if (Net.peerCount() > 0) { for (let i = 0; i < evs.length; i++) G.pending.push(evs[i]); }
  }

  /* ------------------------------------------------------------------ */
  /* network glue                                                        */
  /* ------------------------------------------------------------------ */
  function r1(v) { return Math.round(v * 10) / 10; }
  function buildSnapshot(send) {
    flushMapChanges(send);
    if (!send) { G.pending = []; return null; }
    const ps = [], pr = [], sw = [];
    G.players.forEach(function (p) {
      ps.push({
        i: p.id, n: p.name, c: p.color, x: r1(p.x), y: r1(p.y), a: Math.round(p.a * 1000) / 1000, hp: Math.round(p.hp),
        w: p.weapon, cd: Math.round(p.cd * 100) / 100, sh: Math.round(p.shieldT * 100) / 100, sa: Math.round(p.shieldAge * 100) / 100,
        d: p.dead ? 1 : 0, rt: Math.round(p.rt * 10) / 10, s: p.score, k: p.deaths, b: p.bot ? 1 : 0
      });
    });
    for (let i = 0; i < G.proj.length; i++) { const q = G.proj[i]; pr.push({ i: q.id, ty: q.ty, x: r1(q.x), y: r1(q.y), a: Math.round(q.a * 100) / 100, o: q.o, e: q.el, f: q.dist > 420 ? 1 : 0 }); }
    for (let i = 0; i < G.waves.length; i++) { const q = G.waves[i]; sw.push({ i: q.id, x: q.x, y: q.y, r: q.r, l: Math.round(q.life * 10) / 10, m: q.max }); }
    const snap = { t: 's', n: G.tick++, p: ps, pr: pr, sw: sw, ev: G.pending };
    G.pending = [];
    return snap;
  }
  function applySnapshot(s) {
    const seen = {};
    for (let i = 0; i < s.p.length; i++) {
      const d = s.p[i]; seen[d.i] = 1;
      let p = G.players.get(d.i);
      if (!p) { p = blankPlayer(d.i, d.n, d.c); p.x = d.x; p.y = d.y; G.players.set(d.i, p); }
      p.name = d.n; p.color = d.c; p.tx = d.x; p.ty = d.y; p.a = d.a; p.hp = d.hp; p.weapon = d.w; p.cd = d.cd;
      p.shieldT = d.sh; p.shieldAge = d.sa; p.dead = !!d.d; p.rt = d.rt; p.score = d.s; p.deaths = d.k; p.bot = !!d.b;
    }
    const gone = []; G.players.forEach(function (p, id) { if (!seen[id]) gone.push(id); });
    gone.forEach(function (id) { G.players.delete(id); });
    G.proj = s.pr.map(function (q) { return { id: q.i, ty: q.ty, x: q.x, y: q.y, a: q.a, o: q.o, el: q.e, f: q.f }; });
    G.waves = s.sw.map(function (q) { return { id: q.i, x: q.x, y: q.y, r: q.r, life: q.l, max: q.m }; });
    for (let i = 0; i < s.ev.length; i++) handleEvent(s.ev[i]);
    G.lastSnap = performance.now();
  }

  function getInput() {
    const k = G.keys, m = G.mouse;
    return {
      t: 'in', mx: Math.round(m.x), my: Math.round(m.y),
      u: (k.KeyW || k.ArrowUp) ? 1 : 0, d: (k.KeyS || k.ArrowDown) ? 1 : 0,
      l: (k.KeyA || k.ArrowLeft) ? 1 : 0, r: (k.KeyD || k.ArrowRight) ? 1 : 0,
      f: ((m.down && !G.paint) || k.Space) && !G.modalOpen ? 1 : 0
    };
  }
  function equipWeapon(type) {
    if (!WEAPONS[type]) return;
    if (G.isHost) {
      const p = me(); if (!p) return;
      p.weapon = type; p.cd = 0.3;
      ev({ k: 'equip', id: p.id });
    } else Net.sendHost({ t: 'equip', w: type });
  }

  function setupNet() {
    Net.on('ready', function (info) {
      G.isHost = info.host; G.myId = info.id; G.started = true;
      const tag = $('hostTag');
      if (info.host) {
        buildDefaultMap();
        addPlayer(G.myId, 'YOU', false);
        setBots(true);
        Net.startHostBroadcast(buildSnapshot, 60);
        if (tag) { tag.textContent = 'HOST'; tag.classList.remove('guest'); }
      } else {
        $('connecting').classList.remove('hidden');
        Net.startClientInput(getInput, 60);
        if (tag) { tag.textContent = 'GUEST'; tag.classList.add('guest'); }
        setPaintEnabled(false);
      }
    });
    Net.on('peerJoin', function (_, id) {
      if (!G.isHost) return;
      const p = addPlayer(id, 'PILOT-' + id.slice(0, 4).toUpperCase(), false);
      Net.sendTo(id, { t: 'welcome', id: id, map: mapToString() });
      pushKill(p.name + ' joined the grid');
    });
    Net.on('peerLeave', function (_, id) {
      if (!G.isHost) return;
      const p = G.players.get(id);
      if (p) { pushKill(p.name + ' left the grid'); G.players.delete(id); }
    });
    Net.on('in', function (d, from) {
      if (!G.isHost) return;
      const p = G.players.get(from); if (!p) return;
      const i = p.inp;
      i.mx = clamp(+d.mx || 0, 0, W); i.my = clamp(+d.my || 0, 0, H);
      i.u = d.u ? 1 : 0; i.d = d.d ? 1 : 0; i.l = d.l ? 1 : 0; i.r = d.r ? 1 : 0; i.f = d.f ? 1 : 0;
    });
    Net.on('equip', function (d, from) {
      if (!G.isHost || !WEAPONS[d.w]) return;
      const p = G.players.get(from); if (!p) return;
      p.weapon = d.w; p.cd = 0.3; ev({ k: 'equip', id: p.id });
    });
    Net.on('welcome', function (d) {
      if (G.isHost) return;
      G.myId = d.id; mapFromString(d.map);
      $('connecting').classList.add('hidden');
    });
    Net.on('map', function (d) {
      if (G.isHost) return;
      const c = d.c;
      for (let i = 0; i + 1 < c.length; i += 2) { const idx = c[i]; if (idx > 0 && idx < G.map.length) G.map[idx] = c[i + 1]; }
    });
    Net.on('mapfull', function (d) { if (!G.isHost) mapFromString(d.m); });
    Net.on('s', function (d) { if (!G.isHost) { applySnapshot(d); $('connecting').classList.add('hidden'); } });
    Net.on('hostLeft', function () { G.players.clear(); G.proj = []; G.waves = []; $('connecting').textContent = 'HOST DISCONNECTED'; $('connecting').classList.remove('hidden'); });
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
      case 'equip': tone(520, 0.1, 'square', 0.04, 1.6); setTimeout(function () { tone(780, 0.14, 'square', 0.04, 1.4); }, 90); break;
      default: break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* effects                                                             */
  /* ------------------------------------------------------------------ */
  function burst(x, y, col, n, speed, life, size) {
    n = Math.round(n * Settings.fx / 100);
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

  function clientStep(dt) {
    const k = 1 - Math.exp(-dt * 26);
    G.players.forEach(function (p) {
      if (Math.hypot(p.tx - p.x, p.ty - p.y) > 160) { p.x = p.tx; p.y = p.ty; }
      else { p.vx = (p.tx - p.x) * 20; p.vy = (p.ty - p.y) * 20; p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; }
    });
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

  function drawTerrain() {
    const t = G.time, map = G.map;
    for (let pass = 1; pass <= 5; pass++) {
      for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
        const v = map[cy * COLS + cx]; if (v !== pass) continue;
        const x = cx * CELL, y = cy * CELL, h = (cx * 13 + cy * 7) % 10 / 10;
        switch (v) {
          case T.WALL: {
            ctx.fillStyle = '#000'; ctx.fillRect(x, y, CELL, CELL);
            ctx.fillStyle = 'rgba(255,46,151,0.75)';
            if (cx > 0 && map[cy * COLS + cx - 1] !== T.WALL) ctx.fillRect(x, y, 2, CELL);
            if (cx < COLS - 1 && map[cy * COLS + cx + 1] !== T.WALL) ctx.fillRect(x + CELL - 2, y, 2, CELL);
            if (cy > 0 && map[(cy - 1) * COLS + cx] !== T.WALL) ctx.fillRect(x, y, CELL, 2);
            if (cy < ROWS - 1 && map[(cy + 1) * COLS + cx] !== T.WALL) ctx.fillRect(x, y + CELL - 2, CELL, 2);
            break;
          }
          case T.BOOST: {
            ctx.fillStyle = 'rgba(0,240,255,0.2)'; ctx.fillRect(x, y, CELL, CELL);
            const o = (t * 36 + h * 10) % 10;
            ctx.strokeStyle = 'rgba(120,255,255,0.85)'; ctx.lineWidth = 2; ctx.beginPath();
            ctx.moveTo(x + 3 + o, y + 4); ctx.lineTo(x + 9 + o, y + 10); ctx.lineTo(x + 3 + o, y + 16); ctx.stroke();
            break;
          }
          case T.ACID: {
            ctx.fillStyle = 'rgba(255,40,64,' + (0.26 + 0.1 * Math.sin(t * 3 + h * 6)) + ')'; ctx.fillRect(x, y, CELL, CELL);
            const by = y + CELL - ((t * 14 + h * CELL) % CELL);
            ctx.fillStyle = 'rgba(255,150,150,0.75)'; ctx.beginPath(); ctx.arc(x + 4 + h * 12, by, 1.8 + h, 0, TAU); ctx.fill();
            break;
          }
          case T.ICE: {
            ctx.fillStyle = 'rgba(70,130,255,0.3)'; ctx.fillRect(x, y, CELL, CELL);
            ctx.strokeStyle = 'rgba(255,255,255,' + (0.18 + 0.2 * Math.abs(Math.sin(t * 1.4 + h * 9))) + ')'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(x + 4, y + CELL - 4); ctx.lineTo(x + CELL - 4, y + 4); ctx.stroke();
            break;
          }
          case T.HEAL: {
            ctx.fillStyle = 'rgba(57,255,136,0.2)'; ctx.fillRect(x, y, CELL, CELL);
            ctx.fillStyle = 'rgba(160,255,200,' + (0.4 + 0.4 * Math.sin(t * 3 + h * 6)) + ')';
            ctx.fillRect(x + 8, y + 4, 4, 12); ctx.fillRect(x + 4, y + 8, 12, 4);
            break;
          }
          default: break;
        }
      }
    }
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

  function drawPlayer(p) {
    if (p.dead) return;
    const isMe = p.id === G.myId, w = WEAPONS[p.weapon] || WEAPONS.gun;
    if (p.slowed) { ctx.strokeStyle = 'rgba(255,176,0,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, R + 6, 0, TAU); ctx.stroke(); }
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.shadowColor = p.color; ctx.shadowBlur = 16; ctx.fillStyle = '#0a0e20'; ctx.strokeStyle = p.color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(Math.cos(p.a) * 5.5, Math.sin(p.a) * 5.5, 3.4, 0, TAU); ctx.fill();
    if (isMe) { ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(0, 0, R + 5, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
    if (p.weapon === 'bow' && sprOn()) {
      /* string draws back as the cooldown refills: frame 0 = relaxed, frame 4 = full draw with arrow nocked */
      const prog = 1 - clamp(p.cd / w.cd, 0, 1);
      Sprites.draw(ctx, 'bow', Math.min(4, Math.floor(prog * 5)), Math.cos(p.a) * (R + 14), Math.sin(p.a) * (R + 14), p.a, 0.62);
    } else WeaponIcons.draw(ctx, p.weapon, Math.cos(p.a) * (R + 14), Math.sin(p.a) * (R + 14), 13, w.color, p.a, 8);
    ctx.restore();

    if (p.shieldT > 0) {
      const prog = Math.min(1, p.shieldAge / 0.25), rr = 22 + prog * 26, al = Math.min(1, p.shieldT / 0.3);
      ctx.save(); ctx.translate(p.x, p.y);
      ctx.fillStyle = 'rgba(0,200,255,' + 0.16 * al + ')'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, rr, p.a - 1.25, p.a + 1.25); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(120,240,255,' + al + ')'; ctx.lineWidth = 5; ctx.shadowColor = '#42d9ff'; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(0, 0, rr, p.a - 1.25, p.a + 1.25); ctx.stroke();
      ctx.restore();
    }
    const bw = 34, f = clamp(p.hp / p.max, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(p.x - bw / 2 - 1, p.y - 27, bw + 2, 6);
    ctx.fillStyle = f > 0.5 ? '#39ff88' : f > 0.25 ? '#ffb000' : '#ff3d5e'; ctx.fillRect(p.x - bw / 2, p.y - 26, bw * f, 4);
    ctx.font = '11px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = isMe ? '#ffffff' : p.color; ctx.fillText(p.name, p.x, p.y - 32);
  }

  function drawFx() {
    G.fx.forEach(function (f) {
      const t = 1 - f.life / f.max;
      if (f.k === 'spr') {
        const d = SPRITE_DEFS[f.name];
        if (d) { ctx.save(); ctx.globalAlpha = clamp((1 - t) / 0.25, 0, 1); Sprites.draw(ctx, f.name, Math.min(d.n - 1, Math.floor(t * d.n)), f.x, f.y, f.rot, f.sc); ctx.restore(); }
        return;
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
    ctx.drawImage(bgLayer, 0, 0);
    if (G.shake > 0) ctx.translate(rnd(-G.shake, G.shake), rnd(-G.shake, G.shake));
    drawTerrain();
    if (G.paint) { ctx.drawImage(gridLayer, 0, 0); }
    drawWaves();
    G.players.forEach(drawPlayer);
    drawProjectiles();
    drawFx();
    if (G.paint && G.isHost) drawBrushPreview();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (G.paint) {
      ctx.fillStyle = 'rgba(180,255,57,0.9)'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
      ctx.fillText(G.isHost ? 'PAINT MODE: LMB paints, RMB erases' : 'PAINT MODE: HOST ONLY (you can watch)', W / 2, 20);
    }
  }

  /* ------------------------------------------------------------------ */
  /* HUD                                                                 */
  /* ------------------------------------------------------------------ */
  let hudWeapon = '', scoreTimer = 0;
  function updateHud(dt) {
    const p = me();
    if (p) {
      const w = WEAPONS[p.weapon];
      $('hpFill').style.width = clamp(p.hp / p.max, 0, 1) * 100 + '%';
      $('hpText').textContent = Math.max(0, Math.round(p.hp));
      $('cdFill').style.width = (w.cd > 0 ? clamp(1 - p.cd / w.cd, 0, 1) : 1) * 100 + '%';
      if (hudWeapon !== p.weapon) {
        hudWeapon = p.weapon;
        $('wName').textContent = w.name; $('wName').style.color = w.color;
        $('wMeta').textContent = w.stats[0][1] + ' | ' + w.stats[1][1];
        const c = $('hudIcon').getContext('2d'); c.clearRect(0, 0, 56, 56);
        WeaponIcons.draw(c, p.weapon, 28, 28, 20, w.color, -0.5, 10);
      }
      const dead = p.dead;
      $('deathOverlay').classList.toggle('hidden', !dead);
      if (dead) $('deathTimer').textContent = 'Respawning in ' + Math.max(1, Math.ceil(p.rt));
    }
    scoreTimer -= dt;
    if (scoreTimer <= 0) {
      scoreTimer = 0.3;
      const arr = []; G.players.forEach(function (q) { arr.push(q); });
      arr.sort(function (a, b) { return b.score - a.score || a.deaths - b.deaths; });
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
      if (G.paint && G.isHost && (G.mouse.down || G.mouse.right)) {
        const t = G.mouse.right ? T.EMPTY : G.brush;
        if (G.mouse.lx === null) paintAt(G.mouse.x, G.mouse.y, t); else paintStroke(G.mouse.lx, G.mouse.ly, G.mouse.x, G.mouse.y, t);
        G.mouse.lx = G.mouse.x; G.mouse.ly = G.mouse.y;
      }
    });
    canvas.addEventListener('mousedown', function (e) {
      mouseToCanvas(e);
      if (actx && actx.state === 'suspended') actx.resume();
      if (e.button === 2) G.mouse.right = true; else G.mouse.down = true;
      if (G.paint && G.isHost) {
        const t = e.button === 2 ? T.EMPTY : G.brush;
        paintAt(G.mouse.x, G.mouse.y, t); G.mouse.lx = G.mouse.x; G.mouse.ly = G.mouse.y;
      }
    });
    window.addEventListener('mouseup', function (e) { if (e.button === 2) G.mouse.right = false; else G.mouse.down = false; G.mouse.lx = null; });
    canvas.addEventListener('wheel', function (e) { if (!G.paint || !G.isHost) return; e.preventDefault(); setBrushSize(G.brushSize + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
    window.addEventListener('blur', releaseInputs);

    window.addEventListener('keydown', function (e) {
      if (e.target && (e.target.tagName === 'INPUT') && e.target.type !== 'range') return;
      if (e.code === 'Escape') { if (Menu.isOpen()) Menu.escape(); else if (DrawPad.isOpen()) DrawPad.close(); else if (G.paint) setPaint(false); else Menu.open(); return; }
      if (G.modalOpen) return;
      G.keys[e.code] = true;
      if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
      if (e.code === 'KeyE') DrawPad.open();
      else if (e.code === 'KeyP' && G.isHost) setPaint(!G.paint);
      else if (G.isHost && /^Digit[1-6]$/.test(e.code)) { const n = +e.code.slice(5); setBrush(n === 6 ? 0 : n); if (!G.paint) setPaint(true); }
    });
    window.addEventListener('keyup', function (e) { G.keys[e.code] = false; if (e.code === 'Space') e.preventDefault(); });
    document.addEventListener('click', function (e) { if (e.target && e.target.tagName === 'BUTTON') e.target.blur(); });

    $('forgeBtn').addEventListener('click', function () { DrawPad.open(); });
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
    setBrush(T.WALL); setBrushSize(2);

    DrawPad.init({
      onEquip: equipWeapon,
      onOpen: function () { G.pad = true; syncModal(); },
      onClose: function () { G.pad = false; syncModal(); }
    });
    Menu.init({
      onOpen: function () { G.menu = true; syncModal(); },
      onClose: function () { G.menu = false; syncModal(); },
      onPlay: function () { const a = audio(); if (a && a.state === 'suspended') a.resume(); }
    });
  }

  /* ------------------------------------------------------------------ */
  /* main loop                                                           */
  /* ------------------------------------------------------------------ */
  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    G.time += dt;
    G.attract = G.menu && Net.peerCount() === 0;
    if (G.isHost && G.started) {
      const p = me();
      if (p) { const inp = getInput(); p.inp.mx = inp.mx; p.inp.my = inp.my; p.inp.u = inp.u; p.inp.d = inp.d; p.inp.l = inp.l; p.inp.r = inp.r; p.inp.f = inp.f; }
      acc += dt;
      while (acc >= STEP) { hostStep(STEP); acc -= STEP; }
    } else if (!G.isHost) clientStep(dt);
    updateFx(dt);
    render();
    updateHud(dt);
    requestAnimationFrame(frame);
  }

  function boot() {
    buildDefaultMap();
    wireUi();
    setupNet();
    Net.init();
    Menu.open();
    requestAnimationFrame(frame);
  }
  boot();
})();
