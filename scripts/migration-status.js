#!/usr/bin/env node
// Diagnostic: shows applied vs pending migrations against the configured DB.
// Usage: npm run migrate:status

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const { printStatus } = require('../server/migrations/runner');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/habit_tracker';

(async () => {
  await mongoose.connect(MONGODB_URI);
  try {
    await printStatus();
  } finally {
    await mongoose.disconnect();
  }
})().catch(err => {
  console.error('Status check failed:', err.message);
  process.exit(1);
});
