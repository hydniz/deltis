// Runtime configuration utility.
//
// Precedence (highest first):
//   1. process.env  – set via .env / docker-compose environment:
//   2. DB override  – saved by admin via the settings UI
//   3. Default      – hard-coded default value

const DEFINITIONS = {
  // ── OTA update ────────────────────────────────────────────────────────────
  UPDATE_REPO_URL: {
    label: 'GitHub Repository URL',
    group: 'OTA Update',
    description: 'Öffentliches Repository das auf neue Commits geprüft wird.',
    type: 'url',
    editable: true,
    default: '',
  },
  UPDATE_BRANCH: {
    label: 'Branch',
    group: 'OTA Update',
    description: 'Zu verfolgender Branch.',
    type: 'text',
    editable: true,
    default: 'main',
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
    description: 'Verbindungszeichenkette für MongoDB. Nur per .env setzbar.',
    type: 'password',
    editable: false,
    default: '',
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
    description: 'Pfad zur Pepper-Datei für Passwort-Hashing. Niemals nach erstem Login ändern!',
    type: 'status',
    editable: false,
    default: '',
  },
  PASSWORD_PEPPER: {
    label: 'Pepper (direkt)',
    group: 'Sicherheit',
    description: 'Pepper-Wert. Niemals nach erstem Login ändern!',
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

// Returns the effective value: process.env → DB cache → default
function get(key) {
  const envVal = process.env[key];
  if (envVal !== undefined && envVal !== '') return envVal;
  if (cache[key] !== undefined) return cache[key];
  return DEFINITIONS[key]?.default ?? '';
}

// Returns where the effective value comes from: 'env' | 'db' | 'default'
function getSource(key) {
  const envVal = process.env[key];
  if (envVal !== undefined && envVal !== '') return 'env';
  if (cache[key] !== undefined) return 'db';
  return 'default';
}

async function set(key, value) {
  const SystemConfig = require('../models/SystemConfig');
  await SystemConfig.findOneAndUpdate(
    { key },
    { key, value, updatedAt: new Date() },
    { upsert: true }
  );
  cache[key] = value;
}

async function remove(key) {
  const SystemConfig = require('../models/SystemConfig');
  await SystemConfig.deleteOne({ key });
  delete cache[key];
}

// Only for tests – resets in-memory state without touching the DB.
function _resetCache() {
  cache = {};
}

module.exports = { DEFINITIONS, loadAll, get, getSource, set, remove, _resetCache };
