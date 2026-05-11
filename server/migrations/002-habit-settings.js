// Move legacy User.selectedHabitIds / User.habitSettings into the dedicated
// UserHabitSettings collection, then $unset those fields on User documents.
//
// The current User schema (strict) no longer declares these fields; we read
// them via the raw driver to access the legacy data that survived the schema
// change.
//
// Idempotent: users whose UserHabitSettings doc already exists are skipped,
// and the legacy fields are $unset regardless so re-runs converge to clean.

const mongoose = require('mongoose');
const UserHabitSettings = require('../models/UserHabitSettings');

function log(msg) { console.log(`[migration]   ${msg}`); }

async function up() {
  const usersColl = mongoose.connection.collection('users');

  const legacyUsers = await usersColl.find({
    $or: [
      { selectedHabitIds: { $exists: true, $not: { $size: 0 } } },
      { habitSettings:    { $exists: true, $ne: {} } },
    ],
  }).toArray();

  if (legacyUsers.length === 0) {
    log('No users with legacy habit settings found.');
    return;
  }

  let migrated = 0;
  let skipped = 0;

  for (const user of legacyUsers) {
    const existing = await UserHabitSettings.findOne({ userId: user._id });
    if (existing) {
      skipped++;
    } else {
      await UserHabitSettings.create({
        userId: user._id,
        selectedHabitIds: user.selectedHabitIds || [],
        habitSettings: user.habitSettings || {},
      });
      migrated++;
    }

    // Remove the legacy fields from the User document regardless — they're not
    // part of the current schema and should not linger.
    await usersColl.updateOne(
      { _id: user._id },
      { $unset: { selectedHabitIds: '', habitSettings: '' } }
    );
  }

  log(`UserHabitSettings: ${migrated} migrated, ${skipped} skipped (already existed)`);
}

module.exports = { name: '002-habit-settings', up };
