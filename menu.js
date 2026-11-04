/* ============================================================================
   menu.js - title / pause menu with "line boil" PLAY and SETTINGS buttons,
   plus the persisted Settings object read by the engine.

   Line boil: the outline of hand-drawn art is redrawn slightly differently every
   few frames. We cycle the 10 hand-jittered frames of each word at ~9 fps, with the
   two words out of phase so they never wobble in unison.
   ============================================================================ */

const Settings = (function () {
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const DEFAULT_BINDS = { moveUp:'KeyW', moveDown:'KeyS', moveLeft:'KeyA', moveRight:'KeyD', fire:'Space', drawWeapon:'KeyE', pause:'Escape', toggleEditor:'KeyP', paintWall:'Digit1', paintBoost:'Digit2', paintAcid:'Digit3', paintIce:'Digit4', paintHeal:'Digit5', erase:'Digit6' };
  const S = { vol: 70, shake: 100, fx: 100, sprites: true, boil: !reduced, aiCount: 3, aimMouse: true, predict: true, keybinds: Object.assign({}, DEFAULT_BINDS) };
  try {
    const raw = window.localStorage.getItem('ccc.settings');
    if (raw) {
      const o = JSON.parse(raw);
      Object.keys(S).forEach(function (k) { if (k !== 'keybinds' && k in o && typeof o[k] === typeof S[k]) S[k] = o[k]; });
      if (o.keybinds && typeof o.keybinds === 'object') Object.keys(DEFAULT_BINDS).forEach(function (k) {
        if (typeof o.keybinds[k] === 'string' && /^[A-Za-z0-9]+$/.test(o.keybinds[k])) S.keybinds[k] = o.keybinds[k];
      });
    }
  } catch (e) { /* storage unavailable: keep defaults */ }
  S.aiCount = Math.max(0, Math.min(12, Math.round(Number(S.aiCount) || 0)));
  Object.defineProperty(S, 'save', {
    enumerable: false,
    value: function () { try { window.localStorage.setItem('ccc.settings', JSON.stringify(S)); } catch (e) { /* ignore */ } }
  });
  return S;
})();


/* ---------------------------------------------------------------------------
   Update log (newest first). Shown from the title menu; a NEW badge appears until it is opened.
   --------------------------------------------------------------------------- */
