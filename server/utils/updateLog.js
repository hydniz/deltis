// Persistent, timestamped update log.
//
// Every step of an update run is appended to backups/update-logs/<run>.log so
// failures can be reconstructed even after a container swap or crash. The
// in-memory SSE stream (routes/update.js) registers itself as a sink and
// receives every line as well.
//
// The updater helper container and the freshly booted app append to the SAME
// file (its path travels through update-state.json), producing one continuous
// log per update run.

const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '..', '..');
const LOG_DIR = process.env.UPDATE_LOG_DIR
  || path.join(APP_DIR, 'backups', 'update-logs');
const KEEP_LOGS = 10;

let currentFile = null;
const sinks = new Set();

// Registers a callback that receives every raw (un-timestamped) line.
function addSink(fn) { sinks.add(fn); return () => sinks.delete(fn); }

// Starts a new log file for an update run and returns its path.
function startRun(label = 'update') {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  currentFile = path.join(LOG_DIR, `${label}_${ts}.log`);
  fs.writeFileSync(currentFile, '');
  prune();
  return currentFile;
}

// Continues an existing run's log file (helper container / post-update boot).
function attachToFile(file) { currentFile = file; }

function currentLogFile() { return currentFile; }

// Logs one line: timestamped into the file, raw to all sinks and to stdout.
function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  if (currentFile) {
    try { fs.appendFileSync(currentFile, stamped + '\n'); } catch { /* disk issue – still stream */ }
  }
  for (const sink of sinks) {
    try { sink(line); } catch { /* a broken sink must not stop the update */ }
  }
  console.log(`[update] ${line}`);
}

function prune() {
  try {
    const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log')).sort().reverse();
    for (const f of files.slice(KEEP_LOGS)) fs.unlinkSync(path.join(LOG_DIR, f));
  } catch { /* best effort */ }
}

// Test hook
function _reset() { currentFile = null; sinks.clear(); }

module.exports = { LOG_DIR, startRun, attachToFile, currentLogFile, log, addSink, _reset };
