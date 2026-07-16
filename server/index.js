// Server entry point: loads configuration, connects to MongoDB, runs pending
// database migrations, mounts the /api routes and serves the built frontend.
require('dotenv').config();
require('./utils/jwtSecret'); // load + validate early; warns but no longer exits if missing

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const branding = require('./config/branding');
const serverState = require('./utils/serverState');
const bootstrapConfig = require('./utils/bootstrapConfig');

const BACKUP_LOCK = path.join(__dirname, '..', 'backups', '.backup.lock');

const app = express();

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173',
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());

// Block write requests while a backup is in progress
app.use((req, res, next) => {
  if (fs.existsSync(BACKUP_LOCK) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return res.status(503).json({
      error: 'Backup läuft – Schreibzugriffe vorübergehend gesperrt. Bitte in Kürze erneut versuchen.'
    });
  }
  next();
});

// Setup-mode guard
// When MongoDB is not yet reachable the server enters setup mode. Only the
// setup wizard routes and static frontend assets are served.
app.use((req, res, next) => {
  if (!serverState.setupMode) return next();
  if (!req.path.startsWith('/api/')) return next(); // serve React frontend

  const allowed = [
    /^\/api\/?$/,                        // version endpoint
    /^\/api\/branding/,
    /^\/api\/init($|\/)/,                // first-installation wizard
    /^\/api\/admin\/setup-status/,
    /^\/api\/admin\/setup($|\/)/,        // POST /api/admin/setup + /setup/bootstrap
  ];
  if (allowed.some(re => re.test(req.path))) return next();

  return res.status(503).json({
    error: 'Server im Einrichtungsmodus. Bitte zuerst das Setup abschließen.',
    setupMode: true,
  });
});

// Emergency-mode guard: reduced API after a failed update/migration, so the
// admin can log in and trigger the one-click rollback (see middleware file).
app.use(require('./middleware/emergencyGuard'));

