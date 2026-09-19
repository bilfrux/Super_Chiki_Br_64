/**
 * MOCK_MODE adapter for the JOIN / BOOSTER flow.
 *
 * This is a TEMPORARY stand-in for Member B's real WebSocket client. The one
 * function that matters for swapping it out later is emitGameEvent(event):
 * it is the only place that knows HOW an event is delivered (today: best-effort
 * to the local dev mock server, tolerating "no server at all"). Everything
 * upstream (join/index.html, booster/index.html) only ever calls
 * MonadClient.sendBoost(teamId) / emitGameEvent(event) and never changes.
 *
 * Optionally loads /shared/protocol/events.js (defines `Protocol`) for other
 * shared shapes (e.g. RaceState team entries) - not required by this file itself.
 */
var MonadClient = (function () {

  var MOCK_MODE = true; // clearly isolated - flip this file out once the real server exists
  var SESSION_KEY = 'mgp_session_id';
  var TEAM_KEY = 'mgp_team_id';
  var ROLE_KEY = 'mgp_role';

  function getSessionId() {
    var id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('p_' + Date.now() + '_' + Math.random().toString(16).slice(2));
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  function getTeam() {
    return localStorage.getItem(TEAM_KEY);
  }

  // Asks the mock backend for a role on this team (first joiner = driver,
  // everyone after = booster), then remembers both locally. Never blocks the
  // UI on the network failing: falls back to "booster" so the join flow still
  // works with zero server (MOCK_MODE guarantee).
  function join(teamId) {
    localStorage.setItem(TEAM_KEY, teamId);
    return fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: teamId })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var role = data.role || 'booster';
        localStorage.setItem(ROLE_KEY, role);
        return { ok: true, teamId: teamId, role: role, sessionId: getSessionId() };
      })
      .catch(function () {
        localStorage.setItem(ROLE_KEY, 'booster');
        return { ok: true, teamId: teamId, role: 'booster', sessionId: getSessionId() };
      });
  }

  function getRole() {
    return localStorage.getItem(ROLE_KEY) || 'booster';
  }

  // MONAD GRAND PRIX - generic, transport-agnostic event abstraction.
  // Callers build a plain event object and hand it here; this function is the
  // ONLY place that knows how it actually gets delivered. Today (MOCK_MODE) that
  // means: log it, then best-effort notify the local dev mock server so the big
  // screen can reflect it - but it never blocks or throws if that server is not
  // running. Swapping to a real WebSocket later means changing transport() only;
  // join/index.html and booster/index.html never need to change.
  function emitGameEvent(event) {
    if (MOCK_MODE) console.log('[MOCK_MODE] emitGameEvent', event);
    return transport(event);
  }

  function transport(event) {
    if (event.type !== 'BOOST') return Promise.resolve();
    return fetch('/api/boost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    }).catch(function () { /* no server reachable - mock mode still works purely locally */ });
  }

  function sendBoost(teamId) {
    var event = { type: 'BOOST', teamId: teamId, timestamp: Date.now() };
    return emitGameEvent(event);
  }

  function fetchState() {
    return fetch('/api/state').then(function (res) { return res.json(); });
  }

  // calls callback(raceState) immediately, then every intervalMs. Returns an unsubscribe function.
  function subscribeTeamState(callback, intervalMs) {
    var stopped = false;
    function tick() {
      if (stopped) return;
      fetchState().then(callback).catch(function () { /* server not reachable yet, ignore and retry next tick */ });
    }
    tick();
    var timer = setInterval(tick, intervalMs || 1000);
    return function unsubscribe() {
      stopped = true;
      clearInterval(timer);
    };
  }

  return {
    MOCK_MODE: MOCK_MODE,
    getSessionId: getSessionId,
    getTeam: getTeam,
    getRole: getRole,
    join: join,
    emitGameEvent: emitGameEvent,
    sendBoost: sendBoost,
    fetchState: fetchState,
    subscribeTeamState: subscribeTeamState
  };

})();
