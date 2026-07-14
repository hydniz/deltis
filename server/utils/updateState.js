// Persistent update state, shared between the running app, the updater helper
// container and the app that boots after the update.
//
// Lives in backups/update-state.json because ./backups is host-mounted in the
// Docker setup – it survives container replacement and is visible to all
// participants of an update.
//
// Phases:
//   idle          – no update in progress (or state cleared)
//   backing-up    – pre-update DB snapshot running
//   pulling       – new Docker image is being pulled (docker-socket mode)
//   applying      – helper container / host script is swapping the app
//   started-new   – new app process has booted, migrations pending/running
//   success       – new version booted + migrated successfully
//   failed        – something went wrong; `error` says what, `recovered`
//                   says whether the old version was restarted automatically

const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '..', '..');
const STATE_FILE = process.env.UPDATE_STATE_FILE
  || path.join(APP_DIR, 'backups', 'update-state.json');

function read() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { phase: 'idle' };
  }
}

// Shallow-merges `patch` into the current state and persists it atomically
// (write to temp file + rename) so a crash never leaves a half-written file.
function write(patch) {
  const next = { ...read(), ...patch, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, STATE_FILE);
  return next;
}

// Replaces the whole state (used when starting a fresh update run).
function reset(initial = {}) {
  const next = { phase: 'idle', ...initial, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, STATE_FILE);
  return next;
}

function clear() {
  try { fs.unlinkSync(STATE_FILE); } catch { /* already gone */ }
}

module.exports = { STATE_FILE, read, write, reset, clear };
