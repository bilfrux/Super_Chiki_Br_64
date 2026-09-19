/**
 * MgpClient - browser WebSocket client for the MONAD GRAND PRIX server (protocol v1).
 * Contract: shared/protocol/PROTOCOL.md and shared/protocol/GAME_INTEGRATION.md.
 *
 * Server address: nothing is hardcoded.
 *   - default: the origin that served this page (the server serves /game, /driver, /test, /booster),
 *     so http -> ws and https -> wss, path /ws.
 *   - ?server=https://host  overrides it (page hosted somewhere else). Use MgpClient.link(path)
 *     when navigating so the override is carried along.
 *
 * Usage:
 *   var c = MgpClient.connect({
 *     role: 'screen' | 'driver',          // driver may add team: 'red'
 *     onState: function (raceState) {},   // RACE_STATE, ~20 Hz: the truth
 *     onEvent: function (event) {},       // BOOST / TEAM_ACTIVITY / MEME_EVENT / DRIVER_STEER (effect hints)
 *     onStatus: function (s, detail) {}   // 'connecting' | 'online' | 'offline' | 'replaced' | 'seat-taken' | 'outdated'
 *   });
 *   c.steer(value);   // driver only, -1..1, throttled to 30 Hz
 */
var MgpClient = (function () {
  var PROTOCOL_VERSION = 1; // must equal PROTOCOL_VERSION in shared/protocol/constants.ts
  var CLOSE_REPLACED = 4001; // same identity opened elsewhere: do not fight for it
  var STEER_MIN_INTERVAL_MS = 33; // <= 30 Hz

  function serverBase() {
    var param = new URLSearchParams(location.search).get('server');
    return (param || location.origin).replace(/\/+$/, '');
  }

  function wsUrl() {
    return serverBase().replace(/^http/, 'ws') + '/ws'; // http->ws, https->wss
  }

  /** Path on the server, keeping a ?server= override if there is one. */
  function link(path) {
    var param = new URLSearchParams(location.search).get('server');
    if (!param) return path;
    return path + (path.indexOf('?') === -1 ? '?' : '&') + 'server=' + encodeURIComponent(param);
  }

  // Everything the server sends is also re-published as DOM events, so add-on scripts (like the race
  // screen's spectacle layer) can react without opening a second connection:
  //   window 'mgp:state' (detail = RaceState)   window 'mgp:event' (detail = BOOST / MEME_EVENT / ...)
  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) { /* old browser */ }
  }

  // Race screen only (?live=1): load the visual layer (game/race/spectacle.js). It lives under /game so the
  // V5 racer page itself does not need to change.
  if (/[?&]live=1(&|$)/.test(location.search)) {
    var fx = document.createElement('script');
    fx.src = '/game/race/spectacle.js';
    (document.head || document.documentElement).appendChild(fx);
  }

  function connect(opts) {
    var tokenKey = 'mgp.' + opts.role + '.token';
    var ws = null;
    var attempt = 0;
    var stopped = false;
    var timer = null;
    var lastSteer = 0;
    var pendingSteer = null;
    var steerTimer = null;
    var api = {};

    function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
    function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function status(s, detail) { if (opts.onStatus) opts.onStatus(s, detail); }

    function open() {
      if (stopped) return;
      status('connecting');
      var socket = new WebSocket(wsUrl());
      ws = socket;

      socket.onopen = function () {
        var hello = { type: 'HELLO', protocolVersion: PROTOCOL_VERSION, role: opts.role };
        var token = load(tokenKey);
        if (token) hello.token = token;
        if (opts.team) hello.team = opts.team;
        if (opts.adminKey) hello.adminKey = opts.adminKey;
        socket.send(JSON.stringify(hello));
      };

      socket.onmessage = function (e) {
        var m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        switch (m.type) {
          case 'WELCOME':
            attempt = 0;
            store(tokenKey, m.token);
            api.welcome = m;
            status('online', m);
            if (opts.onWelcome) opts.onWelcome(m);
            break;
          case 'RACE_STATE':
            if (opts.onState) opts.onState(m.state);
            emit('mgp:state', m.state);
            break;
          case 'BOOST': case 'TEAM_ACTIVITY': case 'MEME_EVENT': case 'DRIVER_STEER':
            if (opts.onEvent) opts.onEvent(m);
            emit('mgp:event', m);
            break;
          case 'ERROR':
            if (m.code === 'PROTOCOL_MISMATCH') { stopped = true; status('outdated', m); }
            else if (m.code === 'SEAT_TAKEN') { stopped = true; status('seat-taken', m); }
            else if (opts.onError) opts.onError(m);
            break;
          default: break; // PONG etc.
        }
      };

      socket.onclose = function (e) {
        if (socket !== ws) return;
        ws = null;
        if (stopped) return;
        if (e.code === CLOSE_REPLACED) { stopped = true; status('replaced'); return; }
        status('offline');
        // phones sleep and servers restart: keep trying, with a growing but bounded delay
        timer = setTimeout(open, Math.min(5000, 400 * Math.pow(2, attempt++)) + Math.random() * 250);
      };
      socket.onerror = function () { /* onclose follows */ };
    }

    function send(obj) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    }

    // Driver steering: always sends the LATEST value, at most every 33 ms.
    api.steer = function (value) {
      var v = Math.max(-1, Math.min(1, +value || 0));
      var now = Date.now();
      if (now - lastSteer >= STEER_MIN_INTERVAL_MS) {
        lastSteer = now;
        pendingSteer = null;
        send({ type: 'DRIVER_STEER', value: v });
        return;
      }
      pendingSteer = v;
      if (!steerTimer) {
        steerTimer = setTimeout(function () {
          steerTimer = null;
          if (pendingSteer !== null) { lastSteer = Date.now(); send({ type: 'DRIVER_STEER', value: pendingSteer }); pendingSteer = null; }
        }, STEER_MIN_INTERVAL_MS);
      }
    };
    api.send = send;
    api.close = function () { stopped = true; clearTimeout(timer); if (ws) ws.close(); };
    api.retryNow = function () { if (!ws && !stopped) { clearTimeout(timer); open(); } };

    // a phone that slept comes back: reconnect immediately instead of waiting for the backoff
    document.addEventListener('visibilitychange', function () { if (!document.hidden) api.retryNow(); });

    open();
    return api;
  }

  return { connect: connect, serverBase: serverBase, wsUrl: wsUrl, link: link, PROTOCOL_VERSION: PROTOCOL_VERSION };
})();
