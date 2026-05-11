// Database migration runner.
//
// Discovers migrations under this directory (files matching `NNN-*.js`), sorts
// them numerically, and applies any that are not yet recorded in the
// `migrations` collection. Before applying anything it takes a pre-migration
// backup of the entire database via ./backup.js; if any migration fails the
// backup is automatically restored and the process aborts.
//
// Each migration file exports:
//   {
//     name: '003-thing',   // must match filename without .js
//     async up() { ... }   // idempotent: safe to run against already-migrated data
//   }
//
// API:
//   runMigrations({ dir?, mongoose?, exitOnFailure?, skipBackup?, backupDir? })
//   printStatus()

const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const { createBackup, restoreBackup, pruneOldBackups, defaultDir: defaultBackupDir } = require('./backup');

const MIGRATION_FILE_PATTERN = /^(\d{3,})-[A-Za-z0-9_-]+\.js$/;
const LOCK_POLL_INTERVAL_MS = 1000;
const LOCK_POLL_MAX_ATTEMPTS = 30;
const BACKUP_RETENTION = 5;

function log(msg) {
  console.log(`[migration] ${msg}`);
}

function logErr(msg) {
  console.error(`[migration] ${msg}`);
}

// Lists migration files in `dir`, sorted by numeric prefix ascending.
async function listMigrationFiles(dir) {
  const entries = await fs.readdir(dir);
  const matches = entries
    .map(f => ({ file: f, m: f.match(MIGRATION_FILE_PATTERN) }))
    .filter(x => x.m);

  // Detect duplicate prefixes early — order would be undefined.
  const seen = new Map();
  for (const { file, m } of matches) {
    const prefix = m[1];
    if (seen.has(prefix)) {
      throw new Error(`Duplicate migration prefix "${prefix}": ${seen.get(prefix)} and ${file}`);
    }
    seen.set(prefix, file);
  }

  return matches
    .sort((a, b) => parseInt(a.m[1], 10) - parseInt(b.m[1], 10))
    .map(x => x.file);
}

// Loads a migration module and verifies its declared name matches the filename.
function loadMigration(dir, file) {
  const fullPath = path.join(dir, file);
  // Clear require cache so tests can swap in custom migration dirs.
  delete require.cache[require.resolve(fullPath)];
  const mod = require(fullPath);

  const expectedName = file.replace(/\.js$/, '');
  if (!mod || typeof mod.up !== 'function') {
    throw new Error(`Migration ${file} must export an async up() function`);
  }
  if (mod.name !== expectedName) {
    throw new Error(`Migration ${file}: exported name "${mod.name}" does not match filename "${expectedName}"`);
  }
  return mod;
}

