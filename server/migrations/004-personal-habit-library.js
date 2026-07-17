// The shared global habit library becomes personal: every user gets their own
// copy of each global (predefined) habit they actually used — selected it,
// logged it, planned it or targeted it with a goal. All references (logs,
// planner entries, goals, per-user settings) are rewritten to the copy.
//
// Globals a user hid ("deleted") but used earlier become soft-deleted copies,
// so their history keeps resolving and they appear in the trash. Globals a
// user never touched are NOT copied — afterwards only the habits someone
// really chose exist. Finally the global documents are removed; the server
// no longer seeds them (onboarding offers a static catalog instead).
//
// Idempotent: without global habit definitions there is nothing to do.

const mongoose = require('mongoose');
const HabitDefinition = require('../models/HabitDefinition');
const HabitLog = require('../models/HabitLog');
const HabitPlan = require('../models/HabitPlan');
const Goal = require('../models/Goal');
const UserHabitSettings = require('../models/UserHabitSettings');

function log(msg) { console.log(`[migration]   ${msg}`); }

async function up() {
  const globals = await HabitDefinition.find({ userId: null });
  if (globals.length === 0) {
    log('Personal habit library: no global habits found, nothing to do');
    return;
  }

  const usersColl = mongoose.connection.collection('users');
  const users = await usersColl.find({}, { projection: { _id: 1 } }).toArray();

  let copies = 0;
  for (const user of users) {
    const settings = await UserHabitSettings.findOne({ userId: user._id });
    const selectedIds = new Set((settings?.selectedHabitIds || []).map(String));
    const hiddenIds = new Set((settings?.hiddenHabitIds || []).map(String));
    const habitSettings = { ...(settings?.habitSettings || {}) };
    const newSelected = (settings?.selectedHabitIds || [])
      .filter(id => !globals.some(g => String(g._id) === String(id)));

    for (const g of globals) {
      const gid = String(g._id);
      const refMatch = { $in: [g._id, gid] };
      const used = selectedIds.has(gid)
        || await HabitLog.exists({ userId: user._id, habitId: g._id })
        || await HabitPlan.exists({ userId: user._id, habitId: g._id })
        || await Goal.exists({ userId: user._id, targetRef: refMatch });
      if (!used) continue;

      const copy = await HabitDefinition.create({
        userId: user._id,
        name: g.name,
        unitSymbol: g.unitSymbol,
        type: g.type,
        version: g.version || 1,
        nameHistory: g.nameHistory || [],
        isPredefined: false,
        // Hidden globals were "deleted" by this user — keep that state.
        deletedAt: hiddenIds.has(gid) ? new Date() : null,
        createdAt: g.createdAt,
      });
      copies++;

      await HabitLog.updateMany(
        { userId: user._id, habitId: g._id },
        { $set: { habitId: copy._id } }
      );
      await HabitPlan.updateMany(
        { userId: user._id, habitId: g._id },
        { $set: { habitId: copy._id } }
      );
      await Goal.updateMany(
        { userId: user._id, targetRef: refMatch },
        { $set: { targetRef: copy._id } }
      );

      if (selectedIds.has(gid) && !hiddenIds.has(gid)) newSelected.push(copy._id);
      if (habitSettings[gid]) {
        habitSettings[String(copy._id)] = habitSettings[gid];
        delete habitSettings[gid];
      }
    }

    if (settings) {
      await UserHabitSettings.updateOne(
        { userId: user._id },
        { $set: { selectedHabitIds: newSelected, hiddenHabitIds: [], habitSettings } }
      );
    }
  }

  const removed = await HabitDefinition.deleteMany({ userId: null });
  log(`Personal habit library: ${copies} personal copies created for ${users.length} users, ${removed.deletedCount} global habits removed`);
}

module.exports = { name: '004-personal-habit-library', up };
