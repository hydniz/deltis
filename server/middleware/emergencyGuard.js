// Emergency-mode guard.
//
// After a failed update/migration the app keeps running in a reduced mode:
// only login, version info, branding and the update/rollback endpoints stay
// reachable, so the admin can trigger the one-click rollback from the UI.

const serverState = require('../utils/serverState');

const ALLOWED = [
  /^\/api\/?$/,                        // version endpoint
  /^\/api\/branding/,
  /^\/api\/auth($|\/)/,                // admin must be able to log in
  /^\/api\/admin\/update($|\/)/,       // status / stream / rollback
];

module.exports = function emergencyGuard(req, res, next) {
  if (!serverState.emergencyMode) return next();
  if (!req.path.startsWith('/api/')) return next(); // serve React frontend

  if (ALLOWED.some(re => re.test(req.path))) return next();

  return res.status(503).json({
    error: 'Server im Notfallbetrieb nach fehlgeschlagenem Update. Bitte Rollback durchführen.',
    emergencyMode: true,
  });
};
