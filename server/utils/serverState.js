// Shared runtime state accessible across modules without circular imports.
// index.js sets `reconnect` after startup; admin routes call it.

const state = {
  setupMode: false,
  // Set when a migration / update left the app in a broken state: the API is
  // reduced to auth + update/rollback endpoints and the UI shows the
  // emergency banner. Shape: { code, message, backupFile } or null.
  emergencyMode: null,
  // The port the HTTP server actually bound to (may differ from PORT when the
  // desired port was already taken – see port auto-discovery in index.js).
  actualPort: null,
  // Assigned by index.js after the DB-reconnect logic is wired up.
  reconnect: null,
};

module.exports = state;
