// jwtSecret.js provides a deterministic default when NODE_ENV=test (set by Jest).
// No explicit JWT_SECRET assignment needed here.

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../../utils/jwtSecret');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const crypto = require('crypto');

let mongod;

async function startDb() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}

async function stopDb() {
  await mongoose.disconnect();
  await mongod.stop();
}

async function clearDb() {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}

function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(require('../../middleware/securityHeaders'));
  app.use('/api/health/sync', express.json({ limit: '5mb' }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(require('../../middleware/sanitizeBody'));

  app.use('/api', require('../../routes/version').router);
  app.use('/api/init', require('../../routes/init'));
  app.use('/api/auth', require('../../routes/auth'));
  app.use('/api/admin', require('../../routes/admin'));
  app.use('/api/admin/update', require('../../routes/update'));
  app.use('/api/admin/config', require('../../routes/config'));
  app.use('/api/data', require('../../routes/data'));
  app.use('/api/activities', require('../../routes/activities'));
  app.use('/api/planner', require('../../routes/planner'));
  app.use('/api/habits', require('../../routes/habits'));
  app.use('/api/weight', require('../../routes/weight'));
  app.use('/api/goals', require('../../routes/goals'));
  app.use('/api/activity-types', require('../../routes/activityTypes'));
  app.use('/api/training-types', require('../../routes/trainingTypes'));
  app.use('/api/strava', require('../../routes/strava'));
  app.use('/api/health', require('../../routes/health'));
  app.use('/api/metrics', require('../../routes/metrics'));

  return app;
}

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' });
}

// Migration user: no username, no password set yet
async function createUser({ name = 'Test User', isAdmin = false } = {}) {
  const User = require('../../models/User');
  const uuid = crypto.randomUUID();
  const user = await User.create({ uuid, name, isAdmin });
  const token = signToken(user._id);
  return { user, token, uuid };
}

// Regular user who has completed migration (username + password set)
async function createUserWithPassword({
  name = 'Test User',
  username = 'testuser',
  password = 'testpass123',
  mustChangePassword = false,
} = {}) {
  const User = require('../../models/User');
  const pw = require('../../utils/password');
  const uuid = crypto.randomUUID();
  const passwordHash = await pw.hash(password);
  const user = await User.create({ uuid, name, username, passwordHash, mustChangePassword });
  const token = signToken(user._id);
  return { user, token, uuid, username, password };
}

// Admin user with passwordHash
async function createAdminUser({ password = 'adminpassword123' } = {}) {
  const User = require('../../models/User');
  const pw = require('../../utils/password');
  const uuid = crypto.randomUUID();
  const passwordHash = await pw.hash(password);
  const user = await User.create({ uuid, name: 'Admin', isAdmin: true, passwordHash });
  const token = signToken(user._id);
  return { user, token, uuid, password };
}

// Sets the auth_token cookie — keeps the same name so all test files need no changes.
function authHeader(token) {
  return { Cookie: `auth_token=${token}` };
}

module.exports = {
  startDb, stopDb, clearDb, buildApp,
  createUser, createUserWithPassword, createAdminUser,
  authHeader, signToken,
};
