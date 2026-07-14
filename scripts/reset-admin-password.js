#!/usr/bin/env node
// Resets the admin password directly in the database.
// Usage: node scripts/reset-admin-password.js
//        node scripts/reset-admin-password.js --password <new-password>

require('dotenv').config();
const readline = require('readline');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/habit_tracker';
const MIN_LENGTH = 8;
const ROUNDS = 12;

function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      // Non-interactive: read single line from stdin
      const rl = readline.createInterface({ input: process.stdin });
      rl.once('line', (line) => { rl.close(); resolve(line.trim()); });
      rl.once('error', reject);
      return;
    }

    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let value = '';
    const onData = (char) => {
      switch (char) {
        case '\r':
        case '\n':
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value);
          break;
        case '\u0003': // Ctrl+C
          process.stdout.write('\n');
          process.exit(1);
          break;
        case '\u007f': // Backspace
        case '\b':
          if (value.length > 0) value = value.slice(0, -1);
          break;
        default:
          value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const pwFlagIdx = process.argv.indexOf('--password');
  let newPassword = pwFlagIdx !== -1 ? process.argv[pwFlagIdx + 1] ?? null : null;

  console.log('Reset admin password');
  console.log(`Database: ${MONGODB_URI}\n`);

  try {
    await mongoose.connect(MONGODB_URI);
  } catch (err) {
    console.error(`Error: could not connect to database.\n${err.message}`);
    process.exit(1);
  }

  const User = mongoose.model('User', new mongoose.Schema({
    uuid:            String,
    username:        String,
    isAdmin:         Boolean,
    adminSecretHash: String,
  }, { strict: false }));

  const admin = await User.findOne({ isAdmin: true });
  if (!admin) {
    console.error('Error: no admin account found in the database.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('Admin account found:');
  console.log(`  UUID:     ${admin.uuid}`);
  console.log(`  Username: ${admin.username || '(not set)'}\n`);

  if (!newPassword) {
    newPassword = await readSecret('New admin password:    ');
    const confirm = await readSecret('Confirm password:      ');
    if (newPassword !== confirm) {
      console.error('Error: passwords do not match.');
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  if (!newPassword || newPassword.length < MIN_LENGTH) {
    console.error(`Error: password must be at least ${MIN_LENGTH} characters long.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const hash = await bcrypt.hash(newPassword, ROUNDS);
  await User.findByIdAndUpdate(admin._id, { adminSecretHash: hash });

  console.log('Admin password has been reset successfully.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
