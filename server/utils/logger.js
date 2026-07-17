// Detailed backend activity log.
//
// Every entry is one NDJSON line in a daily file under backups/logs/ —
// the backups directory is host-mounted in Docker deployments, so the logs
// stay readable from the host even when the app container is broken or was
// swapped ("always accessible in an emergency"). Files older than
// RETENTION_DAYS are pruned automatically on startup and on day rollover.
//
//   backups/logs/deltis-2026-07-17.log
//   {"ts":"…","level":"info","cat":"http","msg":"GET /api/planner 200","meta":{…}}
//
// Sensitive material never reaches the log: sanitize() redacts secrets by
// key name (passwords, peppers, tokens, UUIDs, cookies …) recursively.

const fs = require('fs');
const path = require('path');
const os = require('os');

const RETENTION_DAYS = 7;
const FILE_PREFIX = 'deltis-';

// Resolved per write so tests can point LOG_DIR at a temp location. Under
// Jest the default also moves to tmp — unit tests must never write into the
// real backups/ directory.
function logDir() {
  if (process.env.LOG_DIR) return process.env.LOG_DIR;
  if (process.env.JEST_WORKER_ID) return path.join(os.tmpdir(), 'deltis-test-logs');
  return path.join(__dirname, '../../backups/logs');
}

// Key names whose values must never be logged (case-insensitive substring).
const REDACT_KEYS = [
  'password', 'pepper', 'secret', 'token', 'authorization', 'cookie',
  'uuid', 'hash', 'jwt', 'apikey', 'api_key', 'credential',
];

const MAX_META_LENGTH = 4000; // per-entry cap keeps single lines greppable

function shouldRedact(key) {
  const k = String(key).toLowerCase();
  return REDACT_KEYS.some(r => k.includes(r));
}

// Recursively replaces sensitive values with '[redacted]'. Depth-capped so
// crafted payloads cannot blow the logger up.
function sanitize(value, depth = 0) {
  if (value == null || depth > 6) return value == null ? value : '[depth]';
  if (Array.isArray(value)) return value.slice(0, 50).map(v => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = shouldRedact(k) ? '[redacted]' : sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

function dayStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function fileFor(date = new Date()) {
  return path.join(logDir(), `${FILE_PREFIX}${dayStamp(date)}.log`);
}

// Deletes daily files older than the retention window. Ignores foreign files.
function pruneOldLogs(now = new Date()) {
  let removed = 0;
  try {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    for (const name of fs.readdirSync(logDir())) {
      const m = name.match(new RegExp(`^${FILE_PREFIX}(\\d{4}-\\d{2}-\\d{2})\\.log$`));
      if (!m) continue;
      if (m[1] < dayStamp(cutoff)) {
        fs.unlinkSync(path.join(logDir(), name));
        removed++;
      }
    }
  } catch { /* logging must never break the app */ }
  return removed;
}

let currentDay = null;

// Core writer: appends one NDJSON line to today's file. Synchronous append
// keeps ordering and is cheap at this volume; any I/O error is swallowed —
// logging must never take the app down.
function write(level, cat, msg, meta) {
  try {
    const now = new Date();
    if (currentDay !== dayStamp(now)) {
      currentDay = dayStamp(now);
      fs.mkdirSync(logDir(), { recursive: true });
      pruneOldLogs(now);
    }
    const entry = { ts: now.toISOString(), level, cat, msg };
    if (meta !== undefined) {
      let m = sanitize(meta);
      const raw = JSON.stringify(m);
      if (raw && raw.length > MAX_META_LENGTH) {
        m = { truncated: true, preview: raw.slice(0, MAX_META_LENGTH) };
      }
      entry.meta = m;
    }
    fs.appendFileSync(fileFor(now), JSON.stringify(entry) + '\n');
  } catch { /* see above */ }
}

const logger = {
  info: (cat, msg, meta) => write('info', cat, msg, meta),
  warn: (cat, msg, meta) => write('warn', cat, msg, meta),
  error: (cat, msg, meta) => write('error', cat, msg, meta),
};

module.exports = {
  ...logger,
  sanitize,
  pruneOldLogs,
  fileFor,
  logDir,
  RETENTION_DAYS,
  // test hook: reset the rollover memo so pruning runs again
  _resetRollover: () => { currentDay = null; },
};
