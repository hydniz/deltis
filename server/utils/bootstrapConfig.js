// Bootstrap configuration – values that must be known before the MongoDB
// connection is established, or that need to be readable on disk so they
// survive container restarts without requiring a .env file.
//
// Stored at /etc/deltis/deltis.config.json (mounted as a Docker volume).
// In development the file is read from the same path if it exists, otherwise
// the key simply falls back to the built-in default.
//
// Precedence (highest first):
//   1. process.env    – .env / docker-compose environment
//   2. /etc/deltis/deltis.config.json  – written by the setup wizard / admin UI
//   3. Hard-coded default (empty string for secrets, sensible value for URI)

const path = require('path');
const fs = require('fs');

const CONFIG_FILE = '/etc/deltis/deltis.config.json';

// Keys managed here. All others go through the DB-backed config system.
const BOOTSTRAP_KEYS = [
  'MONGODB_URI',
  'JWT_SECRET',
  'JWT_SECRET_FILE',
  'PEPPER_FILE',
  'PASSWORD_PEPPER',
];

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
  // Ensure the directory exists before writing.
  const dir = path.dirname(CONFIG_FILE);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* already exists */ }
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
