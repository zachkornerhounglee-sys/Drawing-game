/* ============================================================================
   network.js - PeerJS WebRTC peer-to-peer layer
   Host authority: the first player hosts, guests join with ?room=HOST_PEER_ID.
   Host broadcasts world snapshots at 60 Hz; guests send input at 60 Hz.
   If PeerJS or the signalling server is unreachable the game falls back to a
   playable offline solo-host mode.
   ============================================================================ */

const Net = (function () {
  'use strict';

  const S = { peer: null, isHost: true, myId: 'local', conns: new Map(), hostConn: null, ready: false, solo: false, roomLink: '', joining: false };
  const HANDLERS = {};
  let bTimer = null, iTimer = null, joinTimer = null, initToken = 0, peerLoadStarted = false, peerLoadDone = false, peerLoadResult = false, peerLoadCallbacks = [];

  /* WebRTC connectivity: several STUN servers plus public TURN relays (used only when a direct
     route between two networks cannot be negotiated). window.CCC_PEER_CONFIG can override the PeerJS
     options, e.g. { host: 'my-peer-server.example', port: 443, secure: true, path: '/' }. */
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }, { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }
  ];
  function peerOpts() {
    const o = { debug: 0, config: { iceServers: ICE_SERVERS, iceCandidatePoolSize: 2 } };
    const c = window.CCC_PEER_CONFIG;
    if (c && typeof c === 'object') Object.keys(c).forEach(function (k) { o[k] = c[k]; });
    return o;
  }
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
    else el.textContent = S.ready ? 'CONNECTED' : 'JOINING';
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

  function setConnecting(message) {
    const el = $('connecting');
    if (!el) return;
    el.textContent = message || 'CONNECTING TO MATCH...';
    el.classList.remove('hidden');
  }
  function clearConnecting() { const el = $('connecting'); if (el) el.classList.add('hidden'); }
  function hideJoinError() { const e = $('joinError'); if (e) e.remove(); }
  function showJoinFailure(reason) {
    S.ready = false; S.solo = false; S.joining = false; S.isHost = false;
    if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
    hideLink(); clearConnecting();
    setStatus('JOIN FAILED', 'bad'); updateCount();
    let box = $('joinError');
    if (!box) {
      box = document.createElement('section'); box.id = 'joinError'; box.className = 'panel';
      const title = document.createElement('div'); title.className = 'je-title'; title.textContent = 'COULD NOT JOIN ROOM';
      const detail = document.createElement('div'); detail.className = 'je-detail'; detail.id = 'joinErrorDetail';
      const actions = document.createElement('div'); actions.className = 'je-actions';
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn primary'; retry.textContent = 'RETRY JOIN';
      retry.addEventListener('click', function () {
        hideJoinError(); setConnecting('RECONNECTING TO ROOM...');
        S.joining = true; init();
      });
      const back = document.createElement('button'); back.type = 'button'; back.className = 'btn ghost'; back.textContent = 'BACK TO MENU';
      back.addEventListener('click', function () {
        const u = new URL(window.location.href); u.searchParams.delete('room');
        history.replaceState({}, '', u.toString());
        hideJoinError(); clearConnecting(); S.joining = false; S.isHost = true;
        setStatus('CHOOSE MODE', '');
        if (typeof Menu !== 'undefined') Menu.open();
      });
      actions.appendChild(retry); actions.appendChild(back);
      box.appendChild(title); box.appendChild(detail); box.appendChild(actions);
      const stage = $('stage') || document.body; stage.appendChild(box);
    }
    const detail = $('joinErrorDetail');
    if (detail) detail.textContent = 'The invite link could not connect to its host (' + String(reason || 'network unavailable').replace(/[<>]/g, '') + '). The game will not create a different room by accident. Check the link and network, then retry.';
  }

  function loadPeerJs(done) {
    if (typeof Peer !== 'undefined') { done(true); return; }
    if (peerLoadDone && peerLoadResult) { done(true); return; }
    if (peerLoadDone && !peerLoadResult) { peerLoadDone = false; peerLoadResult = false; }
    peerLoadCallbacks.push(done);
    if (peerLoadStarted) return;
    peerLoadStarted = true;
    const urls = [
      'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
      'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
    ];
    let index = 0, finished = false, timer = null;
    function finish(ok) {
      if (finished) return; finished = true;
      if (timer) clearTimeout(timer);
      peerLoadDone = true; peerLoadResult = !!ok; peerLoadStarted = false;
      const callbacks = peerLoadCallbacks.slice(); peerLoadCallbacks = [];
      callbacks.forEach(function (cb) { try { cb(!!ok); } catch (e) { console.error(e); } });
    }
    function next() {
      if (typeof Peer !== 'undefined') { finish(true); return; }
      if (index >= urls.length) { finish(false); return; }
      const url = urls[index++];
      const script = document.createElement('script');
      script.async = true; script.src = url; script.crossOrigin = 'anonymous';
      script.onload = function () { if (timer) clearTimeout(timer); if (typeof Peer !== 'undefined') finish(true); else next(); };
      script.onerror = function () { if (timer) clearTimeout(timer); if (script.parentNode) script.parentNode.removeChild(script); next(); };
      timer = setTimeout(function () { if (script.parentNode) script.parentNode.removeChild(script); next(); }, 6500);
      document.head.appendChild(script);
    }
    next();
  }

  function copyLink() {
    const input = $('roomLink'), btn = $('copyLink');
    if (!input) return;
    const done = function () { if (btn) { const t = btn.textContent; btn.textContent = 'COPIED'; setTimeout(function () { btn.textContent = t; }, 1200); } };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(done, function () { input.select(); document.execCommand('copy'); done(); });
    } else { input.select(); document.execCommand('copy'); done(); }
  }

  function goSolo(reason, force) {
    if (S.ready && !force) return;
    if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
    S.isHost = true; S.solo = true; S.myId = 'local'; S.ready = true; S.joining = false;
    hideLink(); hideJoinError(); clearConnecting();
    setStatus('SOLO (OFFLINE)' + (reason ? ' - ' + reason : ''), 'warn');
    updateCount();
    fire('ready', { host: true, id: 'local', solo: true });
  }

  function startSolo() {
    initToken++;
    if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
    stopBroadcast(); stopInput();
    if (S.peer) { try { S.peer.destroy(); } catch (_) {} }
    S.peer = null; S.hostConn = null; S.conns.clear(); S.ready = false; S.solo = false; S.joining = false;
    goSolo('single-player', true);
  }

  function wireHostConn(conn) {
    conn.on('open', function () {
      S.conns.set(conn.peer, conn); updateCount(); fire('peerJoin', null, conn.peer);
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
    if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
    S.isHost = true; S.ready = false; S.solo = false; S.joining = false;
    if (S.peer) { try { S.peer.destroy(); } catch (_) {} }
    let tries = 0; const maxTries = 3; const token = initToken;
    function tryHost() {
      if (token !== initToken) return;
      tries++;
      setStatus(tries === 1 ? 'CREATING ROOM...' : 'RETRYING HOST ' + tries + '/' + maxTries, 'warn');
      let peer;
      try { peer = new Peer(undefined, peerOpts()); }
      catch (e) {
        if (tries < maxTries) { setTimeout(tryHost, 700 * tries); return; }
        goSolo('network unavailable'); return;
      }
      S.peer = peer;
      let done = false;
      function fail(reason) {
        if (done || S.peer !== peer || S.ready) return;
        done = true;
        if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
        try { peer.destroy(); } catch (_) {}
        if (S.peer === peer) S.peer = null;
        if (tries < maxTries) { setStatus('RETRYING HOST ' + (tries + 1) + '/' + maxTries, 'warn'); setTimeout(tryHost, 700 * tries); }
        else goSolo(reason || 'network unavailable');
      }
      peer.on('open', function (id) {
        if (done || S.peer !== peer || token !== initToken) return;
        done = true; if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
        S.myId = id; S.ready = true; S.solo = false;
        showLink(id); hideJoinError(); clearConnecting(); setStatus('HOSTING', 'ok'); updateCount();
        fire('ready', { host: true, id: id, solo: false });
      });
      peer.on('connection', wireHostConn);
      peer.on('error', function (err) {
        console.warn('[Net] host peer error', err && err.type);
        if (!S.ready) fail(err && err.type || 'signalling error');
        else setStatus('NET WARNING: ' + (err && err.type || 'connection'), 'warn');
      });
      peer.on('disconnected', function () {
        if (!S.ready || S.solo) return;
        setStatus('RECONNECTING SIGNAL...', 'warn');
        try { peer.reconnect(); } catch (_) { setStatus('SIGNAL LOST (PEERS MAY STAY LIVE)', 'warn'); }
      });
      joinTimer = setTimeout(function () { fail('signalling timeout'); }, 12000);
    }
    tryHost();
  }

  function joinRoom(room) {
    room = String(room || '').trim();
    if (!room || room.length > 256) { showJoinFailure('invalid invite link'); return; }
    S.isHost = false; S.ready = false; S.solo = false; S.joining = true;
    let tries = 0; const maxTries = 3; const token = initToken; let finished = false;
    setConnecting('CONNECTING TO ROOM...');
    function attempt() {
      if (token !== initToken || finished) return;
      tries++;
      setStatus(tries === 1 ? 'JOINING ROOM...' : 'RETRYING JOIN ' + tries + '/' + maxTries, 'warn');
      let peer;
      try { peer = new Peer(undefined, peerOpts()); }
      catch (e) { retry('peer setup failed'); return; }
      S.peer = peer; let conn = null, localDone = false;
      function retry(reason) {
        if (localDone || finished || token !== initToken) return;
        localDone = true;
        if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
        if (S.peer === peer) S.peer = null;
        S.hostConn = null;
        try { peer.destroy(); } catch (_) {}
        if (tries < maxTries) {
          setStatus('RETRYING JOIN ' + (tries + 1) + '/' + maxTries, 'warn');
          setConnecting('RETRYING ROOM CONNECTION...');
          setTimeout(attempt, 500 * tries);
        } else { finished = true; showJoinFailure(reason || 'room unavailable'); }
      }
      peer.on('open', function (id) {
        if (finished || localDone || token !== initToken || S.peer !== peer) return;
        S.myId = id;
        try { conn = peer.connect(room, { reliable: true, serialization: 'json' }); }
        catch (e) { retry('could not open room connection'); return; }
        S.hostConn = conn;
        conn.on('open', function () {
          if (finished || localDone || token !== initToken || S.peer !== peer) return;
          localDone = true; finished = true;
          if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
          S.ready = true; S.solo = false; S.joining = false;
          hideLink(); hideJoinError(); updateCount(); setStatus('CONNECTED', 'ok'); clearConnecting();
          fire('ready', { host: false, id: id, solo: false });
        });
        conn.on('data', function (d) { if (d && d.t) fire(d.t, d, conn.peer); });
        conn.on('close', function () {
          if (!S.ready) { retry('host did not accept the connection'); return; }
          setStatus('HOST DISCONNECTED', 'bad'); stopInput(); fire('hostLeft');
        });
        conn.on('error', function (err) {
          if (!S.ready) retry(err && err.type || 'room connection error');
          else setStatus('LINK WARNING', 'bad');
        });
      });
      peer.on('error', function (err) {
        if (S.ready || finished || localDone || S.peer !== peer) return;
        console.warn('[Net] join attempt failed', err && err.type);
        retry(err && err.type || 'signalling error');
      });
      peer.on('disconnected', function () {
        if (S.ready || finished || S.peer !== peer) return;
        try { peer.reconnect(); } catch (_) { retry('signalling disconnected'); }
      });
      joinTimer = setTimeout(function () {
        if (!S.ready && !finished && !localDone && S.peer === peer) retry(conn ? 'host connection timed out' : 'signalling timed out');
      }, 8500);
    }
    attempt();
  }

  let copyBound = false;
  function init() {
    const btn = $('copyLink');
    if (btn && !copyBound) { btn.addEventListener('click', copyLink); copyBound = true; }
    if (!S.byeBound) {
      S.byeBound = true;
      /* tell the host immediately when this tab closes, instead of making it wait for a timeout */
      window.addEventListener('pagehide', function () {
        if (!S.isHost && S.hostConn) { try { S.hostConn.send({ t: 'bye' }); S.hostConn.close(); } catch (e) { /* ignore */ } }
      });
    }
    if (S.ready && S.peer && !S.solo) return;
    const token = ++initToken;
    if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
    if (S.peer) { try { S.peer.destroy(); } catch (_) {} }
    S.peer = null; S.ready = false; S.solo = false; S.hostConn = null; S.conns.clear();
    const room = new URLSearchParams(window.location.search).get('room');
    S.joining = !!room;
    if (room) { setConnecting('CONNECTING TO ROOM...'); setStatus('LOADING ROOM...', 'warn'); }
    else setStatus('LOADING MULTIPLAYER...', 'warn');
    loadPeerJs(function (ok) {
      if (token !== initToken) return;
      if (!ok || typeof Peer === 'undefined') {
        if (room) showJoinFailure('PeerJS could not load (CDNs may be blocked)');
        else goSolo('PeerJS could not load');
        return;
      }
      if (room) joinRoom(room); else startAsHost();
    });
  }

  function broadcast(msg) { S.conns.forEach(function (c) { if (c.open) { try { c.send(msg); } catch (e) { console.warn('[Net] send failed', e); } } }); }
  function sendTo(id, msg) { const c = S.conns.get(id); if (c && c.open) { try { c.send(msg); } catch (e) { console.warn('[Net] send failed', e); } } }
  function sendHost(msg) { if (S.hostConn && S.hostConn.open) { try { S.hostConn.send(msg); } catch (e) { console.warn('[Net] input send failed', e); } } }
  function peerCount() { return S.conns.size; }
  /* Snapshots are sent unreliably-fresh: if a peer's send buffer is backed up (slow link) we skip that
     peer for this tick instead of piling up latency. */
  function sendSnapshot(msg) {
    S.conns.forEach(function (c) {
      if (!c.open) return;
      const dc = c.dataChannel;
      if (dc && dc.bufferedAmount > 65536) { S.skipped = (S.skipped || 0) + 1; return; }
      try { c.send(msg); } catch (e) { console.warn('[Net] snapshot send failed', e); }
    });
  }
  /* forget a guest that went silent */
  function drop(id) {
    const c = S.conns.get(id);
    if (c) { try { c.close(); } catch (_) { /* ignore */ } S.conns.delete(id); updateCount(); fire('peerLeave', null, id); }
  }
  /* guests: show the round-trip time in the status chip */
  function setQuality(ms) {
    if (S.isHost || !S.ready) return;
    setStatus('CONNECTED - ' + ms + ' MS', ms < 150 ? 'ok' : ms < 300 ? 'warn' : 'bad');
  }
  function startHostBroadcast(buildSnapshot, hz) {
    stopBroadcast();
    bTimer = setInterval(function () {
      if (S.conns.size === 0) { buildSnapshot(false); return; }
      const snap = buildSnapshot(true);
      if (snap) broadcast(snap);
    }, 1000 / (hz || 30));
  }
  function stopBroadcast() { if (bTimer) { clearInterval(bTimer); bTimer = null; } }
  function startClientInput(getInput, hz) {
    stopInput();
    iTimer = setInterval(function () { sendHost(getInput()); }, 1000 / (hz || 30));
  }
  function stopInput() { if (iTimer) { clearInterval(iTimer); iTimer = null; } }

  return {
    state: S, on: on, init: init, startSolo: startSolo, broadcast: broadcast, sendTo: sendTo, sendHost: sendHost,
    sendSnapshot: sendSnapshot, drop: drop, setQuality: setQuality,
    peerCount: peerCount, startHostBroadcast: startHostBroadcast, startClientInput: startClientInput,
    stopBroadcast: stopBroadcast, stopInput: stopInput
  };
})();
