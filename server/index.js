require('dotenv').config();
require('./utils/jwtSecret'); // validates JWT_SECRET / JWT_SECRET_FILE at startup

const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const branding = require('./config/branding');

const BACKUP_LOCK = path.join(__dirname, '..', 'backups', '.backup.lock');

const app = express();

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173',
  credentials: true, // required for cross-origin cookies in dev
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

const { router: versionRouter, API_VERSION } = require('./routes/version');
app.use('/api', versionRouter);
app.use('/api/branding', require('./routes/branding'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
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
    console.log('  Create your admin account at /admin/setup in your browser.');
    console.log('═'.repeat(58) + '\n');
  }

  // Legacy migration: import VALID_UUIDS from .env as regular users
  const legacyUuids = (process.env.VALID_UUIDS || '')
    .split(',')
    .map(u => u.trim())
    .filter(Boolean);

  for (const uuid of legacyUuids) {
    const exists = await User.findOne({ uuid });
    if (!exists) {
      await User.create({ uuid, name: 'User ' + uuid.slice(0, 8) });
      console.log(`✓ Migrated: ${uuid.slice(0, 8)}...`);
    }
  }
}

const { runMigrations } = require('./migrations/runner');

async function start() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✓ MongoDB connected');

  // Apply pending migrations BEFORE seeding so seeds always run against the
  // current schema. A failure here automatically restores from the
  // pre-migration backup and exits the process.
  await runMigrations();

  await seedAdminUser();
  await seedPredefinedData();

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`✓ ${branding.name} server running on port ${PORT}`);
    console.log(`  API version: ${API_VERSION} | ENV: ${process.env.NODE_ENV || 'development'}`);
  });
}

start().catch(err => {
  console.error('✗ Startup failed:', err.message);
  process.exit(1);
});