const GAME_VERSION = 'v9';
const CHANGELOG = [
  {
    v: 'v9', date: '2026-10-30', title: 'Smarter drawing, 6 new weapons, rock-solid floors, better online play',
    groups: [
      ['New weapons (14 total)', [
        'SPEAR: long thrust that pierces every foe in line. Draw a long shaft with a small pointed head.',
        'BOOMERANG: thrown blade that flies out, hits, then returns. Draw a sharp V.',
        'BOMB: lobbed explosive that bounces and blasts on contact or fuse; the blast flings you too (rocket jumps). Draw a circle with a fuse.',
        'STORM ROD: instant chain lightning that arcs between up to 3 foes. Draw a zigzag bolt.',
        'WHIP: long lash that yanks the target toward you. Draw a smooth wavy line.',
        'CYCLONE: roaming twister that drags foes in and lifts them. Draw a spiral.'
      ]],
      ['Weapon recognition', [
        'Replaced the fixed-threshold rules with a trained recognizer (132 shape features, boosted trees).',
        'Tested on 4,200 generated mouse sketches (wobble, jitter, rotation, scribble fills, many drawing styles) it scores 97-99% across all 14 weapons. The old rules scored 82.6% on just 8 (staff, axe and hammer were the weak spots at 61-68%). Drawing styles unlike anything it was trained on score nearer 83% (mostly axe vs hammer), so very unusual designs can still be misread: watch the live guess.',
        'A confident answer (70%+) was right 99% of the time, so the percentage on screen is meaningful.',
        'LIVE GUESS panel: see the top 3 matches update after every stroke, before you commit.',
        'UNDO button (or Ctrl+Z) and a runner-up line in the equip notification.'
      ]],
      ['Fixes', [
        'FALL-THROUGH: players landing on each other were pushed down into the platform and dropped through (a test replay of v8\'s logic did this 1000 times out of 1000). Players now only push each other sideways, and a body nudged into a platform pops back onto it.',
        'FALL-THROUGH: falling off the map respawned you at a fixed height even where no platform existed, so you kept falling, took damage and could end at 0 HP while still alive. You now respawn on a real platform with a brief shield, and low-HP falls are fatal.',
        'Invisible leftover tiles from the old map editor blocked melee hits and bot line of sight. Removed.',
        'Knockback was clamped to walking speed the same frame it was applied, so hits barely moved anyone. It now carries and bleeds off smoothly.',
        'Attacks were locked to horizontal even though the hint said mouse aim. Mouse aim is back (Settings can switch to facing-only), and the held weapon points where you aim.',
        'Hit detection now uses a body capsule instead of the feet point, so aimed shots at a torso land.',
        'Bullets and shuriken ricochet off platform tops as their stats say; other shots stop on them.'
      ]],
      ['Movement', [
        'Double jump, a short ledge grace period, and drop-through (hold S) on any platform above the floor.'
      ]],
      ['Multiplayer', [
        'The host no longer freezes when its browser tab is in the background: the simulation clock now runs on a Web Worker.',
        'Guests interpolate between snapshots and predict their own movement, so controls feel immediate. Toggle in Settings.',
        'Compact snapshots: names and colors are sent only when they change, players are tiny arrays, and sends skip a peer whose connection is backed up instead of building lag.',
        'Ping shown in the status chip for guests. Hosts drop guests that go silent for 15 s.',
        'Weapon art is sent in separate small messages. Before, several players\' art in one welcome message could exceed the data-channel limit and fail to join.',
        'More STUN servers plus public TURN relays for strict NATs, and a hook for a custom signalling server (window.CCC_PEER_CONFIG).'
      ]],
      ['Performance', [
        'The stage, skyline and platform glow are rendered once and reused; they were redrawn with blur every frame.',
        'Player glows use a cached sprite instead of shadow blur; inputs, HUD and scoreboard only touch the page when something changed.',
        'Adaptive quality sheds particles automatically when the frame rate dips.'
      ]]
    ]
  },
  {
    v: 'v8', date: '', title: 'Platform fighter',
    groups: [['Highlights', [
      'Side-view platform fighting with a stage designer: draw your own platforms before each match.',
      'Your hand-drawn weapon art is shown in your fighter\'s hand.',
      'Title menu with Solo / Multiplayer, adjustable AI count (0-12) and rebindable keys.',
      'Invite links skip the menu and retry joining the exact room; PeerJS from two CDNs with fallback; 30 Hz network.'
    ]]]
  },
  {
    v: 'v1.1', date: '', title: 'Sprites and the boiling title',
    groups: [['Highlights', [
      'Pixel-art bow, arrows, slashes, energy bolts and elemental effects cut from the supplied sheets.',
      'Line-boil PLAY and SETTINGS title built from hand-jittered frames; settings panel with saved options.'
    ]]]
  },
  {
    v: 'v1.0', date: '', title: 'First release',
    groups: [['Highlights', [
      'Draw a weapon and have it recognized (8 types), paint terrain, bots, and peer-to-peer multiplayer.'
    ]]]
  }
];

