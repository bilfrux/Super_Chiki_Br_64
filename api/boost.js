/**
 * TEMPORARY mock BOOST endpoint for the Vercel test deployment.
 * Vercel equivalent of booster/mock/mock-server.py's POST /api/boost.
 * Accepts { type: "BOOST", teamId, timestamp } from booster/mock/client.js.
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
    var event;
    try {
      event = JSON.parse(body || '{}');
    } catch (e) {
      res.status(400).json({ ok: false, error: 'invalid json' });
      return;
    }

    var teamId = event.teamId || event.team; // accept both event shapes in use across the front-end
    var amount = event.amount || 1;

    if (shared.TEAM_IDS.indexOf(teamId) === -1) {
      res.status(400).json({ ok: false, error: 'unknown team' });
      return;
    }

    shared.boosters[teamId] += amount;
    res.status(200).json({ ok: true, teams: shared.teamState() });
  });
};
