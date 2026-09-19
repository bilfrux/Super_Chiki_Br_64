// Lobby / operator page.
//  * shows the QR code phones scan (it points at this machine's LAN address)
//  * shows live team status (connects as a read-only "screen")
//  * with the ADMIN_KEY, reconnects as "admin" so START / RESET work
"use strict";

(function () {
  // Must equal PROTOCOL_VERSION in shared/protocol/constants.ts (a server test checks this).
  var PROTOCOL_VERSION = 1;
  var COLORS = { red: "#e5262a", blue: "#1f6fe5", green: "#1a9e46", yellow: "#f5c400" };
  var KEY = "mgp.lobby.adminKey"; // sessionStorage: forgotten when the tab closes

  var $ = function (id) { return document.getElementById(id); };
  var ws = null;
  var isAdmin = false;
  var attempt = 0;

  function getKey() { try { return sessionStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  function setKey(v) { try { sessionStorage.setItem(KEY, v); } catch (e) { /* ignore */ } }

  // ---- QR / join address -----------------------------------------------------

  function showQr(address) {
    $("qr").src = "/qr.svg" + (address ? "?host=" + encodeURIComponent(address) : "") + (address ? "&" : "?") + "t=" + Date.now();
  }

  fetch("/api/join")
    .then(function (r) { return r.json(); })
    .then(function (info) {
      $("join-url").textContent = info.joinUrl;
      showQr(info.candidates[0].address);
      if (info.source === "LOCALHOST") {
        $("join-warn").hidden = false;
        $("join-warn").textContent = "No network address found: phones cannot reach localhost. Connect to Wi-Fi or set PUBLIC_URL.";
      }
      if (info.candidates.length > 1) {
        var box = $("addresses");
        box.hidden = false;
        box.textContent = "Wrong address? Pick the Wi-Fi one: ";
        info.candidates.forEach(function (c) {
          var b = document.createElement("button");
          b.type = "button";
          b.textContent = c.address + " (" + c.name + ")";
          b.onclick = function () { $("join-url").textContent = c.url; showQr(c.address); };
          box.appendChild(b);
        });
      }
    })
    .catch(function () { $("join-url").textContent = "Could not load join info"; });

  // ---- live status -----------------------------------------------------------

  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    var socket = new WebSocket(proto + "//" + location.host + "/ws");
    ws = socket;
    var key = getKey();
    socket.onopen = function () {
      var hello = { type: "HELLO", protocolVersion: PROTOCOL_VERSION, role: key ? "admin" : "screen" };
      if (key) hello.adminKey = key;
      socket.send(JSON.stringify(hello));
    };
    socket.onmessage = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.type === "WELCOME") {
        attempt = 0;
        isAdmin = msg.role === "admin";
        $("controls").hidden = !isAdmin;
        if (isAdmin) $("admin-msg").textContent = "Operator unlocked.";
      } else if (msg.type === "RACE_STATE") {
        render(msg.state);
      } else if (msg.type === "ERROR") {
        onError(msg);
      }
    };
    socket.onclose = function () {
      if (socket !== ws) return;
      $("race-status").textContent = "RECONNECTING…";
      setTimeout(connect, Math.min(5000, 400 * Math.pow(2, attempt++)));
    };
  }

  function onError(msg) {
    if (msg.code === "NOT_AUTHORIZED" && getKey()) {
      // wrong key (or admin disabled): forget it and go back to read-only
      setKey("");
      $("admin-msg").textContent = msg.message;
    } else if (msg.code === "INVALID_STATE") {
      $("admin-msg").textContent = msg.message;
    }
  }

  // ---- metrics (GET /api/metrics): application and blockchain kept apart ------

  var boostsByTeam = {};
  function setText(id, v) { $(id).textContent = String(v); }
  function renderMetrics(m) {
    var a = m.application, c = m.blockchain;
    setText("m-players", a.connectedPlayers);
    setText("m-drivers", a.connectedDrivers);
    setText("m-boosters", a.connectedBoosters);
    setText("m-bps", Math.round(a.boostsPerSecond));
    setText("m-aps", Math.round(a.actionsPerSecond));
    setText("m-total", a.boostsTotal);
    for (var id in a.teams) boostsByTeam[id] = a.teams[id].boostsTotal;
    setText("c-mode", c.chainState);
    var off = c.chainState === "OFF" || c.chainState === "UNAVAILABLE", demo = c.chainState === "DEMO";
    var down = c.chainState === "UNAVAILABLE";
    // Counters are shown only when they are real (LIVE) or clearly simulated (DEMO).
    setText("c-sent", off ? "–" : c.transactionsSent + (demo ? " (simulated)" : ""));
    setText("c-conf", off ? "–" : c.transactionsConfirmed + (demo ? " (simulated)" : ""));
    setText("c-pend", off ? "–" : c.pendingTransactions);
    setText("c-wait", off && !down ? "–" : c.unsentBoosts);
    setText("c-rpc", down ? "UNAVAILABLE" : off ? "–" : c.rpcHealthy ? "OK" : "DELAYED");
    setText("c-note", down ? "Monad RPC unreachable. The race is unaffected; boosts are queued and sent when it recovers. Blockchain numbers are hidden until then." : c.chainState === "OFF" ? "No chain configured (or misconfigured): nothing is being sent to Monad." : demo ? "DEMO mode: simulated activity, not real Monad data." : !c.rpcHealthy ? "RPC slow or failing. The race is unaffected; boosts are queued and retried." : "");
  }
  function pollMetrics() {
    fetch("/api/metrics").then(function (r) { return r.json(); }).then(renderMetrics).catch(function () { /* next poll */ });
  }
  pollMetrics();
  setInterval(pollMetrics, 1000);

  function render(s) {
    $("race-status").textContent = s.status + (s.status === "COUNTDOWN" ? "  " + Math.max(1, Math.ceil(-s.elapsed)) : "") + (s.winner ? " — WINNER: " + s.winner.toUpperCase() : "");
    var rows = "";
    s.teams.forEach(function (t) {
      rows += "<tr><td class='team'><span class='dot' style='background:" + COLORS[t.id] + "'></span>" + t.id.toUpperCase() + "</td>" +
        "<td>" + (t.driverConnected ? "●" : "○") + "</td><td>" + t.boosters + "</td><td>" + Math.round(t.boostRate) + "</td><td>" + (boostsByTeam[t.id] || 0) + "</td>" +
        "<td><div class='bar'><i style='width:" + Math.round(t.position * 100) + "%;background:" + COLORS[t.id] + "'></i></div></td></tr>";
    });
    document.querySelector("#teams tbody").innerHTML = rows;
  }

  // ---- operator --------------------------------------------------------------

  $("admin-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var v = $("admin-key").value.trim();
    if (!v) return;
    setKey(v);
    $("admin-key").value = "";
    $("admin-msg").textContent = "Checking key…";
    if (ws) { ws.onclose = null; ws.close(); }
    connect();
  });

  function control(action) {
    if (ws && ws.readyState === 1 && isAdmin) ws.send(JSON.stringify({ type: "CONTROL", action: action }));
  }
  $("start").onclick = function () { $("admin-msg").textContent = ""; control("START"); };
  $("reset").onclick = function () { $("admin-msg").textContent = ""; control("RESET"); };

  connect();
})();
