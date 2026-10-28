/* ============================================================================
   menu.js - title / pause menu with "line boil" PLAY and SETTINGS buttons,
   plus the persisted Settings object read by the engine.

   Line boil: the outline of hand-drawn art is redrawn slightly differently every
   few frames. We cycle the 10 hand-jittered frames of each word at ~9 fps, with the
   two words out of phase so they never wobble in unison.
   ============================================================================ */

const Settings = (function () {
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const S = { vol: 70, shake: 100, fx: 100, sprites: true, boil: !reduced };
  try {
    const raw = window.localStorage.getItem('ccc.settings');
    if (raw) { const o = JSON.parse(raw); Object.keys(S).forEach(function (k) { if (k in o && typeof o[k] === typeof S[k]) S[k] = o[k]; }); }
  } catch (e) { /* storage unavailable: keep defaults */ }
  Object.defineProperty(S, 'save', {
    enumerable: false,
    value: function () { try { window.localStorage.setItem('ccc.settings', JSON.stringify(S)); } catch (e) { /* ignore */ } }
  });
  return S;
})();

const Menu = (function () {
  'use strict';
  const BOIL_MS = 110;
  const COLORS = {
    idle: { fill: '#dff6ff', glow: 'rgba(0,240,255,0.85)' },
    hot: { fill: '#ffffff', glow: 'rgba(255,46,151,0.95)' }
  };
  let el, settingsPanel, mainPanel, cfg = {}, open_ = false, timer = null, tick = 0;
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

  function showSettings(on) {
    settingsPanel.classList.toggle('hidden', !on);
    mainPanel.classList.toggle('hidden', on);
    if (on) { const f = settingsPanel.querySelector('input'); if (f) f.focus(); }
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
    [['setSprites', 'sprites'], ['setBoil', 'boil']].forEach(function (r) {
      const input = $(r[0]); input.checked = !!Settings[r[1]];
      input.addEventListener('change', function () {
        Settings[r[1]] = input.checked; Settings.save(); redraw();
        if (cfg.onChange) cfg.onChange(r[1]);
      });
    });
  }

  function init(opts) {
    cfg = opts || {};
    el = $('menu'); settingsPanel = $('menuSettings'); mainPanel = $('menuMain');
    const play = $('menuPlay'), sett = $('menuSettingsBtn');
    makeBoil(play, 'play', 3, 0);
    makeBoil(sett, 'settings', 2, 4);
    play.addEventListener('click', function () { if (cfg.onPlay) cfg.onPlay(); close(); });
    sett.addEventListener('click', function () { showSettings(true); });
    $('menuBack').addEventListener('click', function () { showSettings(false); });
    bindSettings();
    Sprites.whenReady(redraw);
  }

  /* Esc behaviour: back out of settings first, then resume. */
  function escape() {
    if (!open_) return false;
    if (!settingsPanel.classList.contains('hidden')) showSettings(false); else close();
    return true;
  }

  return { init: init, open: open, close: close, escape: escape, isOpen: function () { return open_; } };
})();
