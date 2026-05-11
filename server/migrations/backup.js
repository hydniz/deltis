// Node-native MongoDB backup / restore for the migration runner.
//
// Runs entirely inside the Node process: no mongodump CLI, no Docker socket.
// Sufficient for the small (<10 MB) datasets of a personal habit tracker; not
// intended as a general-purpose backup solution.
//
// Format: gzipped Extended-JSON (EJSON) — preserves all BSON types
// (ObjectId, Date, Decimal128, …) across the round-trip.
//
//   { "meta":        { createdAt, dbName, version },
//     "collections": { "users": [<EJSON docs>], "habitlogs": [...], ... } }

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { EJSON } = require('bson');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const BACKUP_FORMAT_VERSION = 1;
const FILE_PREFIX = 'pre-migration_';
const FILE_SUFFIX = '.ejson.gz';

function defaultDir() {
  return path.join(__dirname, '..', '..', 'backups', 'pre-migration');
}

function timestamp() {
  // ISO-ish, filesystem-safe: 20260511T103000Z
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}

// Lists all collections that should be included in a backup. System collections
// (system.*) and views are skipped.
async function listUserCollections(db) {
  const all = await db.listCollections({}, { nameOnly: false }).toArray();
  return all
    .filter(c => c.type !== 'view')
    .filter(c => !c.name.startsWith('system.'))
    .map(c => c.name);
}

// Creates an EJSON+gzip dump of every user collection in `db`.
// Returns the absolute path of the written file.
async function createBackup({ db, dir = defaultDir() } = {}) {
  if (!db) throw new Error('createBackup: db is required');
  await fs.mkdir(dir, { recursive: true });

  const collections = await listUserCollections(db);
  const dump = {};
  for (const name of collections) {
    dump[name] = await db.collection(name).find({}).toArray();
  }

  const payload = {
    meta: {
      createdAt: new Date().toISOString(),
      dbName: db.databaseName,
      version: BACKUP_FORMAT_VERSION,
    },
    collections: dump,
  };

  // EJSON.stringify keeps BSON types intact through JSON.
  const json = EJSON.stringify(payload, { relaxed: false });
  const compressed = await gzip(Buffer.from(json, 'utf8'));

  const file = path.join(dir, `${FILE_PREFIX}${timestamp()}${FILE_SUFFIX}`);
  await fs.writeFile(file, compressed);
  return file;
}

// Reads a backup file and restores its contents into `db`. All current user
// collections are dropped first so the resulting state is exactly what the
// backup contained — no leftovers from a partially-applied migration.
async function restoreBackup({ db, file }) {
  if (!db) throw new Error('restoreBackup: db is required');
  if (!file) throw new Error('restoreBackup: file is required');

  const compressed = await fs.readFile(file);
  const json = (await gunzip(compressed)).toString('utf8');
  const payload = EJSON.parse(json, { relaxed: false });

  if (!payload || !payload.collections) {
    throw new Error(`restoreBackup: invalid backup file (no 'collections' key): ${file}`);
  }

  // Drop everything currently in the DB so we end up with exactly the snapshot.
  const current = await listUserCollections(db);
  for (const name of current) {
    await db.collection(name).drop().catch(err => {
      // Tolerate 'ns not found' — collection was already gone.
      if (err && err.codeName !== 'NamespaceNotFound') throw err;
    });
  }

  for (const [name, docs] of Object.entries(payload.collections)) {
    if (!Array.isArray(docs) || docs.length === 0) continue;
    await db.collection(name).insertMany(docs, { ordered: true });
  }
}

// Deletes old pre-migration backups, keeping the `keep` newest by filename
// (filenames are timestamp-sorted, so lexicographic order == chronological).
// Returns the number of files deleted.
async function pruneOldBackups({ dir = defaultDir(), keep = 5 } = {}) {
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }

  const files = entries
    .filter(f => f.startsWith(FILE_PREFIX) && f.endsWith(FILE_SUFFIX))
    .sort()             // ascending: oldest first
    .reverse();         // newest first

  const toDelete = files.slice(keep);
  for (const f of toDelete) {
    await fs.unlink(path.join(dir, f));
  }
  return toDelete.length;
}

// Lists all pre-migration backups in `dir`, newest first. Synchronous helper
// for the rollback CLI.
function listBackups({ dir = defaultDir() } = {}) {
  if (!fsSync.existsSync(dir)) return [];
  return fsSync.readdirSync(dir)
    .filter(f => f.startsWith(FILE_PREFIX) && f.endsWith(FILE_SUFFIX))
    .sort()
    .reverse()
    .map(f => path.join(dir, f));
}

module.exports = {
  createBackup,
  restoreBackup,
  pruneOldBackups,
  listBackups,
  defaultDir,
  FILE_PREFIX,
  FILE_SUFFIX,
};
