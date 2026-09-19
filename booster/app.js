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
    bar: $("progress-bar"), flash: $("flash"), ripples: $("ripples"), overlay: $("overlay"), oTitle: $("overlay-title"), oText: $("overlay-text"), oBtn: $("overlay-btn"),
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
  var bannerTimer = null;
  var tapCount = 0; // alternates the animation classes (see tapFeedback)
  var flashCount = 0;
  var rippleIndex = 0;
  var CHAOS_ID = "CHAOS_MODE"; // shared/protocol/memes.ts CHAOS_MEME_ID

  // DOM writes only when the value changed: RACE_STATE arrives ~20x/s, and a phone should not
  // re-style the page 20 times a second for nothing.
  var shown = {};
  function setText(node, key, value) {
    if (shown[key] === value) return;
    shown[key] = value;
    node.textContent = value;
  }
  function setAttr(name, value) {
    if (shown["attr:" + name] === value) return;
    shown["attr:" + name] = value;
    document.body.setAttribute(name, value);
  }

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
        onMeme(msg);
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
    var mine = null;
    var chaosTeam = null; // the team currently in CHAOS_MODE (status CHAOS is race-wide)
    for (var i = 0; i < state.teams.length; i++) {
      var t = state.teams[i];
      if (t.id === myTeam) mine = t;
      if (t.activeEvent && t.activeEvent.event.id === CHAOS_ID) chaosTeam = t.id;
    }
    phase = state.status;
    setAttr("data-phase", phase);

    // Everything below comes straight from the latest RACE_STATE: nothing is estimated.
    if (mine) {
      setText(el.rate, "rate", String(Math.round(mine.boostRate)));
      setText(el.teamSeen, "boosters", String(mine.boosters));
      el.bar.style.width = Math.round(mine.position * 100) + "%";
    }

    // Crypto-rave reactions. "own": my team is in CHAOS_MODE. "other": someone else is.
    var raving = state.status === "CHAOS" || chaosTeam !== null;
    setAttr("data-chaos", !raving ? "" : chaosTeam === myTeam ? "own" : "other");
    var meme = mine && mine.activeEvent ? mine.activeEvent.event.visual : "";
    setAttr("data-meme", meme || "");

    setText(el.status, "status", statusText(state, chaosTeam));
    if (state.status === "FINISHED") setText(el.label, "label", state.winner === myTeam ? "YOU WON!" : "FINISHED");
    render();
  }

  function statusText(s, chaosTeam) {
    switch (s.status) {
      case "LOBBY": return "Waiting for the race to start…";
      case "COUNTDOWN": return "GET READY  " + Math.max(1, Math.ceil(-s.elapsed));
      case "RACING": return "GO GO GO! Tap BOOST!";
      case "FINAL_LAP": return "FINAL LAP! EVERYONE BOOST!";
      case "CHAOS": return chaosTeam === myTeam ? "CHAOS MODE!!! YOUR CAR IS GOING WILD" : "CHAOS!!! " + (TEAMS[chaosTeam] || "") + " IS GOING WILD";
      case "FINISHED": return s.winner ? "WINNER: " + TEAMS[s.winner] : "Race finished";
      default: return "";
    }
  }

  // ---- memes -----------------------------------------------------------------

  function onMeme(msg) {
    var own = msg.team === myTeam;
    var chaos = msg.event.id === CHAOS_ID;
    if (own) {
      showBanner(msg.event.name + "!");
      flash();
      if (navigator.vibrate) navigator.vibrate(chaos ? [60, 40, 60, 40, 120] : [40, 30, 40]);
    } else if (chaos) {
      showBanner("CHAOS: " + (TEAMS[msg.team] || "") + "!");
    }
  }

  // One-shot white flash; two classes alternate so a new flash restarts the animation.
  function flash() {
    flashCount += 1;
    el.flash.classList.remove(flashCount % 2 ? "go-b" : "go-a");
    el.flash.classList.add(flashCount % 2 ? "go-a" : "go-b");
  }

  // ---- boosting --------------------------------------------------------------

  function canBoost() {
    return connected && ws && ws.readyState === 1 && BOOSTING[phase] === true;
  }

  // Visual feedback for EVERY press, however fast: no timers, no DOM creation, only a class swap
  // on the button and on one of a few reusable ripple elements.
  var RIPPLES = 5;
  for (var r = 0; r < RIPPLES; r++) {
    var d0 = document.createElement("div");
    d0.className = "ripple";
    el.ripples.appendChild(d0);
  }
  var rippleBox = { left: 0, top: 0, width: 0, height: 0 };
  function measure() {
    var r = el.ripples.getBoundingClientRect();
    rippleBox = { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  measure();
  window.addEventListener("resize", measure);
  window.addEventListener("orientationchange", measure);
  function tapFeedback(e) {
    tapCount += 1;
    var b = el.boost.classList;
    b.remove(tapCount % 2 ? "pop-b" : "pop-a");
    b.add(tapCount % 2 ? "pop-a" : "pop-b");

    var box = rippleBox; // measured on load/resize, never per tap: reading layout here forced a reflow on every press
    var node = el.ripples.children[rippleIndex++ % RIPPLES];
    var x = e.clientX, y = e.clientY;
    node.style.left = (typeof x === "number" && x ? x - box.left : box.width / 2) + "px";
    node.style.top = (typeof y === "number" && y ? y - box.top : box.height / 2) + "px";
    node.classList.remove(tapCount % 2 ? "go-b" : "go-a");
    node.classList.add(tapCount % 2 ? "go-a" : "go-b");
  }

  function tap(e) {
    e.preventDefault();
    if (!canBoost()) return;
    tapFeedback(e); // always instant, even when the tap is too fast to be sent
    var now = performance.now();
    if (now - lastTapAt < MIN_TAP_INTERVAL_MS) return;
    lastTapAt = now;
    send({ type: "BOOST" });
    youBoosts += 1;
    setText(el.you, "you", youBoosts.toLocaleString());
    if (navigator.vibrate) navigator.vibrate(10);
  }

  // pointerdown (not click): fires immediately, no 300 ms tap delay, one event per finger.
  el.boost.addEventListener("pointerdown", tap);

  // Belt and braces against the browser doing anything "helpful" with the BOOST button.
  var block = function (e) { e.preventDefault(); };
  ["contextmenu", "selectstart", "dragstart", "dblclick", "gesturestart", "gesturechange"].forEach(function (name) {
    document.addEventListener(name, block);
  });
  // iOS ignores user-scalable=no; a non-passive touchmove veto stops pinch-zoom and pull-to-refresh.
  document.addEventListener("touchmove", block, { passive: false });

  // ---- view ------------------------------------------------------------------

  function setConn(state) {
    document.body.setAttribute("data-conn", state);
  }

  function render() {
    setText(el.team, "team", myTeam ? TEAMS[myTeam] : connected ? "…" : "CONNECTING…");
    setText(el.you, "you", youBoosts.toLocaleString());
    var active = canBoost();
    if (el.boost.disabled === active) el.boost.disabled = !active;
    if (phase !== "FINISHED") {
      setText(el.label, "label", active ? "BOOST" : phase === "COUNTDOWN" ? "READY…" : "WAIT…");
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
