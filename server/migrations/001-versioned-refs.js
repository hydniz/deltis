// Initialise versioned references on existing documents.
//
// Lifts pre-versioning data onto the schema that tracks renames of activity
// types and habits historically.
//
//   1. ActivityType:    set version=1 and nameHistory=[] where missing
//   2. HabitDefinition: set version=1 and nameHistory=[] where missing
//   3. ActivityLog:     stamp activityTypeVersion=1 on docs with a ref; for
//                       docs without a ref, look the type up by name and link
//   4. ActivityPlan:    same as ActivityLog
//   5. HabitLog:        set habitVersion=1 where missing
//
// Idempotent: re-running against migrated data is a no-op (uses $exists checks).

const ActivityType    = require('../models/ActivityType');
const HabitDefinition = require('../models/HabitDefinition');
const ActivityLog     = require('../models/ActivityLog');
const ActivityPlan    = require('../models/ActivityPlan');
const HabitLog        = require('../models/HabitLog');

function log(msg) { console.log(`[migration]   ${msg}`); }

async function up() {
  // 1. ActivityTypes
  const atVersioned = await ActivityType.updateMany(
    { version: { $exists: false } },
    { $set: { version: 1 } }
  );
  const atHistory = await ActivityType.updateMany(
    { nameHistory: { $exists: false } },
    { $set: { nameHistory: [] } }
  );
  log(`ActivityType:    version=1 on ${atVersioned.modifiedCount}, nameHistory=[] on ${atHistory.modifiedCount}`);

  // 2. HabitDefinitions
  const hdVersioned = await HabitDefinition.updateMany(
    { version: { $exists: false } },
    { $set: { version: 1 } }
  );
  const hdHistory = await HabitDefinition.updateMany(
    { nameHistory: { $exists: false } },
    { $set: { nameHistory: [] } }
  );
  log(`HabitDefinition: version=1 on ${hdVersioned.modifiedCount}, nameHistory=[] on ${hdHistory.modifiedCount}`);

  // 3. ActivityLogs
  const alWithRef = await ActivityLog.updateMany(
    {
      activityTypeRef: { $exists: true, $ne: null },
      activityTypeVersion: { $exists: false },
    },
    { $set: { activityTypeVersion: 1 } }
  );
  log(`ActivityLog:     activityTypeVersion=1 on ${alWithRef.modifiedCount} (with ref)`);

  const logsWithoutRef = await ActivityLog.find({
    $or: [{ activityTypeRef: null }, { activityTypeRef: { $exists: false } }],
  }).lean();

  let alMatched = 0;
  let alUnmatched = 0;
  for (const entry of logsWithoutRef) {
    if (!entry.activityType) { alUnmatched++; continue; }
    const type = await ActivityType
      .findOne({ userId: entry.userId, label: entry.activityType })
      .select('_id version');
    if (type) {
      await ActivityLog.updateOne(
        { _id: entry._id },
        { $set: { activityTypeRef: type._id, activityTypeVersion: type.version || 1 } }
      );
      alMatched++;
    } else {
      alUnmatched++;
    }
  }
  log(`ActivityLog:     ${alMatched}/${logsWithoutRef.length} ref-less logs linked by name (${alUnmatched} unmatched)`);

  // 4. ActivityPlans
  const apWithRef = await ActivityPlan.updateMany(
    {
      activityTypeRef: { $exists: true, $ne: null },
      activityTypeVersion: { $exists: false },
    },
    { $set: { activityTypeVersion: 1 } }
  );
  log(`ActivityPlan:    activityTypeVersion=1 on ${apWithRef.modifiedCount} (with ref)`);

  const plansWithoutRef = await ActivityPlan.find({
    $or: [{ activityTypeRef: null }, { activityTypeRef: { $exists: false } }],
  }).lean();

  let apMatched = 0;
  let apUnmatched = 0;
  for (const plan of plansWithoutRef) {
    if (!plan.activityType) { apUnmatched++; continue; }
    const type = await ActivityType
      .findOne({ userId: plan.userId, label: plan.activityType })
      .select('_id version');
    if (type) {
      await ActivityPlan.updateOne(
        { _id: plan._id },
        { $set: { activityTypeRef: type._id, activityTypeVersion: type.version || 1 } }
      );
      apMatched++;
    } else {
      apUnmatched++;
    }
  }
  log(`ActivityPlan:    ${apMatched}/${plansWithoutRef.length} ref-less plans linked by name (${apUnmatched} unmatched)`);

  // 5. HabitLogs
  const hlResult = await HabitLog.updateMany(
    { habitVersion: { $exists: false } },
    { $set: { habitVersion: 1 } }
  );
  log(`HabitLog:        habitVersion=1 on ${hlResult.modifiedCount}`);
}

module.exports = { name: '001-versioned-refs', up };
