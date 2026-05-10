const express = require('express');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

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
  app.use(express.json());

  app.use('/api/auth', require('../../routes/auth'));
  app.use('/api/admin', require('../../routes/admin'));
  app.use('/api/data', require('../../routes/data'));
  app.use('/api/activities', require('../../routes/activities'));
  app.use('/api/planner', require('../../routes/planner'));
  app.use('/api/habits', require('../../routes/habits'));
  app.use('/api/weight', require('../../routes/weight'));
  app.use('/api/goals', require('../../routes/goals'));
  app.use('/api/activity-types', require('../../routes/activityTypes'));

  return app;
}

async function createUser({ name = 'Test User', isAdmin = false } = {}) {
  const User = require('../../models/User');
  const uuid = crypto.randomUUID();
  const user = await User.create({ uuid, name, isAdmin });
  return { user, token: uuid };
}

async function createAdminUser({ password = 'adminpassword123' } = {}) {
  const User = require('../../models/User');
  const uuid = crypto.randomUUID();
  const adminSecretHash = await bcrypt.hash(password, 12);
  const user = await User.create({ uuid, name: 'Admin', isAdmin: true, adminSecretHash });
  return { user, token: `${uuid}:${password}`, uuid, password };
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = { startDb, stopDb, clearDb, buildApp, createUser, createAdminUser, authHeader };
