/**
 * MONAD GRAND PRIX - shared event protocol
 *
 * This is the exact shape defined in SPEC.md (sections 5-6): TeamId, TeamState
 * and the GameEvent union (DRIVER_STEER / BOOST / TEAM_ACTIVITY / MEME_EVENT / RACE_STATE).
 *
 * It is intentionally framework/transport agnostic: nothing here assumes
 * WebSocket, HTTP, or mock. Both the Game (Member A) and the Server (Member B)
 * should read/write events shaped exactly like this, whatever the transport.
 *
 * Do not add new event types or fields here without updating SPEC.md first.
 */
(function (global) {

  var TEAM_IDS = ['red', 'blue', 'green', 'yellow'];

  function emptyTeamState(teamId) {
    return {
      id: teamId,
      boostEnergy: 0,
      boostRate: 0,
      position: 0,
      speed: 0,
      driverConnected: false,
      boosters: 0
    };
  }

  function emptyRaceTeams() {
    return TEAM_IDS.map(emptyTeamState);
  }

  function boostEvent(teamId, amount) {
    return { type: 'BOOST', team: teamId, amount: amount || 1 };
  }

  function driverSteerEvent(teamId, value) {
    return { type: 'DRIVER_STEER', team: teamId, value: value };
  }

  function teamActivityEvent(teamId, rate) {
    return { type: 'TEAM_ACTIVITY', team: teamId, rate: rate };
  }

  var Protocol = {
    TEAM_IDS: TEAM_IDS,
    emptyTeamState: emptyTeamState,
    emptyRaceTeams: emptyRaceTeams,
    boostEvent: boostEvent,
    driverSteerEvent: driverSteerEvent,
    teamActivityEvent: teamActivityEvent
  };

  // usable both as a plain <script> global (browser pages) and via require() (mock server tooling in JS, if ever needed)
  global.Protocol = Protocol;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Protocol;
  }

})(typeof window !== 'undefined' ? window : this);
