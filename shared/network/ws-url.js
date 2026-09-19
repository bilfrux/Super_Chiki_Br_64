/**
 * MONAD GRAND PRIX - resolves the WebSocket server URL for this deployment.
 * Used by driver/network/driver-websocket.js and test/racer-websocket.js.
 *
 * Priority:
 *   1. ?ws=<url>        - quick manual override (e.g. testing from a phone)
 *   2. window.MGP_WS_URL - set below for a specific deployment
 *   3. same-host default (ws/wss matched to the page, port 8080) - only
 *      correct when the WebSocket server happens to run on the same host as
 *      the page, which is true for local dev (`cd server && npm start`).
 *
 * IMPORTANT (Vercel): this page is served as static files + short-lived
 * serverless functions. It does NOT run the persistent WebSocket server in
 * /server (see server/README.md - a long-running Node process with
 * in-memory state and a ~30Hz tick loop; Vercel Functions cannot host that).
 * On a Vercel deployment there is currently no reachable default for step 3.
 * Once /server is hosted somewhere that supports a persistent process
 * (Railway, Fly.io, Render, a VPS, ...), set window.MGP_WS_URL below to its
 * wss:// URL. Until then, DRIVER_STEER simply never arrives and the
 * driver/racer pages fall back to their local behavior (keyboard / the
 * driver's own on-page indicator) - they do not crash or block on it.
 */
(function (global) {

  function resolveWsUrl() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('ws')) return params.get('ws');

    if (global.MGP_WS_URL) return global.MGP_WS_URL;

    var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + window.location.hostname + ':8080/ws';
  }

  global.MgpNetwork = { resolveWsUrl: resolveWsUrl };

  // Set this for a deployment where /server runs somewhere other than the
  // same host as this page (e.g. on Vercel, once /server is hosted elsewhere):
  // global.MGP_WS_URL = "wss://your-server-host.example.com/ws";

})(window);
