#!/usr/bin/env node
// Manual rollback CLI — restores a pre-migration backup created automatically
// by the migration runner.
//
// Works entirely in Node (no Docker / mongodump CLI needed), so it complements
// the existing ./restore.sh which uses mongorestore inside the container.
//
// Usage:
//   node scripts/rollback-migration.js                            # list backups
//   node scripts/rollback-migration.js <path-to-backup-file>      # restore

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mongoose = require('mongoose');

const { restoreBackup, listBackups, defaultDir } = require('../server/migrations/backup');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/habit_tracker';

function prettySize(file) {
  try {
    const bytes = fs.statSync(file).size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } catch {
    return '?';
  }
}

function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, ans => { rl.close(); resolve(ans); }));
}

async function main() {
  const target = process.argv[2];

  // No argument: list available backups.
  if (!target) {
    const dir = defaultDir();
    const files = listBackups({ dir });
    console.log('');
    console.log('=== Available pre-migration backups ===');
    console.log('');
    if (files.length === 0) {
      console.log(`  (none in ${dir})`);
      console.log('');
      console.log('  Pre-migration backups are created automatically when the');
      console.log('  application starts and has pending migrations to apply.');
    } else {
      console.log('  Size      File');
      console.log('  ───────────────────────────────────────────────────────────────');
      for (const f of files) {
        console.log(`  ${prettySize(f).padEnd(8)}  ${path.relative(process.cwd(), f)}`);
      }
      console.log('');
      console.log(`  Restore with:  npm run migrate:rollback <file>`);
    }
    console.log('');
    return;
  }

  if (!fs.existsSync(target)) {
    console.error(`✗ Backup file not found: ${target}`);
    process.exit(1);
  }

  console.log('');
  console.log('=== Rollback database from pre-migration backup ===');
  console.log('');
  console.log(`  Backup file:  ${target}`);
  console.log(`  Size:         ${prettySize(target)}`);
  console.log(`  Target DB:    ${MONGODB_URI}`);
  console.log('');
  console.log('  WARNING: all current data will be permanently overwritten!');
  console.log('');

  const confirm = await ask("  Type 'yes' to continue: ");
  if (confirm.trim() !== 'yes') {
    console.log('');
    console.log('  Aborted.');
    console.log('');
    return;
  }

  console.log('');
  console.log('→ Connecting …');
  await mongoose.connect(MONGODB_URI);
  try {
    console.log('→ Restoring …');
    await restoreBackup({ db: mongoose.connection.db, file: target });
    console.log('✓ Database restored.');
    console.log('');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(err => {
  console.error('Rollback failed:', err.message);
  process.exit(1);
});
