/**
 * MONAD GRAND PRIX - canonical team list.
 *
 * This is the ONE place TeamId/name/color are defined. Anything that needs to
 * know about the 4 teams - the racer (/test), the Booster/join UI, BOOST
 * events, RACE_STATE, the WebSocket server, Monad-related code later - should
 * read from here rather than hardcoding its own copy of the list.
 *
 * TeamId (per SPEC.md section 5): "red" | "blue" | "green" | "yellow".
 * Colors are chosen to be clearly distinguishable at a glance (also used as
 * team car tints in the racer).
 */
(function (global) {

  var TEAMS = [
    { id: 'red',    name: 'RED',    color: '#E53935' },
    { id: 'blue',   name: 'BLUE',   color: '#1E88E5' },
    { id: 'green',  name: 'GREEN',  color: '#43A047' },
    { id: 'yellow', name: 'YELLOW', color: '#FDD835' }
  ];

  function byId(teamId) {
    for (var i = 0 ; i < TEAMS.length ; i++) {
      if (TEAMS[i].id === teamId) return TEAMS[i];
    }
    return null;
  }

  var Teams = {
    ALL: TEAMS,                                  // [{id, name, color}, ...] in canonical order
    IDS: TEAMS.map(function (t) { return t.id; }), // ["red","blue","green","yellow"]
    byId: byId
  };

  // usable both as a plain <script> global (browser pages) and via require() (server-side tooling, if ever needed)
  global.Teams = Teams;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Teams;
  }

})(typeof window !== 'undefined' ? window : this);
