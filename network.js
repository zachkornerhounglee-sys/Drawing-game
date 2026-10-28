/* ============================================================================
   network.js - PeerJS WebRTC peer-to-peer layer
   Host authority: the first player hosts, guests join with ?room=HOST_PEER_ID.
   Host broadcasts world snapshots at 60 Hz; guests send input at 60 Hz.
   If PeerJS or the signalling server is unreachable the game falls back to a
   playable offline solo-host mode.
   ============================================================================ */

const Net = (function () {
  'use strict';

  const S = { peer: null, isHost: true, myId: 'local', conns: new Map(), hostConn: null, ready: false, solo: false, roomLink: '' };
  const HANDLERS = {};
  let bTimer = null, iTimer = null, joinTimer = null;

  function on(type, fn) { HANDLERS[type] = fn; }
  function fire(type, data, from) {
    const fn = HANDLERS[type];
    if (!fn) return;
    try { fn(data, from); } catch (e) { console.error('[Net] handler error in "' + type + '"', e); }
  }
  function $(id) { return document.getElementById(id); }

  function setStatus(text, cls) {
    const el = $('netStatus');
    if (el) { el.textContent = text; el.className = 'chip ' + (cls || ''); }
  }
  function updateCount() {
    const el = $('peerCount');
    if (!el) return;
    if (S.isHost) { const n = S.conns.size + 1; el.textContent = n + (n === 1 ? ' PILOT' : ' PILOTS'); }
    else el.textContent = 'GUEST';
  }
  function buildLink(id) {
    const u = new URL(window.location.href);
    u.search = ''; u.hash = '';
    u.searchParams.set('room', id);
    return u.toString();
  }
  function showLink(id) {
    S.roomLink = buildLink(id);
    const box = $('roomBox'), input = $('roomLink');
    if (box && input) { input.value = S.roomLink; box.classList.remove('hidden'); }
  }
  function hideLink() { const box = $('roomBox'); if (box) box.classList.add('hidden'); }

  function copyLink() {
    const input = $('roomLink'), btn = $('copyLink');
    if (!input) return;
    const done = function () { if (btn) { const t = btn.textContent; btn.textContent = 'COPIED'; setTimeout(function () { btn.textContent = t; }, 1200); } };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(done, function () { input.select(); document.execCommand('copy'); done(); });
    } else { input.select(); document.execCommand('copy'); done(); }
  }

  function goSolo(reason) {
    if (S.ready) return;
    S.isHost = true; S.solo = true; S.myId = 'local'; S.ready = true;
    hideLink();
    setStatus('SOLO (OFFLINE)' + (reason ? ' - ' + reason : ''), 'warn');
    updateCount();
    fire('ready', { host: true, id: 'local', solo: true });
  }

  function wireHostConn(conn) {
    conn.on('open', function () {
      S.conns.set(conn.peer, conn);
      updateCount();
      fire('peerJoin', null, conn.peer);
    });
    conn.on('data', function (d) { if (d && d.t) fire(d.t, d, conn.peer); });
    conn.on('close', function () {
      S.conns.delete(conn.peer); updateCount(); fire('peerLeave', null, conn.peer);
    });
    conn.on('error', function () {
      S.conns.delete(conn.peer); updateCount(); fire('peerLeave', null, conn.peer);
    });
  }

  function startAsHost() {
    S.isHost = true; S.ready = false;
    if (S.peer) { try { S.peer.destroy(); } catch (_) { /* ignore */ } }
    setStatus('CONNECTING TO SIGNAL...', 'warn');
    let peer;
    try { peer = new Peer(); } catch (e) { goSolo('no peer lib'); return; }
    S.peer = peer;
    peer.on('open', function (id) {
      S.myId = id; S.ready = true;
      showLink(id);
      setStatus('HOSTING', 'ok');
      updateCount();
      fire('ready', { host: true, id: id, solo: false });
    });
    peer.on('connection', wireHostConn);
    peer.on('error', function (err) {
      console.warn('[Net] peer error', err && err.type);
      if (!S.ready) goSolo(err && err.type);
      else setStatus('NET ERROR: ' + (err && err.type), 'bad');
    });
    peer.on('disconnected', function () { if (S.ready && !S.solo) { setStatus('SIGNAL LOST (PEERS STAY LIVE)', 'warn'); } });
    setTimeout(function () { if (!S.ready) goSolo('signal timeout'); }, 9000);
  }

  function joinRoom(room) {
    S.isHost = false; S.ready = false;
    setStatus('JOINING ' + room.slice(0, 6) + '...', 'warn');
    let peer;
    try { peer = new Peer(); } catch (e) { startAsHost(); return; }
    S.peer = peer;
    peer.on('open', function (id) {
      S.myId = id;
      const conn = peer.connect(room, { reliable: true });
      S.hostConn = conn;
      conn.on('open', function () {
        clearTimeout(joinTimer);
        S.ready = true; hideLink(); updateCount();
        setStatus('CONNECTED', 'ok');
        fire('ready', { host: false, id: id, solo: false });
      });
      conn.on('data', function (d) { if (d && d.t) fire(d.t, d, conn.peer); });
      conn.on('close', function () { setStatus('HOST DISCONNECTED', 'bad'); stopInput(); fire('hostLeft'); });
      conn.on('error', function () { setStatus('LINK ERROR', 'bad'); });
    });
    peer.on('error', function (err) {
      if (S.ready) { setStatus('NET ERROR: ' + (err && err.type), 'bad'); return; }
      console.warn('[Net] join failed', err && err.type);
      try { peer.destroy(); } catch (_) { /* ignore */ }
      startAsHost();
    });
    joinTimer = setTimeout(function () {
      if (!S.ready) { try { peer.destroy(); } catch (_) { /* ignore */ } startAsHost(); }
    }, 12000);
  }

  function init() {
    const btn = $('copyLink'); if (btn) btn.addEventListener('click', copyLink);
    const room = new URLSearchParams(window.location.search).get('room');
    if (typeof Peer === 'undefined') { goSolo('PeerJS not loaded'); return; }
    if (room) joinRoom(room); else startAsHost();
  }

  function broadcast(msg) { S.conns.forEach(function (c) { if (c.open) c.send(msg); }); }
  function sendTo(id, msg) { const c = S.conns.get(id); if (c && c.open) c.send(msg); }
  function sendHost(msg) { if (S.hostConn && S.hostConn.open) S.hostConn.send(msg); }
  function peerCount() { return S.conns.size; }

  function startHostBroadcast(buildSnapshot, hz) {
    stopBroadcast();
    bTimer = setInterval(function () {
      if (S.conns.size === 0) { buildSnapshot(false); return; }
      const snap = buildSnapshot(true);
      if (snap) broadcast(snap);
    }, 1000 / (hz || 60));
  }
  function stopBroadcast() { if (bTimer) { clearInterval(bTimer); bTimer = null; } }
  function startClientInput(getInput, hz) {
    stopInput();
    iTimer = setInterval(function () { sendHost(getInput()); }, 1000 / (hz || 60));
  }
  function stopInput() { if (iTimer) { clearInterval(iTimer); iTimer = null; } }

  return {
    state: S, on: on, init: init, broadcast: broadcast, sendTo: sendTo, sendHost: sendHost,
    peerCount: peerCount, startHostBroadcast: startHostBroadcast, startClientInput: startClientInput,
    stopBroadcast: stopBroadcast, stopInput: stopInput
  };
})();
