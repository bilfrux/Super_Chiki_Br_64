/**
 * RacerWebSocket - listens for this team's DRIVER_STEER events from the
 * server and feeds them into v5.teams.html's existing SteeringInput
 * abstraction. Connects as role "screen" (read-only, per PROTOCOL.md §3).
 *
 * This is the ONLY integration point with the engine: it calls
 * SteeringInput.set(value), nothing else. It never touches update(),
 * render(), or common.js. If no server is reachable, or no driver connects
 * for this team, it simply never calls onSteer - keyboard keeps working
 * exactly as before.
 *
 * Requires shared/network/ws-url.js loaded first.
 */
var RacerWebSocket = (function () {

  var STEER_SILENCE_TIMEOUT_MS = 500; // PROTOCOL.md: treat as neutral if nothing arrives for ~500ms

  function create(getPlayerTeamId, onSteer) {
    var ws = null;
    var attempt = 0;
    var lastSteerAt = null; // null until the first DRIVER_STEER for our team ever arrives

    function open() {
      var url = MgpNetwork.resolveWsUrl();

      try {
        ws = new WebSocket(url);
      } catch (e) {
        scheduleReconnect();
        return;
      }

      ws.onopen = function () {
        attempt = 0;
        ws.send(JSON.stringify({ type: 'HELLO', protocolVersion: 1, role: 'screen' }));
      };

      ws.onmessage = function (event) {
        var msg;
        try { msg = JSON.parse(event.data); } catch (e) { return; }

        if (msg.type !== 'DRIVER_STEER') return;

        var teamId = getPlayerTeamId();
        if (!teamId || msg.team !== teamId) return;

        lastSteerAt = Date.now();
        onSteer(msg.value);
      };

      ws.onclose = function (event) {
        if (event.code === 4001) return; // same identity opened elsewhere
        scheduleReconnect();
      };
    }

    function scheduleReconnect() {
      var delay = Math.min(5000, 400 * Math.pow(2, attempt++));
      setTimeout(open, delay);
    }

    // safety watchdog: if our driver goes silent (disconnect, phone sleep, network drop),
    // recenter the steering rather than leaving it stuck at its last value
    setInterval(function () {
      if (lastSteerAt !== null && (Date.now() - lastSteerAt) > STEER_SILENCE_TIMEOUT_MS) {
        lastSteerAt = null;
        onSteer(0);
      }
    }, 100);

    open();
  }

  return { create: create };

})();
