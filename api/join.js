/**
 * TEMPORARY mock JOIN endpoint for the Vercel test deployment.
 * First person to join a team becomes its driver; everyone after is a booster.
 */
var shared = require('./_shared');

module.exports = function (req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  var body = '';
  req.on('data', function (chunk) { body += chunk; });
  req.on('end', function () {
    var payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch (e) {
      res.status(400).json({ ok: false, error: 'invalid json' });
      return;
    }

    var teamId = payload.teamId;
    if (shared.TEAM_IDS.indexOf(teamId) === -1) {
      res.status(400).json({ ok: false, error: 'unknown team' });
      return;
    }

    var role = shared.joinTeam(teamId);
    res.status(200).json({ ok: true, teamId: teamId, role: role, teams: shared.teamState() });
  });
};
