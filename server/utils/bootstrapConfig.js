// Bootstrap configuration – values that must be known before the MongoDB
// connection is established (e.g. MONGODB_URI itself).
//
// Stored on disk as <project-root>/deltis.config.json so the file survives
// container restarts and does not depend on a running database.
//
// Precedence (highest first):
//   1. process.env    – .env / docker-compose environment
//   2. deltis.config.json – saved by admin via the settings UI
//   3. Hard-coded default

const path = require('path');
const fs = require('fs');

const CONFIG_FILE = path.join(__dirname, '..', '..', 'deltis.config.json');

// Keys managed by this module (kept small – only pre-DB necessities).
const BOOTSTRAP_KEYS = ['MONGODB_URI'];

function _read() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function get(key) {
  const env = process.env[key];
  if (env !== undefined && env !== '') return env;
  return _read()[key] ?? null;
}

function getSource(key) {
  const env = process.env[key];
  if (env !== undefined && env !== '') return 'env';
  const data = _read();
  return data[key] !== undefined ? 'file' : 'default';
}

function set(key, value) {
  const data = _read();
  data[key] = value;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function remove(key) {
  const data = _read();
  delete data[key];
  if (Object.keys(data).length === 0) {
    try { fs.unlinkSync(CONFIG_FILE); } catch { /* already gone */ }
  } else {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
  }
}

module.exports = { BOOTSTRAP_KEYS, get, getSource, set, remove };
