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
// who has joined each team so far (mock-only bookkeeping, separate from the
// live boost press tally above): first joiner becomes the driver, the rest
// are boosters. Reset only when the serverless instance cold-starts.
global.__mgpTeamMembers = global.__mgpTeamMembers || TEAM_IDS.reduce(function (acc, id) {
  acc[id] = { driverConnected: false, boostersJoined: 0 };
  return acc;
}, {});

function teamState() {
  return TEAM_IDS.map(function (id) {
    var members = global.__mgpTeamMembers[id];
    return {
      id: id,
      boostEnergy: 0,
      boostRate: 0,
      position: 0,
      speed: 0,
      driverConnected: members.driverConnected,
      boostersJoined: members.boostersJoined,
      boosters: global.__mgpBoosters[id]
    };
  });
}

// Assigns a role for a new person joining this team: the first joiner becomes
// the driver, everyone after that is a booster. Not a queue/leave-tracking
// system - good enough for a live demo, not a real seat manager.
function joinTeam(teamId) {
  var members = global.__mgpTeamMembers[teamId];
  if (!members) return null;
  if (!members.driverConnected) {
    members.driverConnected = true;
    return 'driver';
  }
  members.boostersJoined += 1;
  return 'booster';
}

module.exports = {
  TEAM_IDS: TEAM_IDS,
  boosters: global.__mgpBoosters,
  teamMembers: global.__mgpTeamMembers,
  teamState: teamState,
  joinTeam: joinTeam
};
