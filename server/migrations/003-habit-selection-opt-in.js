// Habit selection becomes opt-in: without a stored selection, no habit counts
// as selected anymore (previously every habit did — opt-out).
//
// To keep existing installations intact, users who actually used habits
// (i.e. have at least one HabitLog) and never saved an explicit selection get
// their effective legacy state persisted: all habits visible to them (global +
// own, minus hidden) become their explicit selection. Users without habit
// logs simply fall through to the new opt-in default.
//
// Idempotent: users whose settings already carry hasSelection are skipped.

const mongoose = require('mongoose');
const UserHabitSettings = require('../models/UserHabitSettings');
const HabitDefinition = require('../models/HabitDefinition');
const HabitLog = require('../models/HabitLog');

function log(msg) { console.log(`[migration]   ${msg}`); }

async function up() {
  const usersColl = mongoose.connection.collection('users');
  const users = await usersColl.find({}, { projection: { _id: 1 } }).toArray();

  let grandfathered = 0;
  let optIn = 0;
  let skipped = 0;

  for (const user of users) {
    const settings = await UserHabitSettings.findOne({ userId: user._id });
    if (settings?.hasSelection) {
      skipped++;
      continue;
    }

    const usedHabits = await HabitLog.exists({ userId: user._id });
    if (!usedHabits) {
      optIn++;
      continue;
    }

    const hiddenIds = (settings?.hiddenHabitIds || []).map(id => id.toString());
    const definitions = await HabitDefinition
      .find({ $or: [{ userId: null }, { userId: user._id }] })
      .select('_id');
    const selectedHabitIds = definitions
      .map(d => d._id)
      .filter(id => !hiddenIds.includes(id.toString()));

    await UserHabitSettings.findOneAndUpdate(
      { userId: user._id },
      { $set: { selectedHabitIds, hasSelection: true } },
      { upsert: true }
    );
    grandfathered++;
  }

  log(`Habit selection: ${grandfathered} grandfathered (all selected), ${optIn} moved to opt-in, ${skipped} skipped (explicit selection)`);
}

module.exports = { name: '003-habit-selection-opt-in', up };
