/**
 * TEMPORARY mock state, shared by api/boost.js and api/state.js.
 *
 * Vercel serverless functions are stateless/ephemeral - this in-memory object
 * is best-effort only (fine for a quick demo/phone test with a handful of
 * people; not guaranteed to stay consistent under real concurrent load, since
 * different invocations can land on different instances). This whole file
 * goes away once Member B's real server (see /server) is wired up instead -
 * booster/mock/client.js is the only thing that talks to it.
 */

var TEAM_IDS = ['red', 'blue', 'green', 'yellow'];

global.__mgpBoosters = global.__mgpBoosters || { red: 0, blue: 0, green: 0, yellow: 0 };

function teamState() {
  return TEAM_IDS.map(function (id) {
    return {
      id: id,
      boostEnergy: 0,
      boostRate: 0,
      position: 0,
      speed: 0,
      driverConnected: false,
      boosters: global.__mgpBoosters[id]
    };
  });
}

module.exports = {
  TEAM_IDS: TEAM_IDS,
  boosters: global.__mgpBoosters,
  teamState: teamState
};
