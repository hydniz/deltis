#!/usr/bin/env node
// Setzt das Admin-Passwort direkt in der Datenbank zurück.
// Verwendung: node scripts/reset-admin-password.js
//         oder: node scripts/reset-admin-password.js --password <neues-passwort>

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
        case '': // Ctrl+C
          process.stdout.write('\n');
          process.exit(1);
          break;
        case '': // Backspace
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

  console.log('── Admin-Passwort zurücksetzen ──────────────────────────');
  console.log(`Datenbank: ${MONGODB_URI}\n`);

  try {
    await mongoose.connect(MONGODB_URI);
  } catch (err) {
    console.error(`Fehler: Verbindung zur Datenbank fehlgeschlagen.\n${err.message}`);
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
    console.error('Fehler: Kein Admin-Account in der Datenbank gefunden.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('Admin-Account gefunden:');
  console.log(`  UUID:     ${admin.uuid}`);
  console.log(`  Username: ${admin.username || '(noch nicht gesetzt)'}\n`);

  if (!newPassword) {
    newPassword = await readSecret('Neues Admin-Passwort:  ');
    const confirm = await readSecret('Passwort bestätigen:   ');
    if (newPassword !== confirm) {
      console.error('Fehler: Passwörter stimmen nicht überein.');
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  if (!newPassword || newPassword.length < MIN_LENGTH) {
    console.error(`Fehler: Passwort muss mindestens ${MIN_LENGTH} Zeichen lang sein.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const hash = await bcrypt.hash(newPassword, ROUNDS);
  await User.findByIdAndUpdate(admin._id, { adminSecretHash: hash });

  console.log('Admin-Passwort wurde erfolgreich zurückgesetzt.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Unerwarteter Fehler:', err.message);
  process.exit(1);
});
