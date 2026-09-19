/**
 * DriverWebSocket - the only thing in /driver that talks to the network.
 * Protocol: shared/protocol/PROTOCOL.md (role "driver"), mirroring the
 * drop-in WsClient in shared/protocol/GAME_INTEGRATION.md §4 (plain JS here,
 * no build step). Requires shared/network/ws-url.js loaded first.
 *
 * GyroscopeSteering (driver/gyro/gyroscope-steering.js) knows nothing about
 * this file - it only ever calls target.set(value). index.html wires
 * SteeringInput.set() to also call this module's steer(), so the gyro stays
 * fully independent of the network (see driver/index.html).
 */
var DriverWebSocket = (function () {

  var SEND_HZ = 25; // <= 30 Hz recommended by PROTOCOL.md §5.2
  var MIN_SEND_INTERVAL_MS = 1000 / SEND_HZ;
  var TOKEN_KEY = 'mgp.driver.token';

  function create(onStatus) {
    var ws = null;
    var attempt = 0;
    var lastSentAt = 0;
    var pendingValue = null;
    var pendingTimer = null;
    var team = null;

    function emitStatus(status, detail) {
      if (onStatus) onStatus(status, detail || {});
    }

    function teamPreference() {
      var params = new URLSearchParams(window.location.search);
      return params.get('team') || undefined; // e.g. /driver?team=red for testing - server may still override
    }

    function open() {
      var url = MgpNetwork.resolveWsUrl();
      emitStatus('connecting', { url: url });

      try {
        ws = new WebSocket(url);
      } catch (e) {
        scheduleReconnect();
        return;
      }

      ws.onopen = function () {
        attempt = 0;
        ws.send(JSON.stringify({
          type: 'HELLO',
          protocolVersion: 1,
          role: 'driver',
          team: teamPreference(),
          token: localStorage.getItem(TOKEN_KEY) || undefined
        }));
      };

      ws.onmessage = function (event) {
        var msg;
        try { msg = JSON.parse(event.data); } catch (e) { return; }

        if (msg.type === 'WELCOME') {
          localStorage.setItem(TOKEN_KEY, msg.token);
          team = msg.team || null;
          emitStatus('connected', { team: team });
        } else if (msg.type === 'ERROR') {
          emitStatus('error', { code: msg.code, message: msg.message });
        }
        // RACE_STATE / TEAM_ACTIVITY / MEME_EVENT: out of scope here (steering only), ignored
      };

      ws.onclose = function (event) {
        emitStatus('disconnected', {});
        if (event.code === 4001) return; // same identity opened elsewhere - do not auto-reconnect
        scheduleReconnect();
      };
    }

    function scheduleReconnect() {
      var delay = Math.min(5000, 400 * Math.pow(2, attempt++));
      setTimeout(open, delay);
    }

    // throttled to <= SEND_HZ: sends immediately if enough time has passed,
    // otherwise remembers only the latest value and sends it on the trailing edge
    function steer(value) {
      pendingValue = value;
      var now = Date.now();
      var elapsed = now - lastSentAt;

      if (elapsed >= MIN_SEND_INTERVAL_MS) {
        flush();
      } else if (!pendingTimer) {
        pendingTimer = setTimeout(flush, MIN_SEND_INTERVAL_MS - elapsed);
      }
    }

    function flush() {
      pendingTimer = null;
      lastSentAt = Date.now();
      if (ws && ws.readyState === WebSocket.OPEN && pendingValue !== null) {
        ws.send(JSON.stringify({ type: 'DRIVER_STEER', value: pendingValue }));
      }
    }

    open();

    return {
      steer: steer,
      getTeam: function () { return team; }
    };
  }

  return { create: create };

})();
