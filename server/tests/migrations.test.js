const fs = require('fs');
const path = require('path');
const os = require('os');
const mongoose = require('mongoose');

const { startDb, stopDb, clearDb } = require('./helpers/testApp');
const { runMigrations, listMigrationFiles, printStatus } = require('../migrations/runner');
const { createBackup, restoreBackup, pruneOldBackups, listBackups } = require('../migrations/backup');

// Silence the runner's chatty logs during tests where we intentionally produce errors.
const realLog = console.log;
const realErr = console.error;
function silenceConsole() {
  console.log = () => {};
  console.error = () => {};
}
function restoreConsole() {
  console.log = realLog;
  console.error = realErr;
}

// Track tmp dirs/files for cleanup in afterEach.
const tmpResources = [];
function tmpDir(prefix = 'habit-tracker-mig-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpResources.push(dir);
  return dir;
}

// Synthesized migrations live in os.tmpdir(), which sits outside any
// node_modules tree — resolve mongoose's absolute path from THIS test file
// (where Jest already located the module) and bake it in.
const MONGOOSE_PATH = require.resolve('mongoose');

// Writes a synthesized migration source file with the given body. The body has
// access to a local `mongoose` via require.
function writeMigration(dir, prefix, slug, body) {
  const name = `${prefix}-${slug}`;
  const file = path.join(dir, `${name}.js`);
  const source = `const mongoose = require(${JSON.stringify(MONGOOSE_PATH)});
module.exports = {
  name: '${name}',
  async up() {
${body}
  },
};
`;
  fs.writeFileSync(file, source);
  return name;
}

beforeAll(async () => {
  await startDb();
});

