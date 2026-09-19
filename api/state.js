/**
 * TEMPORARY mock state endpoint for the Vercel test deployment.
 * Vercel equivalent of booster/mock/mock-server.py's GET /api/state.
 */
var shared = require('./_shared');

module.exports = function (req, res) {
  res.status(200).json({ teams: shared.teamState() });
};
