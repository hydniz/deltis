// Runtime configuration utility.
//
// Precedence (highest first):
//   1. process.env           – set via .env / docker-compose environment
//   2. DB override           – saved by admin via the settings UI (SystemConfig)
//      Bootstrap file        – deltis.config.json for keys that need pre-DB access
//   3. Default               – hard-coded default value
//
// Keys marked `bootstrap: true` bypass the MongoDB-backed cache and use the
// file-based bootstrapConfig module instead (chicken-and-egg: those keys are
// needed to establish the DB connection in the first place).

const bootstrapConfig = require('./bootstrapConfig');

const DEFINITIONS = {
  // ── OTA update ────────────────────────────────────────────────────────────
  UPDATE_REPO_URL: {
    label: 'GitHub Repository URL',
    group: 'OTA Update',
    description: 'Öffentliches GitHub-Repository, das auf neue Versionen geprüft wird.',
    type: 'url',
    editable: true,
    default: 'https://github.com/hydniz/deltis',
  },
  UPDATE_RELEASE_CHANNEL: {
    label: 'Release-Kanal',
    group: 'OTA Update',
    description: 'Welche Versionen für Updates geprüft werden.',
    type: 'select',
    options: ['stable', 'beta', 'alpha', 'main'],
    editable: true,
    default: 'stable',
  },
  WATCHTOWER_API_TOKEN: {
    label: 'Watchtower API-Token',
    group: 'OTA Update',
    description: 'Muss mit WATCHTOWER_HTTP_API_TOKEN in docker-compose.yml übereinstimmen.',
    type: 'password',
    editable: true,
    default: 'deltis-ota-token',
  },
  WATCHTOWER_HOST: {
    label: 'Watchtower Host',
    group: 'OTA Update',
    description: 'Hostname des Watchtower-Containers im Docker-Netzwerk.',
    type: 'text',
    editable: true,
    default: 'watchtower',
  },
  // ── Server ────────────────────────────────────────────────────────────────
  PORT: {
    label: 'Server-Port',
    group: 'Server',
    description: 'Port auf dem der Server läuft. Neustart erforderlich.',
    type: 'number',
    editable: true,
    default: '3001',
    restartRequired: true,
  },
  MONGODB_URI: {
    label: 'MongoDB URI',
    group: 'Server',
    description: 'Verbindungszeichenkette für MongoDB. Neustart erforderlich. Wenn in .env gesetzt, überschreibt .env diesen Wert.',
    type: 'password',
    editable: true,
    bootstrap: true, // stored in deltis.config.json, not in DB (chicken-and-egg)
    restartRequired: true,
    default: 'mongodb://localhost:27017/habit_tracker',
  },
  // ── Sicherheit ────────────────────────────────────────────────────────────
  // These are read-only in the UI – they exist purely so the admin can see
  // whether each secret is configured and where it comes from.
  JWT_SECRET: {
    label: 'JWT Secret',
    group: 'Sicherheit',
    description: 'Geheimnis für JWT-Session-Token. Nur per .env setzbar.',
    type: 'status',
    editable: false,
    default: '',
  },
  JWT_SECRET_FILE: {
    label: 'JWT Secret Datei',
    group: 'Sicherheit',
    description: 'Pfad zur Datei mit dem JWT Secret. Nur per .env setzbar.',
    type: 'status',
    editable: false,
    default: '',
  },
  PEPPER_FILE: {
    label: 'Pepper-Datei',
    group: 'Sicherheit',
    description: 'Pfad zur Pepper-Datei für Passwort-Hashing. Niemals nach erstem Login ändern! Nur per .env setzbar.',
    type: 'status',
    editable: false,
    default: '',
  },
  PASSWORD_PEPPER: {
    label: 'Pepper (direkt)',
    group: 'Sicherheit',
    description: 'Pepper-Wert direkt. Niemals nach erstem Login ändern! Nur per .env setzbar.',
    type: 'status',
    editable: false,
    default: '',
  },
};

let cache = {};

async function loadAll() {
  const SystemConfig = require('../models/SystemConfig');
  try {
    const records = await SystemConfig.find({});
    cache = {};
    for (const r of records) cache[r.key] = r.value;
  } catch {
    // DB might not be available yet; cache stays empty
  }
}

// Returns the effective value: process.env → bootstrap file or DB cache → default
function get(key) {
  const def = DEFINITIONS[key];
  const envVal = process.env[key];
  if (envVal !== undefined && envVal !== '') return envVal;

  if (def?.bootstrap) {
    return bootstrapConfig.get(key) ?? def.default ?? '';
  }
  if (cache[key] !== undefined) return cache[key];
  return def?.default ?? '';
}

// Returns where the effective value comes from: 'env' | 'db' | 'file' | 'default'
function getSource(key) {
  const def = DEFINITIONS[key];
  const envVal = process.env[key];
  if (envVal !== undefined && envVal !== '') return 'env';

  if (def?.bootstrap) return bootstrapConfig.getSource(key);
  if (cache[key] !== undefined) return 'db';
  return 'default';
}

async function set(key, value) {
  const def = DEFINITIONS[key];
  if (def?.bootstrap) {
    bootstrapConfig.set(key, value);
    return;
  }
  const SystemConfig = require('../models/SystemConfig');
  await SystemConfig.findOneAndUpdate(
    { key },
    { key, value, updatedAt: new Date() },
    { upsert: true }
  );
  cache[key] = value;
}

async function remove(key) {
  const def = DEFINITIONS[key];
  if (def?.bootstrap) {
    bootstrapConfig.remove(key);
    return;
  }
  const SystemConfig = require('../models/SystemConfig');
  await SystemConfig.deleteOne({ key });
  delete cache[key];
}

// Only for tests – resets in-memory state without touching the DB.
function _resetCache() {
  cache = {};
}

module.exports = { DEFINITIONS, loadAll, get, getSource, set, remove, _resetCache };