const { router: versionRouter, API_VERSION } = require('./routes/version');
app.use('/api', versionRouter);
app.use('/api/branding', require('./routes/branding'));
app.use('/api/init', require('./routes/init'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin/update', require('./routes/update'));
app.use('/api/admin/config', require('./routes/config'));
app.use('/api/data', require('./routes/data'));
app.use('/api/activities', require('./routes/activities'));
app.use('/api/planner', require('./routes/planner'));
app.use('/api/habits', require('./routes/habits'));
app.use('/api/weight', require('./routes/weight'));
app.use('/api/goals', require('./routes/goals'));
app.use('/api/activity-types', require('./routes/activityTypes'));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// Seeding

async function seedPredefinedData() {
  const HabitDefinition = require('./models/HabitDefinition');
  const habits = [
    { name: 'Screen Time', unitSymbol: 'h', type: 'duration' },
    { name: 'Kreatin', unitSymbol: 'g', type: 'amount' },
    { name: 'Zigaretten', unitSymbol: 'Stück', type: 'amount' },
    { name: 'Wasser', unitSymbol: 'ml', type: 'amount' },
    { name: 'Schlaf', unitSymbol: 'h', type: 'duration' },
    { name: 'Meditation', unitSymbol: 'min', type: 'duration' },
    { name: 'Koffein', unitSymbol: 'mg', type: 'amount' },
    { name: 'Alkohol', unitSymbol: 'Gläser', type: 'amount' },
  ];
  for (const h of habits) {
    await HabitDefinition.findOneAndUpdate(
      { name: h.name, userId: null },
      { ...h, userId: null, isPredefined: true },
      { upsert: true }
    );
  }
}

async function seedAdminUser() {
  const User = require('./models/User');
  const admin = await User.findOne({ isAdmin: true });
  if (!admin) {
    console.log('\n' + '═'.repeat(58));
    console.log(`  ${branding.name} – FIRST START`);
    console.log('  Open /init in your browser to create the admin account and configure the app.');
    console.log('═'.repeat(58) + '\n');
  }

  const legacyUuids = (process.env.VALID_UUIDS || '')
    .split(',').map(u => u.trim()).filter(Boolean);
  for (const uuid of legacyUuids) {
    const exists = await User.findOne({ uuid });
    if (!exists) {
      await User.create({ uuid, name: 'User ' + uuid.slice(0, 8) });
      console.log(`✓ Migrated: ${uuid.slice(0, 8)}...`);
    }
  }
}

// DB connection + post-connect setup

const { runMigrations } = require('./migrations/runner');
const appConfig = require('./utils/config');

async function connectAndInit() {
  const uri = bootstrapConfig.get('MONGODB_URI') || 'mongodb://localhost:27017/deltis';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

  mongoose.connection.on('error', err => {
    console.error('✗ MongoDB connection error:', err.message);
  });

  // exitOnFailure:false – a failed migration must NOT crash-loop the container.
  // The typed error is handled in start() and puts the app into emergency mode
  // (the runner has already auto-restored the pre-migration backup by then).
  await runMigrations({ exitOnFailure: false });
  await appConfig.loadAll();
  await seedAdminUser();
  await seedPredefinedData();
}

// Error codes from the migration runner that mean "DB reachable, but the
// schema/migration state is broken" → emergency mode, not setup mode.
const MIGRATION_ERROR_CODES = new Set([
  'MIGRATION_FAILED',
  'MIGRATION_FAILED_RESTORE_FAILED',
  'SCHEMA_AHEAD_OF_CODE',
  'BACKUP_FAILED',
]);

// Post-update boot reconciliation
// update-state.json travels across the container swap (backups/ is mounted).
// Whoever boots next closes the loop: if we ARE the target version, the update
// succeeded; if we are the OLD version again, the automatic recovery kicked in
// and the state stays 'failed' so the UI offers the rollback options.

const updateState = require('./utils/updateState');
const updateLog = require('./utils/updateLog');

function reconcileUpdateState(bootError) {
  const st = updateState.read();
  if (!st.phase || st.phase === 'idle') return;
  if (st.logFile) updateLog.attachToFile(st.logFile);

  const pkg = require('../package.json');
  const commit = (process.env.GIT_COMMIT || '').substring(0, 7);
  const isTargetVersion = st.toVersion === pkg.version || (commit && st.toVersion === commit);

  if (['backing-up', 'pulling', 'applying', 'started-new'].includes(st.phase)) {
    if (bootError) {
      updateState.write({ phase: 'failed', error: `Boot nach Update fehlgeschlagen: ${bootError.message}`, recovered: false });
      updateLog.log(`✗ [Boot] App-Start nach Update fehlgeschlagen: ${bootError.message}`);
      return;
    }
    if (isTargetVersion) {
      updateState.write({ phase: 'success', error: null, finishedAt: new Date().toISOString() });
      updateLog.log(`✓ [Boot] Update erfolgreich: Version ${pkg.version} läuft, Migrationen abgeschlossen.`);
    } else {
      // Old version booted while an update was supposedly in flight – the
      // helper's automatic recovery restarted us.
      updateState.write({ phase: 'failed', error: st.error || 'Update wurde nicht abgeschlossen – alte Version läuft wieder.', recovered: true });
      updateLog.log(`⚠ [Boot] Alte Version ${pkg.version} läuft wieder – Update wurde nicht abgeschlossen.`);
    }
    return;
  }

  if (st.phase === 'failed' && !bootError && isTargetVersion) {
    // A previously failed run, but the target version is now up and healthy
    // (e.g. manual retry) – close it out.
    updateState.write({ phase: 'success', error: null, finishedAt: new Date().toISOString() });
    updateLog.log(`✓ [Boot] Version ${pkg.version} läuft – vorheriger Fehlerzustand aufgelöst.`);
  }
}

// Port auto-discovery lives in utils/portFinder.js; the chosen port is
// logged prominently, written to .run.port and exposed via GET /api/.
const { listenOnAvailablePort } = require('./utils/portFinder');

// Reconnect hook (called by admin setup/bootstrap route)

serverState.reconnect = async () => {
  if (mongoose.connection.readyState === 1) {
    // Already connected – just reload config and seeds.
    await appConfig.loadAll();
    await seedAdminUser();
    await seedPredefinedData();
    serverState.setupMode = false;
    return;
  }
  await connectAndInit();
  serverState.setupMode = false;
  console.log('✓ MongoDB reconnected – setup mode deactivated.');
};

// Startup

async function start() {
  const desiredPort = parseInt(process.env.PORT || '3001', 10);
  const { port } = await listenOnAvailablePort(app, desiredPort);
  serverState.actualPort = port;

  console.log(`✓ ${branding.name} server running on port ${port}`);
  console.log(`  API version: ${API_VERSION} | ENV: ${process.env.NODE_ENV || 'development'}`);

  // Persist the effective port so run.sh / operators can always find the app,
  // and shout loudly when it differs from the configured one.
  try { fs.writeFileSync(path.join(__dirname, '..', '.run.port'), `${port}\n`); } catch { /* read-only fs */ }
  if (port !== desiredPort) {
    console.warn('\n' + '═'.repeat(58));
    console.warn(`  ⚠ PORT ${desiredPort} WAR BELEGT`);
    console.warn(`  Der Server läuft stattdessen auf Port ${port}:`);
    console.warn(`  → http://localhost:${port}`);
    console.warn('  (auch gespeichert in .run.port und sichtbar unter GET /api/)');
    console.warn('═'.repeat(58) + '\n');
  }

  let bootError = null;
  try {
    await connectAndInit();
    serverState.setupMode = false;
    console.log('✓ MongoDB connected');
  } catch (err) {
    bootError = err;
    if (MIGRATION_ERROR_CODES.has(err.code)) {
      // DB is reachable but the schema/migration state is broken → emergency
      // mode: reduced API, UI offers the one-click rollback.
      serverState.emergencyMode = {
        code: err.code,
        message: err.message,
        backupFile: err.backupFile || updateState.read().backupFile || null,
      };
      console.error('\n' + '═'.repeat(58));
      console.error(`  ${branding.name} – NOTFALLBETRIEB`);
      console.error(`  Grund: [${err.code}] ${err.message}`);
      console.error('  Der Admin kann im UI den Rollback starten (Admin → Updates).');
      console.error('═'.repeat(58) + '\n');
    } else {
      serverState.setupMode = true;
      console.warn('\n' + '═'.repeat(58));
      console.warn(`  ${branding.name} – SETUP MODE`);
      console.warn('  MongoDB not reachable. Configure the connection at /admin/setup');
      console.warn(`  Reason: ${err.message}`);
      console.warn('═'.repeat(58) + '\n');
    }
  }

  // Close the loop on a pending update (success / auto-recovered failure).
  try { reconcileUpdateState(bootError); } catch (err) {
    console.error(`✗ Update-state reconciliation failed: ${err.message}`);
  }

  // Periodic "new release available?" check for the admin UI badge.
  require('./routes/update').startBackgroundChecks();
}

start().catch(err => {
  console.error('✗ Startup failed:', err.message);
  process.exit(1);
});
