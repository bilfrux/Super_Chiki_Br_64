// Booster page: joins as a "booster" over the WebSocket protocol v1
// (shared/protocol/PROTOCOL.md), shows the assigned team, and sends one
// { type: "BOOST" } per tap. It never decides anything: the server owns the
// team, the race state and every counter.
"use strict";

(function () {
  // Must equal PROTOCOL_VERSION in shared/protocol/constants.ts (a server test checks this).
  var PROTOCOL_VERSION = 1;

  var TEAMS = {
    red: "RED",
    blue: "BLUE",
    green: "GREEN",
    yellow: "YELLOW",
  };
  // BOOST is only accepted while racing (PROTOCOL.md §5.2). Tapping earlier does nothing.
  var BOOSTING = { RACING: true, FINAL_LAP: true, CHAOS: true };
  var CLOSE_REPLACED = 4001; // the same identity connected from another tab/device
  var MIN_TAP_INTERVAL_MS = 70; // ~14 taps/s: stays under the server limit (15/s)
  var SILENCE_MS = 4000; // the server sends RACE_STATE ~20x/s; silence means a dead link

  var KEY_TOKEN = "mgp.booster.token";
  var KEY_TEAM = "mgp.booster.team";

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    team: $("team-name"), status: $("status"), boost: $("boost"), label: $("boost-label"),
    you: $("stat-you"), rate: $("stat-rate"), teamSeen: $("stat-team"), banner: $("banner"),
    overlay: $("overlay"), oTitle: $("overlay-title"), oText: $("overlay-text"), oBtn: $("overlay-btn"),
  };

  // localStorage can throw (private mode, blocked site data): fall back to memory.
  var memory = {};
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return memory[k] || null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { memory[k] = v; } },
  };

  var params = new URLSearchParams(location.search);
  var urlTeam = TEAMS[params.get("team")] ? params.get("team") : null;
  // An explicit ?team= that differs from the saved team means "switch": drop the old identity.
  if (urlTeam && store.get(KEY_TEAM) && urlTeam !== store.get(KEY_TEAM)) {
    store.set(KEY_TOKEN, "");
    store.set(KEY_TEAM, urlTeam);
  }

  var ws = null;
  var connected = false; // WELCOME received on the current socket
  var fatal = false; // do not reconnect (protocol mismatch)
  var replaced = false; // taken over by another tab: wait for the user
  var attempt = 0;
  var reconnectTimer = null;
  var lastMessageAt = 0;
  var lastTapAt = 0;
  var myTeam = null;
  var phase = "LOBBY";
  var youBoosts = 0;
  var teamSeen = 0; // estimate, see integrate()
  var lastStateAt = 0;
  var bannerTimer = null;

  // ---- connection ------------------------------------------------------------

  function connect() {
    clearTimeout(reconnectTimer);
    if (ws && ws.readyState <= 1) return;
    setConn("connecting");
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    var socket = new WebSocket(proto + "//" + location.host + "/ws");
    ws = socket;

    socket.onopen = function () {
      lastMessageAt = Date.now();
      // The token resumes the same identity and team. If the server has forgotten it
      // (restart), the saved team is sent as a preference so we stay on the same team.
      send({
        type: "HELLO",
        protocolVersion: PROTOCOL_VERSION,
        role: "booster",
        token: store.get(KEY_TOKEN) || undefined,
        team: store.get(KEY_TEAM) || urlTeam || undefined,
      });
    };
    socket.onmessage = function (e) {
      lastMessageAt = Date.now();
      var msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      onMessage(msg);
    };
    socket.onclose = function (e) {
      if (socket !== ws) return; // an old socket we already abandoned
      handleClosed(e.code);
    };
    socket.onerror = function () { /* onclose follows */ };
  }

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function handleClosed(code) {
    connected = false;
    ws = null;
    render();
    if (fatal) return;
    if (code === CLOSE_REPLACED) {
      replaced = true;
      showOverlay("OPENED ELSEWHERE", "This booster is now active in another tab or device.", "PLAY HERE", function () {
        replaced = false;
        attempt = 0;
        connect();
      });
      return;
    }
    scheduleReconnect();
  }

  function scheduleReconnect() {
    if (fatal || replaced) return;
    var delay = Math.min(5000, 400 * Math.pow(2, attempt++)) + Math.random() * 250;
    setConn("reconnecting");
    showOverlay("RECONNECTING…", "Your team is saved. Hang on!", null);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, delay);
  }

  // A silent socket (phone changed network, NAT dropped it) never fires onclose quickly:
  // abandon it ourselves and reconnect.
  setInterval(function () {
    if (ws && ws.readyState === 1 && Date.now() - lastMessageAt > SILENCE_MS) {
      var dead = ws;
      ws = null;
      dead.onclose = null;
      try { dead.close(); } catch (e) { /* ignore */ }
      handleClosed(0);
    }
  }, 1000);

  // Phones freeze background tabs; reconnect right away when the tab comes back.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !fatal && !replaced && (!ws || ws.readyState > 1)) {
      attempt = 0;
      connect();
    }
  });

  // ---- messages --------------------------------------------------------------

  function onMessage(msg) {
    switch (msg.type) {
      case "WELCOME":
        connected = true;
        attempt = 0;
        myTeam = msg.team || null;
        store.set(KEY_TOKEN, msg.token);
        if (myTeam) store.set(KEY_TEAM, myTeam);
        youBoosts = msg.boostsSent || 0;
        document.body.setAttribute("data-team", myTeam || "");
        hideOverlay();
        setConn("online");
        render();
        break;
      case "RACE_STATE":
        onState(msg.state);
        break;
      case "MEME_EVENT":
        if (msg.team === myTeam) showBanner(msg.event.name + "!");
        break;
      case "ERROR":
        onError(msg);
        break;
      default:
        break; // TEAM_ACTIVITY etc: everything shown comes from RACE_STATE
    }
  }

  function onError(msg) {
    if (msg.code === "PROTOCOL_MISMATCH") {
      fatal = true;
      showOverlay("UPDATE NEEDED", "This page is out of date. Reload it.", "RELOAD", function () { location.reload(); });
    } else if (msg.code === "RATE_LIMITED") {
      showBanner("SLOW DOWN!");
    } else if (msg.code !== "INVALID_STATE") {
      el.status.textContent = msg.message || msg.code;
    }
  }

  function onState(state) {
    var now = Date.now();
    var mine = null;
    for (var i = 0; i < state.teams.length; i++) if (state.teams[i].id === myTeam) mine = state.teams[i];

    // A new race starts from LOBBY/COUNTDOWN: reset the per-race estimate.
    if (state.status === "LOBBY" || state.status === "COUNTDOWN") teamSeen = 0;
    phase = state.status;
    document.body.setAttribute("data-phase", phase);

    if (mine) {
      // The protocol has no per-team boost total, so this integrates the server's team
      // boosts/second (a 1 s window) over time: an estimate of boosts seen since this page
      // loaded, labelled as such.
      if (lastStateAt && BOOSTING[state.status]) teamSeen += mine.boostRate * Math.min(0.25, (now - lastStateAt) / 1000);
      el.rate.textContent = String(Math.round(mine.boostRate));
    }
    lastStateAt = now;
    el.teamSeen.textContent = "~" + Math.round(teamSeen).toLocaleString();
    el.status.textContent = statusText(state);
    if (state.status === "FINISHED") el.label.textContent = state.winner === myTeam ? "YOU WON!" : "FINISHED";
    render();
  }

  function statusText(s) {
    switch (s.status) {
      case "LOBBY": return "Waiting for the race to start…";
      case "COUNTDOWN": return "GET READY  " + Math.max(1, Math.ceil(-s.elapsed));
      case "RACING": return "GO GO GO! Tap BOOST!";
      case "FINAL_LAP": return "FINAL LAP! EVERYONE BOOST!";
      case "CHAOS": return "CHAOS MODE!!!";
      case "FINISHED": return s.winner ? "WINNER: " + TEAMS[s.winner] : "Race finished";
      default: return "";
    }
  }

  // ---- boosting --------------------------------------------------------------

  function canBoost() {
    return connected && ws && ws.readyState === 1 && BOOSTING[phase] === true;
  }

  function tap(e) {
    e.preventDefault();
    if (!canBoost()) return;
    var now = performance.now();
    if (now - lastTapAt < MIN_TAP_INTERVAL_MS) return;
    lastTapAt = now;
    send({ type: "BOOST" });
    youBoosts += 1;
    el.you.textContent = youBoosts.toLocaleString();
    el.boost.classList.add("pressed");
    setTimeout(function () { el.boost.classList.remove("pressed"); }, 60);
    if (navigator.vibrate) navigator.vibrate(8);
  }

  // pointerdown (not click): fires immediately, no 300 ms tap delay, works for many quick taps.
  el.boost.addEventListener("pointerdown", tap);
  el.boost.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  // ---- view ------------------------------------------------------------------

  function setConn(state) {
    document.body.setAttribute("data-conn", state);
  }

  function render() {
    el.team.textContent = myTeam ? TEAMS[myTeam] : connected ? "…" : "CONNECTING…";
    el.you.textContent = youBoosts.toLocaleString();
    var active = canBoost();
    el.boost.disabled = !active;
    if (phase !== "FINISHED") {
      el.label.textContent = active ? "BOOST" : phase === "COUNTDOWN" ? "READY…" : "WAIT…";
    }
  }

  function showOverlay(title, text, btnLabel, onClick) {
    el.oTitle.textContent = title;
    el.oText.textContent = text;
    if (btnLabel) {
      el.oBtn.textContent = btnLabel;
      el.oBtn.hidden = false;
      el.oBtn.onclick = onClick;
    } else {
      el.oBtn.hidden = true;
    }
    el.overlay.hidden = false;
  }

  function hideOverlay() {
    el.overlay.hidden = true;
  }

  function showBanner(text) {
    el.banner.textContent = text;
    el.banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { el.banner.hidden = true; }, 2500);
  }

  render();
  connect();
})();