// Acquires the advisory lock. Polls if another process holds it. Throws if
// still blocked after LOCK_POLL_MAX_ATTEMPTS * LOCK_POLL_INTERVAL_MS.
async function acquireLock(MigrationLock) {
  for (let attempt = 1; attempt <= LOCK_POLL_MAX_ATTEMPTS; attempt++) {
    try {
      await MigrationLock.create({ _id: 'lock', host: os.hostname() });
      return;
    } catch (err) {
      if (err && err.code === 11000) {
        if (attempt === 1) log('Another instance is migrating, waiting for lock …');
        await new Promise(r => setTimeout(r, LOCK_POLL_INTERVAL_MS));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Could not acquire migration lock after ${LOCK_POLL_MAX_ATTEMPTS}s`);
}

async function releaseLock(MigrationLock) {
  try {
    await MigrationLock.deleteMany({});
  } catch (err) {
    logErr(`Warning: failed to release migration lock: ${err.message}`);
  }
}

// Main entry point. Throws (or exits, depending on opts) on failure.
async function runMigrations(opts = {}) {
  const {
    dir = __dirname,
    mongoose = require('mongoose'),
    exitOnFailure = true,
    skipBackup = process.env.MIGRATION_SKIP_BACKUP === '1',
    backupDir = defaultBackupDir(),
  } = opts;

  // Resolve models against this mongoose instance. Using the cached registry
  // means tests sharing the global mongoose see the same models.
  const Migration = mongoose.models.Migration || require('../models/Migration');
  const MigrationLock = mongoose.models.MigrationLock || require('../models/MigrationLock');

  await acquireLock(MigrationLock);
  try {
    const files = await listMigrationFiles(dir);
    const applied = await Migration.find().select('name').lean();
    const appliedSet = new Set(applied.map(m => m.name));

    const pending = files.filter(f => !appliedSet.has(f.replace(/\.js$/, '')));
    if (pending.length === 0) {
      log(`Database schema is up to date (${appliedSet.size} migration(s) applied)`);
      return { applied: 0, backupFile: null };
    }

    log(`${pending.length} pending migration(s): ${pending.join(', ')}`);

    // 1. Backup before we touch anything.
    let backupFile = null;
    if (!skipBackup) {
      try {
        log('Creating pre-migration backup …');
        backupFile = await createBackup({ db: mongoose.connection.db, dir: backupDir });
        log(`Backup created: ${backupFile}`);
      } catch (err) {
        logErr(`Backup failed: ${err.message}`);
        logErr('Aborting migrations — refusing to migrate without rollback safety net.');
        if (exitOnFailure) process.exit(1);
        const e = new Error(`Backup failed: ${err.message}`);
        e.code = 'BACKUP_FAILED';
        throw e;
      }
    } else {
      log('Skipping backup (skipBackup=true)');
    }

    // 2. Apply each pending migration in order.
    for (const file of pending) {
      const migration = loadMigration(dir, file);
      log(`→ Running: ${migration.name} …`);
      const startedAt = Date.now();
      try {
        await migration.up();
      } catch (err) {
        const elapsed = Date.now() - startedAt;
        logErr(`✗ Failed: ${migration.name} after ${elapsed} ms — ${err.message}`);

        if (backupFile) {
          log('→ Rolling back from backup …');
          let restoreError = null;
          try {
            await restoreBackup({ db: mongoose.connection.db, file: backupFile });
            // Recreate indexes lost when collections were dropped during restore.
            for (const model of Object.values(mongoose.models)) {
              try { await model.syncIndexes(); } catch (e) {
                logErr(`Warning: syncIndexes for ${model.modelName}: ${e.message}`);
              }
            }
          } catch (restoreErr) {
            restoreError = restoreErr;
          }

          if (!restoreError) {
            log('✓ Database restored from pre-migration backup.');
            logErr('Migration run aborted. Investigate the failure before restarting.');
            if (exitOnFailure) process.exit(1);
            const e = new Error(`Migration ${migration.name} failed: ${err.message}`);
            e.code = 'MIGRATION_FAILED';
            e.cause = err;
            throw e;
          }

          logErr('✗ CRITICAL: restore from backup ALSO failed.');
          logErr(`  Original migration error: ${err.message}`);
          logErr(`  Restore error:           ${restoreError.message}`);
          logErr(`  Backup file:             ${backupFile}`);
          logErr('  Manual intervention required.');
          if (exitOnFailure) process.exit(2);
          const e = new Error(`Migration and restore both failed: ${err.message} / ${restoreError.message}`);
          e.code = 'MIGRATION_FAILED_RESTORE_FAILED';
          e.cause = err;
          e.restoreError = restoreError;
          e.backupFile = backupFile;
          throw e;
        }

        // No backup taken (skipBackup) — just abort.
        if (exitOnFailure) process.exit(1);
        const e = new Error(`Migration ${migration.name} failed: ${err.message}`);
        e.code = 'MIGRATION_FAILED';
        e.cause = err;
        throw e;
      }

      const durationMs = Date.now() - startedAt;
      await Migration.create({ name: migration.name, durationMs });
      log(`✓ Applied: ${migration.name} (${durationMs} ms)`);
    }

    // 3. Trim retained backups.
    if (backupFile) {
      const removed = await pruneOldBackups({ dir: backupDir, keep: BACKUP_RETENTION });
      if (removed > 0) log(`Pruned ${removed} old pre-migration backup(s)`);
    }

    log(`✓ Applied ${pending.length} migration(s)`);
    return { applied: pending.length, backupFile };
  } finally {
    await releaseLock(MigrationLock);
  }
}

// Diagnostic: prints applied vs pending migrations without modifying anything.
// Requires an existing mongoose connection.
async function printStatus(opts = {}) {
  const {
    dir = __dirname,
    mongoose = require('mongoose'),
  } = opts;
  const Migration = mongoose.models.Migration || require('../models/Migration');

  const files = await listMigrationFiles(dir);
  const applied = await Migration.find().sort({ appliedAt: 1 }).lean();
  const appliedSet = new Set(applied.map(m => m.name));

  console.log('');
  console.log('=== Migration status ===');
  console.log('');
  console.log(`Applied: ${applied.length}`);
  for (const m of applied) {
    console.log(`  ✓ ${m.name}  (${m.durationMs ?? '?'} ms, ${new Date(m.appliedAt).toISOString()})`);
  }
  const pending = files.filter(f => !appliedSet.has(f.replace(/\.js$/, '')));
  console.log('');
  console.log(`Pending: ${pending.length}`);
  for (const f of pending) {
    console.log(`  · ${f.replace(/\.js$/, '')}`);
  }
  console.log('');
}

module.exports = {
  runMigrations,
  printStatus,
  listMigrationFiles,    // exported for tests
  MIGRATION_FILE_PATTERN,
};