afterEach(async () => {
  await clearDb();
  restoreConsole();
  while (tmpResources.length) {
    const dir = tmpResources.pop();
    // Safety: refuse to delete anything outside the OS temp directory.
    if (!dir.startsWith(os.tmpdir() + path.sep) && dir !== os.tmpdir()) {
      throw new Error(`Refusing to rmSync non-temp path: ${dir}`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

afterAll(async () => {
  await stopDb();
});

describe('migration runner', () => {
  it('runs all pending migrations on an empty DB in numeric order', async () => {
    const dir = tmpDir();
    const backupDir = tmpDir('mig-backup-');
    writeMigration(dir, '003', 'c', `    await mongoose.connection.collection('t').insertOne({ step: 3 });`);
    writeMigration(dir, '001', 'a', `    await mongoose.connection.collection('t').insertOne({ step: 1 });`);
    writeMigration(dir, '002', 'b', `    await mongoose.connection.collection('t').insertOne({ step: 2 });`);

    silenceConsole();
    const result = await runMigrations({ dir, backupDir, exitOnFailure: false });
    restoreConsole();
    expect(result.applied).toBe(3);

    const steps = await mongoose.connection.collection('t').find().toArray();
    expect(steps.map(s => s.step)).toEqual([1, 2, 3]);

    const Migration = require('../models/Migration');
    const applied = await Migration.find().sort({ appliedAt: 1 }).lean();
    expect(applied.map(m => m.name)).toEqual(['001-a', '002-b', '003-c']);
    for (const m of applied) {
      expect(typeof m.durationMs).toBe('number');
    }
  });

  it('is idempotent — running twice applies nothing the second time', async () => {
    const dir = tmpDir();
    const backupDir = tmpDir('mig-backup-');
    writeMigration(dir, '001', 'first',
      `    await mongoose.connection.collection('t').insertOne({ k: 'v' });`);

    silenceConsole();
    const r1 = await runMigrations({ dir, backupDir, exitOnFailure: false });
    const r2 = await runMigrations({ dir, backupDir, exitOnFailure: false });
    restoreConsole();

    expect(r1.applied).toBe(1);
    expect(r2.applied).toBe(0);

    // Migration body ran exactly once.
    const docs = await mongoose.connection.collection('t').find().toArray();
    expect(docs).toHaveLength(1);

    // Only one backup file: the second run had nothing pending.
    expect(listBackups({ dir: backupDir })).toHaveLength(1);
  });

  it('rejects migrations with mismatched filename and exported name', async () => {
    const dir = tmpDir();
    const backupDir = tmpDir('mig-backup-');
    fs.writeFileSync(
      path.join(dir, '001-mismatch.js'),
      `module.exports = { name: 'NOT-MATCHING', async up() {} };\n`
    );
    silenceConsole();
    await expect(runMigrations({ dir, backupDir, exitOnFailure: false }))
      .rejects.toThrow(/name "NOT-MATCHING" does not match filename "001-mismatch"/);
    restoreConsole();
  });

  it('rejects duplicate numeric prefixes', async () => {
    const dir = tmpDir();
    writeMigration(dir, '001', 'a', '');
    writeMigration(dir, '001', 'b', '');
    await expect(listMigrationFiles(dir)).rejects.toThrow(/Duplicate migration prefix/);
  });
});

describe('migration runner — backup and rollback', () => {
  it('creates a backup file before applying migrations', async () => {
    const dir = tmpDir();
    const backupDir = tmpDir('mig-backup-');
    writeMigration(dir, '001', 'a',
      `    await mongoose.connection.collection('t').insertOne({ x: 1 });`);

    silenceConsole();
    const { backupFile } = await runMigrations({ dir, backupDir, exitOnFailure: false });
    restoreConsole();

    expect(backupFile).toBeTruthy();
    expect(fs.existsSync(backupFile)).toBe(true);
    expect(path.basename(backupFile)).toMatch(/^pre-migration_.*\.ejson\.gz$/);
  });

  it('does NOT create a backup when no migrations are pending', async () => {
    const dir = tmpDir();
    const backupDir = tmpDir('mig-backup-');
    // No migrations in dir.
    silenceConsole();
    const { applied, backupFile } = await runMigrations({ dir, backupDir, exitOnFailure: false });
    restoreConsole();

    expect(applied).toBe(0);
    expect(backupFile).toBeNull();
    expect(listBackups({ dir: backupDir })).toHaveLength(0);
  });

  it('restores the database from backup when a migration fails mid-sequence', async () => {
    const dir = tmpDir();
    const backupDir = tmpDir('mig-backup-');

    // Pre-existing user data BEFORE any migration.
    const items = mongoose.connection.collection('items');
    await items.insertMany([{ tag: 'alpha' }, { tag: 'beta' }]);

    writeMigration(dir, '001', 'works',
      `    await mongoose.connection.collection('items').updateMany({}, { $set: { migrated: true } });`);
    writeMigration(dir, '002', 'fails',
      `    throw new Error('boom');`);

    silenceConsole();
    let captured;
    try {
      await runMigrations({ dir, backupDir, exitOnFailure: false });
    } catch (err) {
      captured = err;
    }
    restoreConsole();

    expect(captured).toBeDefined();
    expect(captured.code).toBe('MIGRATION_FAILED');
    expect(captured.message).toMatch(/002-fails/);

    // After restore: items back to pre-migration state.
    const post = await items.find().sort({ tag: 1 }).toArray();
    expect(post).toHaveLength(2);
    expect(post.map(d => d.tag)).toEqual(['alpha', 'beta']);
    for (const d of post) {
      expect(d.migrated).toBeUndefined();   // 001's $set was rolled back
    }

    // After restore: migrations collection matches the backup, i.e. is empty.
    // (The 001 marker was inserted AFTER the backup was taken.)
    const Migration = require('../models/Migration');
    const applied = await Migration.find().lean();
    expect(applied).toHaveLength(0);
  });

  it('aborts without restoring when skipBackup=true and a migration fails', async () => {
    const dir = tmpDir();
    const backupDir = tmpDir('mig-backup-');
    await mongoose.connection.collection('items').insertOne({ tag: 'pre' });

    writeMigration(dir, '001', 'partial',
      `    await mongoose.connection.collection('items').insertOne({ tag: 'partial' });
    throw new Error('oops');`);

    silenceConsole();
    let captured;
    try {
      await runMigrations({ dir, backupDir, exitOnFailure: false, skipBackup: true });
    } catch (err) {
      captured = err;
    }
    restoreConsole();

    expect(captured).toBeDefined();
    expect(captured.code).toBe('MIGRATION_FAILED');

    // Without a backup, the half-applied state is left as-is.
    const docs = await mongoose.connection.collection('items').find().toArray();
    expect(docs.map(d => d.tag).sort()).toEqual(['partial', 'pre']);
  });
});

describe('backup module', () => {
  it('round-trips BSON types (ObjectId, Date) intact', async () => {
    const backupDir = tmpDir('mig-backup-');
    const things = mongoose.connection.collection('things');
    const oid = new mongoose.Types.ObjectId();
    const date = new Date('2025-01-15T12:00:00.000Z');
    await things.insertOne({ _id: oid, when: date, label: 'sample' });

    const file = await createBackup({ db: mongoose.connection.db, dir: backupDir });
    expect(fs.existsSync(file)).toBe(true);

    // Corrupt the live data, then restore.
    await things.updateOne({ _id: oid }, { $set: { label: 'overwritten' } });
    await restoreBackup({ db: mongoose.connection.db, file });

    const doc = await things.findOne({ _id: oid });
    expect(doc.label).toBe('sample');
    expect(doc.when).toBeInstanceOf(Date);
    expect(doc.when.toISOString()).toBe(date.toISOString());
    expect(doc._id.toString()).toBe(oid.toString());
  });

  it('pruneOldBackups keeps only the N newest files', async () => {
    const dir = tmpDir('mig-prune-');
    for (let i = 1; i <= 7; i++) {
      fs.writeFileSync(path.join(dir, `pre-migration_2026010${i}T100000Z.ejson.gz`), 'x');
    }
    fs.writeFileSync(path.join(dir, 'other.bin'), 'x');

    const removed = await pruneOldBackups({ dir, keep: 3 });
    expect(removed).toBe(4);

    const left = fs.readdirSync(dir).sort();
    expect(left).toEqual([
      'other.bin',
      'pre-migration_20260105T100000Z.ejson.gz',
      'pre-migration_20260106T100000Z.ejson.gz',
      'pre-migration_20260107T100000Z.ejson.gz',
    ]);
  });

  it('pruneOldBackups returns 0 when directory does not exist', async () => {
    const removed = await pruneOldBackups({ dir: path.join(os.tmpdir(), 'nope-' + Date.now()) });
    expect(removed).toBe(0);
  });
});

describe('migration runner — schema-ahead-of-code guard', () => {
  it('refuses to start when the DB has migrations unknown to the codebase', async () => {
    const dir = tmpDir();
    const backupDir = tmpDir('mig-backup-');

    // Simulate a newer deployment that applied 001-old and 002-new-feature.
    // The "rolled-back" backend only ships 001-old.
    const Migration = require('../models/Migration');
    await Migration.insertMany([
      { name: '001-old', durationMs: 10 },
      { name: '002-new-feature', durationMs: 20 },
    ]);

    writeMigration(dir, '001', 'old', '    // no-op');

    silenceConsole();
    let captured;
    try {
      await runMigrations({ dir, backupDir, exitOnFailure: false });
    } catch (err) {
      captured = err;
    }
    restoreConsole();

    expect(captured).toBeDefined();
    expect(captured.code).toBe('SCHEMA_AHEAD_OF_CODE');
    expect(captured.futureMigrations).toEqual(['002-new-feature']);
    expect(captured.message).toMatch(/002-new-feature/);
  });

  it('starts normally when all DB migrations are also present in the codebase', async () => {
    const dir = tmpDir();
    const backupDir = tmpDir('mig-backup-');

    writeMigration(dir, '001', 'a', '    // no-op');
    writeMigration(dir, '002', 'b', '    // no-op');

    // Both already applied — should detect "up to date", not throw.
    const Migration = require('../models/Migration');
    await Migration.insertMany([
      { name: '001-a', durationMs: 5 },
      { name: '002-b', durationMs: 5 },
    ]);

    silenceConsole();
    const result = await runMigrations({ dir, backupDir, exitOnFailure: false });
    restoreConsole();

    expect(result.applied).toBe(0);
  });

  it('releases the lock before throwing the SCHEMA_AHEAD_OF_CODE error', async () => {
    const dir = tmpDir();
    const backupDir = tmpDir('mig-backup-');

    const Migration = require('../models/Migration');
    await Migration.create({ name: '099-future', durationMs: 1 });

    // No code migration files — all DB records are "future".
    const MigrationLock = require('../models/MigrationLock');
    silenceConsole();
    try {
      await runMigrations({ dir, backupDir, exitOnFailure: false });
    } catch { /* expected */ }
    restoreConsole();

    const lock = await MigrationLock.findOne({ _id: 'lock' });
    expect(lock).toBeNull();
  });
});

describe('migration runner — lock and index invariants', () => {
  it('releases the migration lock even when a migration fails', async () => {
    const dir = tmpDir();
    const backupDir = tmpDir('habit-tracker-mig-backup-');
    writeMigration(dir, '001', 'fail', `    throw new Error('intentional');`);

    const MigrationLock = require('../models/MigrationLock');

    silenceConsole();
    try {
      await runMigrations({ dir, backupDir, exitOnFailure: false });
    } catch { /* expected */ }
    restoreConsole();

    const lock = await MigrationLock.findOne({ _id: 'lock' });
    expect(lock).toBeNull();
  });

  it('unique indexes survive a failed-migration rollback (syncIndexes runs after restore)', async () => {
    const dir = tmpDir();
    const backupDir = tmpDir('habit-tracker-mig-backup-');

    const UserHabitSettings = require('../models/UserHabitSettings');
    const uid = new mongoose.Types.ObjectId();
    await UserHabitSettings.create({ userId: uid, selectedHabitIds: [], habitSettings: {} });

    writeMigration(dir, '001', 'fail', `    throw new Error('intentional');`);

    silenceConsole();
    try {
      await runMigrations({ dir, backupDir, exitOnFailure: false });
    } catch { /* expected */ }
    restoreConsole();

    // The unique index on UserHabitSettings.userId must still be enforced after
    // the restore + syncIndexes — a second insert for the same userId must fail.
    await expect(
      UserHabitSettings.create({ userId: uid, selectedHabitIds: [], habitSettings: {} })
    ).rejects.toThrow();
  });
});

describe('bundled migrations', () => {
  const realMigrationsDir = path.join(__dirname, '..', 'migrations');

  it('001-versioned-refs initialises version/nameHistory and links logs by name', async () => {
    const backupDir = tmpDir('mig-backup-');

    // Use the raw driver to insert legacy docs WITHOUT version/nameHistory
    // (mongoose models default version=1 automatically — bypass them).
    const userId = new mongoose.Types.ObjectId();
    const at = mongoose.connection.collection('activitytypes');
    const al = mongoose.connection.collection('activitylogs');
    const hd = mongoose.connection.collection('habitdefinitions');
    const hl = mongoose.connection.collection('habitlogs');

    const atId = (await at.insertOne({
      userId, label: 'Laufen', showDuration: true, customFields: [], createdAt: new Date(),
    })).insertedId;
    await hd.insertOne({
      name: 'Wasser', unitSymbol: 'ml', type: 'amount', userId: null, isPredefined: true, createdAt: new Date(),
    });

    // Log with no ref → should be linked by name.
    await al.insertOne({ userId, activityType: 'Laufen', date: new Date(), duration: 30, createdAt: new Date() });
    // Log with unmatched name → should remain unmatched.
    await al.insertOne({ userId, activityType: 'NichtVorhanden', date: new Date(), duration: 30, createdAt: new Date() });

    await hl.insertOne({ userId, habitId: new mongoose.Types.ObjectId(), date: new Date(), value: 100, createdAt: new Date() });

    silenceConsole();
    await runMigrations({ dir: realMigrationsDir, backupDir, exitOnFailure: false });
    restoreConsole();

    const typeAfter = await at.findOne({ _id: atId });
    expect(typeAfter.version).toBe(1);
    expect(Array.isArray(typeAfter.nameHistory)).toBe(true);

    const linked = await al.findOne({ activityType: 'Laufen' });
    expect(linked.activityTypeRef.toString()).toBe(atId.toString());
    expect(linked.activityTypeVersion).toBe(1);

    const unmatched = await al.findOne({ activityType: 'NichtVorhanden' });
    expect(unmatched.activityTypeRef == null).toBe(true);

    const habitLogs = await hl.find().toArray();
    expect(habitLogs[0].habitVersion).toBe(1);
  });

  it('001-versioned-refs is a no-op when data is already migrated', async () => {
    const backupDir = tmpDir('mig-backup-');

    const userId = new mongoose.Types.ObjectId();
    const atId = new mongoose.Types.ObjectId();
    await mongoose.connection.collection('activitytypes').insertOne({
      _id: atId, userId, label: 'Yoga', version: 1, nameHistory: [],
      showDuration: true, customFields: [], createdAt: new Date(),
    });
    await mongoose.connection.collection('activitylogs').insertOne({
      userId, activityType: 'Yoga', activityTypeRef: atId, activityTypeVersion: 1,
      date: new Date(), duration: 60, createdAt: new Date(),
    });

    silenceConsole();
    await runMigrations({ dir: realMigrationsDir, backupDir, exitOnFailure: false });
    restoreConsole();

    const log = await mongoose.connection.collection('activitylogs').findOne();
    expect(log.activityTypeVersion).toBe(1);
    expect(log.activityTypeRef.toString()).toBe(atId.toString());
  });

  it('002-habit-settings moves legacy User fields into UserHabitSettings', async () => {
    const backupDir = tmpDir('mig-backup-');

    const users = mongoose.connection.collection('users');
    const habitId1 = new mongoose.Types.ObjectId();
    const habitId2 = new mongoose.Types.ObjectId();

    const userId = (await users.insertOne({
      uuid: 'legacy-uuid-1',
      name: 'Legacy User',
      selectedHabitIds: [habitId1, habitId2],
      habitSettings: { [habitId1.toString()]: { goal: 8 } },
      createdAt: new Date(),
    })).insertedId;

    silenceConsole();
    await runMigrations({ dir: realMigrationsDir, backupDir, exitOnFailure: false });
    restoreConsole();

    const userAfter = await users.findOne({ _id: userId });
    expect(userAfter.selectedHabitIds).toBeUndefined();
    expect(userAfter.habitSettings).toBeUndefined();
    expect(userAfter.name).toBe('Legacy User');

    const UserHabitSettings = require('../models/UserHabitSettings');
    const settings = await UserHabitSettings.findOne({ userId });
    expect(settings).toBeTruthy();
    expect(settings.selectedHabitIds.map(id => id.toString())).toEqual([
      habitId1.toString(),
      habitId2.toString(),
    ]);
    expect(settings.habitSettings[habitId1.toString()]).toEqual({ goal: 8 });
  });

  it('bundled migrations end up recorded with the correct names', async () => {
    const backupDir = tmpDir('mig-backup-');
    silenceConsole();
    await runMigrations({ dir: realMigrationsDir, backupDir, exitOnFailure: false });
    restoreConsole();

    const Migration = require('../models/Migration');
    const names = (await Migration.find().sort({ appliedAt: 1 }).lean()).map(m => m.name);
    expect(names).toEqual(['001-versioned-refs', '002-habit-settings']);
  });
});

describe('printStatus', () => {
  it('lists applied and pending migrations without modifying anything', async () => {
    const dir = tmpDir();
    const backupDir = tmpDir('mig-backup-');
    writeMigration(dir, '001', 'first', `    await mongoose.connection.collection('t').insertOne({ x: 1 });`);
    writeMigration(dir, '002', 'second', `    await mongoose.connection.collection('t').insertOne({ x: 2 });`);

    silenceConsole();
    await runMigrations({ dir, backupDir, exitOnFailure: false });
    restoreConsole();

    // Add a pending third migration.
    writeMigration(dir, '003', 'third', `    await mongoose.connection.collection('t').insertOne({ x: 3 });`);

    const lines = [];
    console.log = (...args) => { lines.push(args.join(' ')); };
    try {
      await printStatus({ dir });
    } finally {
      restoreConsole();
    }
    const out = lines.join('\n');
    expect(out).toContain('001-first');
    expect(out).toContain('002-second');
    expect(out).toContain('003-third');
    expect(out).toMatch(/Applied: 2/);
    expect(out).toMatch(/Pending: 1/);

    // printStatus did not actually run 003.
    const count = await mongoose.connection.collection('t').countDocuments();
    expect(count).toBe(2);
  });
});
