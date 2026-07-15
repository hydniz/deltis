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
//
// `expose` decides how much of the effective value the admin API may return:
//   'plain'       – returned as-is (ports, URLs, flags)
//   'credentials' – returned with embedded credentials masked (MongoDB URI)
//   'never'       – only presence is reported, the value never leaves the server
// The fallback for a key without `expose` is 'never', so a newly added secret
// stays hidden when the flag is forgotten.

const bootstrapConfig = require('./bootstrapConfig');

// The main channel always tracks this branch – see UPDATE_RELEASE_CHANNEL.
// Deliberately not configurable: a custom branch is not a release channel and
// would let an instance track arbitrary unreviewed code.
const MAIN_BRANCH = 'main';

const GROUPS = {
  UPDATES: 'OTA Update',
  SERVER: 'Server',
  SECURITY: 'Sicherheit',
  ACCESS: 'Registrierung & Zugang',
};

const DEFINITIONS = {
  // OTA update
  UPDATE_REPO_URL: {
    label: 'GitHub Repository URL',
    group: GROUPS.UPDATES,
    description: 'Öffentliches GitHub-Repository, das auf neue Versionen geprüft wird.',
    type: 'url',
    editable: true,
    expose: 'plain',
    default: 'https://github.com/hydniz/deltis',
  },
  UPDATE_DOCKER_IMAGE: {
    label: 'Docker-Image',
    group: GROUPS.UPDATES,
    description: 'Docker-Hub-Image, das bei Updates im Docker-Modus gepullt wird.',
    type: 'text',
    editable: true,
    expose: 'plain',
    default: 'hydniz/deltis',
    // context: 'docker' | 'host' – the UI only shows the entry in the
    // matching runtime environment (omitted = shown everywhere).
    context: 'docker',
  },
  UPDATE_RELEASE_CHANNEL: {
    label: 'Release-Kanal',
    group: GROUPS.UPDATES,
    description: 'Welche Versionen für Updates geprüft werden.',
    type: 'select',
    options: ['stable', 'beta', 'alpha', 'main'],
    editable: true,
    expose: 'plain',
    default: 'stable',
  },
  // Server
  PORT: {
    label: 'Server-Port',
    group: GROUPS.SERVER,
    description: 'Port auf dem der Server läuft. Neustart erforderlich.',
    type: 'number',
    editable: true,
    expose: 'plain',
    default: '3001',
    restartRequired: true,
  },
  MONGODB_URI: {
    label: 'MongoDB URI',
    group: GROUPS.SERVER,
    description: 'Verbindungszeichenkette für MongoDB. Neustart erforderlich. Wenn in .env gesetzt, überschreibt .env diesen Wert.',
    type: 'password',
    editable: false,  // cannot use the standard config route (chicken-and-egg problem)
    bootstrap: true,  // writable via dedicated bootstrap route: PUT /api/admin/config/bootstrap/MONGODB_URI
    // Host and database name are shown so the admin can verify the target –
    // any user:password in the authority section is masked away.
    expose: 'credentials',
    restartRequired: true,
    default: 'mongodb://localhost:27017/habit_tracker',
  },
  // Sicherheit
  // editable: false keeps the standard PUT /api/admin/config/:key route from
  // accepting writes (tests depend on this). Writes go through the dedicated
  // PUT /api/admin/config/bootstrap/:key route instead (bootstrap: true).
  JWT_SECRET: {
    label: 'JWT Secret',
    group: GROUPS.SECURITY,
    description: 'Geheimnis für JWT-Session-Token. Änderungen erfordern Neustart. .env hat Vorrang.',
    type: 'password',
    editable: false,
    bootstrap: true,
    expose: 'never',
    restartRequired: true,
    default: '',
  },
  JWT_SECRET_FILE: {
    label: 'JWT Secret Datei',
    group: GROUPS.SECURITY,
    description: 'Pfad zur Datei mit dem JWT Secret. Vorrang vor JWT_SECRET. Neustart erforderlich.',
    type: 'text',
    editable: false,
    bootstrap: true,
    // A path is not a secret – showing it is what makes the setting checkable.
    expose: 'plain',
    restartRequired: true,
    default: '',
  },
  PEPPER_FILE: {
    label: 'Pepper-Datei',
    group: GROUPS.SECURITY,
    description: 'Pfad zur Pepper-Datei für Passwort-Hashing. VOR dem ersten Nutzer setzen! Niemals danach ändern.',
    type: 'text',
    editable: false,
    bootstrap: true,
    expose: 'plain',
    restartRequired: true,
    default: '',
  },
  PASSWORD_PEPPER: {
    label: 'Pepper (direkt)',
    group: GROUPS.SECURITY,
    description: 'Pepper-Wert direkt (weniger sicher als Datei). VOR dem ersten Nutzer setzen! Niemals danach ändern.',
    type: 'password',
    editable: false,
    bootstrap: true,
    expose: 'never',
    restartRequired: true,
    default: '',
  },
  // Registrierung & Zugang – who may get an account. Not a security secret:
  // these are access-policy switches and belong in their own group.
  REGISTRATION_ENABLED: {
    label: 'Selbstregistrierung',
    group: GROUPS.ACCESS,
    description: 'Erlaubt Dritten, sich selbst ein Konto zu erstellen. "off" = nur Admins legen Nutzer an. Registrierungen sind zusätzlich rate-limitiert.',
    type: 'select',
    options: ['off', 'on'],
    editable: true,
    expose: 'plain',
    default: 'off',
  },
  REGISTRATION_USER_LIMIT: {
    label: 'Max. Nutzeranzahl',
    group: GROUPS.ACCESS,
    description: 'Obergrenze an Konten bei aktiver Selbstregistrierung (0 = unbegrenzt). Schützt die Instanz vor Missbrauch.',
    type: 'number',
    editable: true,
    expose: 'plain',
    default: '0',
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

// Masks credentials in the authority part of a connection string so host and
// database name stay readable:
//   mongodb://user:pass@host:27017/db → mongodb://***:***@host:27017/db
// A URI without credentials (mongodb://localhost:27017/db) is returned as-is.
function maskCredentials(value) {
  return String(value).replace(/\/\/[^/@]+@/, '//***:***@');
}

// What the admin UI may display for a key, honouring its `expose` policy.
// Returns { value, masked }: `masked` marks a value that is NOT the real one,
// so the UI knows it must not be reused as an edit draft.
function getDisplayValue(key) {
  const def = DEFINITIONS[key];
  const effective = get(key);
  if (!effective) return { value: null, masked: false };

  const expose = def?.expose ?? 'never';
  if (expose === 'plain') return { value: effective, masked: false };
  if (expose === 'credentials') {
    const masked = maskCredentials(effective);
    // Only a value that actually lost something counts as masked – a URI
    // without credentials is shown in full and stays editable as usual.
    return { value: masked, masked: masked !== effective };
  }
  return { value: null, masked: false };
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

module.exports = {
  DEFINITIONS, GROUPS, MAIN_BRANCH,
  loadAll, get, getSource, getDisplayValue, maskCredentials, set, remove, _resetCache,
};
