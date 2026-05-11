#!/usr/bin/env node
// Migrates selectedHabitIds and habitSettings from the User document
// into the new UserHabitSettings collection.
//
// Safe to re-run: existing UserHabitSettings documents are never overwritten
// unless --force is passed.
//
// Usage:
//   node scripts/migrate-habit-settings.js
//   node scripts/migrate-habit-settings.js --force   # overwrite existing settings

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/habit_tracker';
const force = process.argv.includes('--force');

// Minimal schemas – strict:false lets us read legacy fields that were removed
const User = mongoose.model('User', new mongoose.Schema({
  uuid: String,
  username: String,
  name: String,
  selectedHabitIds: [mongoose.Schema.Types.ObjectId],
  habitSettings: mongoose.Schema.Types.Mixed,
}, { strict: false }));

const UserHabitSettings = mongoose.model('UserHabitSettings', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  selectedHabitIds: [mongoose.Schema.Types.ObjectId],
  habitSettings: { type: mongoose.Schema.Types.Mixed, default: {} },
}));

async function main() {
  console.log('── Migrate habit settings → UserHabitSettings ───────────');
  console.log(`Database: ${MONGODB_URI}`);
  console.log(`Mode:     ${force ? 'force (overwrite existing)' : 'safe (skip existing)'}\n`);

  await mongoose.connect(MONGODB_URI);

  const users = await User.find({
    $or: [
      { selectedHabitIds: { $exists: true, $not: { $size: 0 } } },
      { habitSettings: { $exists: true, $ne: {} } },
    ]
  }).lean();

  if (users.length === 0) {
    console.log('No users with legacy habit settings found. Nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${users.length} user(s) with legacy habit settings.\n`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of users) {
    const label = user.username || user.name || user._id.toString();
    try {
      const existing = await UserHabitSettings.findOne({ userId: user._id });

      if (existing && !force) {
        console.log(`  SKIP  ${label} (UserHabitSettings already exists)`);
        skipped++;
        continue;
      }

      const doc = {
        userId: user._id,
        selectedHabitIds: user.selectedHabitIds || [],
        habitSettings: user.habitSettings || {},
      };

      await UserHabitSettings.findOneAndUpdate(
        { userId: user._id },
        { $set: doc },
        { upsert: true }
      );

      // Unset the migrated fields from the User document so they no longer take space
      await User.findByIdAndUpdate(user._id, {
        $unset: { selectedHabitIds: '', habitSettings: '' }
      });

      console.log(`  OK    ${label} (${doc.selectedHabitIds.length} habits, ${Object.keys(doc.habitSettings).length} settings)`);
      migrated++;
    } catch (err) {
      console.error(`  ERROR ${label}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone: ${migrated} migrated, ${skipped} skipped, ${errors} errors.`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