const Menu = (function () {
  'use strict';
  const BOIL_MS = 110;
  const COLORS = {
    idle: { fill: '#dff6ff', glow: 'rgba(0,240,255,0.85)' },
    hot: { fill: '#ffffff', glow: 'rgba(255,46,151,0.95)' }
  };
  let el, settingsPanel, mainPanel, modesPanel, logPanel, cfg = {}, open_ = false, timer = null, tick = 0;
  const buttons = [];

  function $(id) { return document.getElementById(id); }

  function makeBoil(btn, key, scale, phase) {
    const d = TEXT_DEFS[key], cv = btn.querySelector('canvas');
    cv.width = d.w * scale; cv.height = d.h * scale;
    const c = cv.getContext('2d'), off = document.createElement('canvas');
    off.width = d.w; off.height = d.h;
    const o = off.getContext('2d');
    const b = { btn: btn, hot: false, phase: phase };
    b.draw = function () {
      if (!Sprites.ready()) return;
      const i = Settings.boil ? (tick + b.phase) % d.n : b.phase % d.n;
      const col = b.hot ? COLORS.hot : COLORS.idle;
      o.globalCompositeOperation = 'source-over';
      o.clearRect(0, 0, d.w, d.h);
      o.drawImage(Sprites.textImg, i * d.w, d.y, d.w, d.h, 0, 0, d.w, d.h);
      o.globalCompositeOperation = 'source-in';
      o.fillStyle = col.fill; o.fillRect(0, 0, d.w, d.h);
      c.clearRect(0, 0, cv.width, cv.height);
      c.imageSmoothingEnabled = false;
      c.shadowColor = col.glow; c.shadowBlur = b.hot ? 26 : 14;
      c.drawImage(off, 0, 0, cv.width, cv.height);
    };
    const hot = function (v) { return function () { b.hot = v; b.draw(); }; };
    btn.addEventListener('mouseenter', hot(true)); btn.addEventListener('mouseleave', hot(false));
    btn.addEventListener('focus', hot(true)); btn.addEventListener('blur', hot(false));
    buttons.push(b);
    return b;
  }

  function redraw() { buttons.forEach(function (b) { b.draw(); }); }
  function startLoop() {
    stopLoop();
    timer = setInterval(function () { tick++; if (open_ && !mainPanel.classList.contains('hidden')) redraw(); }, BOIL_MS);
  }
  function stopLoop() { if (timer) { clearInterval(timer); timer = null; } }

  function renderLog() {
    const body = $('logBody'); if (!body) return;
    body.innerHTML = '';
    CHANGELOG.forEach(function (rel, ri) {
      const box = document.createElement('div'); box.className = 'log-rel' + (ri === 0 ? ' latest' : '');
      const h = document.createElement('div'); h.className = 'log-head';
      const v = document.createElement('b'); v.textContent = rel.v; const t = document.createElement('span'); t.textContent = rel.title + (rel.date ? '  (' + rel.date + ')' : '');
      h.appendChild(v); h.appendChild(t); box.appendChild(h);
      rel.groups.forEach(function (g) {
        const gt = document.createElement('div'); gt.className = 'log-group'; gt.textContent = g[0]; box.appendChild(gt);
        const ul = document.createElement('ul');
        g[1].forEach(function (line) { const li = document.createElement('li'); li.textContent = line; ul.appendChild(li); });
        box.appendChild(ul);
      });
      body.appendChild(box);
    });
  }
  function logSeen() { try { return window.localStorage.getItem('ccc.seenLog') === GAME_VERSION; } catch (e) { return false; } }
  function markLogSeen() { try { window.localStorage.setItem('ccc.seenLog', GAME_VERSION); } catch (e) { /* ignore */ } const b = $('logNew'); if (b) b.classList.add('hidden'); }
  function showLog(on) {
    if (!logPanel) return;
    logPanel.classList.toggle('hidden', !on);
    settingsPanel.classList.add('hidden'); modesPanel.classList.add('hidden');
    mainPanel.classList.toggle('hidden', on);
    if (on) { markLogSeen(); const b = $('menuLogBack'); if (b) b.focus(); } else { const p = $('menuPlay'); if (p) p.focus(); }
  }
  function showSettings(on) {
    if (logPanel) logPanel.classList.add('hidden');
    settingsPanel.classList.toggle('hidden', !on);
    modesPanel.classList.add('hidden');
    mainPanel.classList.toggle('hidden', on);
    if (on) { const f = settingsPanel.querySelector('input'); if (f) f.focus(); }
    else { const p = $('menuPlay'); if (p) p.focus(); }
  }
  function showModes(on) {
    if (logPanel) logPanel.classList.add('hidden');
    settingsPanel.classList.add('hidden');
    modesPanel.classList.toggle('hidden', !on);
    mainPanel.classList.toggle('hidden', on);
    if (on) { const b = $('menuSoloBtn'); if (b) b.focus(); }
    else { const p = $('menuPlay'); if (p) p.focus(); }
  }

  function open() {
    if (open_) return;
    open_ = true; el.classList.remove('hidden'); showSettings(false);
    startLoop(); redraw();
    if (cfg.onOpen) cfg.onOpen();
  }
  function close() {
    if (!open_) return;
    open_ = false; el.classList.add('hidden'); stopLoop();
    if (cfg.onClose) cfg.onClose();
  }

  function bindSettings() {
    const rng = [['setVol', 'vol', 'setVolLabel'], ['setShake', 'shake', 'setShakeLabel'], ['setFx', 'fx', 'setFxLabel']];
    rng.forEach(function (r) {
      const input = $(r[0]), label = $(r[2]);
      input.value = Settings[r[1]]; label.textContent = Settings[r[1]];
      input.addEventListener('input', function () {
        Settings[r[1]] = +input.value; label.textContent = input.value; Settings.save();
        if (cfg.onChange) cfg.onChange(r[1]);
      });
    });
    [['setSprites', 'sprites'], ['setBoil', 'boil'], ['setAimMouse', 'aimMouse'], ['setPredict', 'predict']].forEach(function (r) {
      const input = $(r[0]); if (!input) return; input.checked = !!Settings[r[1]];
      input.addEventListener('change', function () {
        Settings[r[1]] = input.checked; Settings.save(); redraw();
        if (cfg.onChange) cfg.onChange(r[1]);
      });
    });
    const aiInput = $('setAiCount'), aiLabel = $('setAiCountLabel');
    if (aiInput && aiLabel) {
      aiInput.value = Settings.aiCount; aiLabel.textContent = Settings.aiCount;
      aiInput.addEventListener('input', function () {
        Settings.aiCount = Math.max(0, Math.min(12, +aiInput.value || 0));
        aiLabel.textContent = String(Settings.aiCount); Settings.save();
      });
      aiInput.addEventListener('change', function () { if (cfg.onChange) cfg.onChange('aiCount'); });
    }
  }

  function init(opts) {
    cfg = opts || {};
    el = $('menu'); settingsPanel = $('menuSettings'); mainPanel = $('menuMain'); modesPanel = $('menuModes'); logPanel = $('menuLog');
    renderLog();
    const nb = $('logNew'); if (nb && logSeen()) nb.classList.add('hidden');
    if ($('menuLogBtn')) $('menuLogBtn').addEventListener('click', function () { showLog(true); });
    if ($('menuLogBack')) $('menuLogBack').addEventListener('click', function () { showLog(false); });
    const play = $('menuPlay'), sett = $('menuSettingsBtn');
    makeBoil(play, 'play', 3, 0);
    makeBoil(sett, 'settings', 2, 4);
    play.addEventListener('click', function () { if (cfg.onPlay) cfg.onPlay(); showModes(true); });
    sett.addEventListener('click', function () { showSettings(true); });
    $('menuBack').addEventListener('click', function () { showSettings(false); });
    $('menuModeBack').addEventListener('click', function () { showModes(false); });
    $('menuSoloBtn').addEventListener('click', function () { if (cfg.onSolo) cfg.onSolo(); close(); });
    $('menuMultiBtn').addEventListener('click', function () { if (cfg.onMultiplayer) cfg.onMultiplayer(); close(); });
    bindSettings();
    Sprites.whenReady(redraw);
  }

  /* Esc backs out of a submenu before leaving the menu. */
  function escape() {
    if (!open_) return false;
    if (logPanel && !logPanel.classList.contains('hidden')) showLog(false);
    else if (!settingsPanel.classList.contains('hidden')) showSettings(false);
    else if (!modesPanel.classList.contains('hidden')) showModes(false);
    else close();
    return true;
  }

  return { init: init, open: open, close: close, escape: escape, isOpen: function () { return open_; } };
})();
