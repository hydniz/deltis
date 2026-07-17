// Data export/import endpoints (/api/data): full per-user backup as a ZIP
// archive and restore from a previously exported archive.
//
// The archive is self-contained and portable: every cross-document reference
// is stored by NAME (habit name, activity type label, training type name,
// goal name) instead of instance-local ObjectIds, so an export taken on one
// Deltis instance can be imported into a fresh account on another instance
// without any manual fixup. Strava OAuth tokens are intentionally NOT part
// of the export — the connection must be re-established on the new instance,
// but all synced activities travel with the archive.
const express = require('express');
const router = express.Router();
const AdmZip = require('adm-zip');
const multer = require('multer');
const auth = require('../middleware/auth');
const UserHabitSettings = require('../models/UserHabitSettings');
const User = require('../models/User');
const WeightLog = require('../models/WeightLog');
const HabitLog = require('../models/HabitLog');
const HabitDefinition = require('../models/HabitDefinition');
const ActivityLog = require('../models/ActivityLog');
const ActivityType = require('../models/ActivityType');
const ActivityPlan = require('../models/ActivityPlan');
const HabitPlan = require('../models/HabitPlan');
const Goal = require('../models/Goal');
const TrainingType = require('../models/TrainingType');
const TrainingPlan = require('../models/TrainingPlan');
const StravaActivity = require('../models/StravaActivity');
const trainingCriteria = require('../services/trainingCriteria');
const { version: APP_VERSION, apiVersion: API_VERSION } = require('../../package.json');

// Bumped whenever the archive layout changes. Older formats stay importable;
// archives from a NEWER format are rejected with a clear message.
const EXPORT_FORMAT = 2;

const upload = multer({
  storage: multer.memoryStorage(),
  // Synced Strava activities carry their raw API payloads (detail, zones,
  // streams), so a full backup can be far larger than the old CSV-only ones.
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.zip')) cb(null, true);
    else cb(new Error('Only .zip files are accepted'));
  }
});

// CSV helpers

function csvRow(values) {
  return values.map(v => {
    const s = v == null ? '' : String(v);
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  }).join(',');
}

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (lines.length < 2) return [];
  const headers = parseRow(lines[0]);
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const values = parseRow(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = values[i] ?? ''; });
    return obj;
  });
}

function parseRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

function startOfDay(date) {
  const d = new Date(date); d.setHours(0, 0, 0, 0); return d;
}
function endOfDay(date) {
  const d = new Date(date); d.setHours(23, 59, 59, 999); return d;
}

function parseJson(entry) {
  try { return JSON.parse(entry.getData().toString('utf8')); } catch { return null; }
}

// Export

router.get('/export', auth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Resolve helpers: all name lookups needed to replace ObjectIds
    const [allHabits, actTypes, trainingTypes, goals] = await Promise.all([
      HabitDefinition.find({ $or: [{ userId }, { userId: null }] }),
      ActivityType.find({ userId }),
      TrainingType.find({ userId }).sort({ name: 1 }),
      Goal.find({ userId }).sort({ createdAt: 1 })
    ]);
    const habitById        = new Map(allHabits.map(h => [h._id.toString(), h]));
    const actTypeById      = new Map(actTypes.map(t => [t._id.toString(), t]));
    const trainingTypeById = new Map(trainingTypes.map(t => [t._id.toString(), t]));
    const goalById         = new Map(goals.map(g => [g._id.toString(), g]));

    // manifest.json — lets the importer identify the archive and its format
    const manifestJson = JSON.stringify({
      app: 'deltis',
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      apiVersion: API_VERSION
    }, null, 2);

    // habit_definitions.json — the user's own habits with their full
    // definition. Predefined (global) habits are re-seeded on every instance
    // and are therefore referenced by name only.
    const ownHabits = allHabits.filter(h => h.userId && h.userId.toString() === userId.toString());
    const habitDefsJson = JSON.stringify(ownHabits.map(h => ({
      name: h.name,
      unitSymbol: h.unitSymbol,
      type: h.type
    })), null, 2);

    // activity_types.json — full definitions incl. custom fields, so imported
    // logs keep their custom values meaningful.
    const actTypesJson = JSON.stringify(actTypes.map(t => ({
      label: t.label,
      showDistance: t.showDistance,
      showDuration: t.showDuration,
      customFields: (t.customFields || []).map(f => f.toObject ? f.toObject() : f)
    })), null, 2);

    // training_types.json
    const trainingTypesJson = JSON.stringify(trainingTypes.map(t => ({
      name: t.name,
      description: t.description ?? '',
      criteria: t.criteria ?? {}
    })), null, 2);

    // weight.csv
    const weights = await WeightLog.find({ userId }).sort({ date: 1 });
    const weightCsv = [
      csvRow(['date', 'weight', 'unit']),
      ...weights.map(w => csvRow([w.date.toISOString().slice(0, 10), w.weight, w.unit]))
    ].join('\n');

    // habits.csv
    const habitLogs = await HabitLog.find({ userId })
      .populate('habitId', 'name unitSymbol').sort({ date: 1 });
    const habitCsv = [
      csvRow(['date', 'habit_name', 'unit', 'value']),
      ...habitLogs.map(h => csvRow([
        h.date.toISOString().slice(0, 10),
        h.habitId?.name ?? '',
        h.habitId?.unitSymbol ?? '',
        h.value
      ]))
    ].join('\n');

    // activities.csv — the stored activityType string may predate a rename;
    // export the CURRENT label so rows match activity_types.json.
    const actLogs = await ActivityLog.find({ userId })
      .populate('activityTypeRef', 'label').sort({ date: 1 });
    const actCsv = [
      csvRow(['date', 'activity_type', 'duration', 'distance', 'notes', 'custom_values']),
      ...actLogs.map(a => csvRow([
        a.date.toISOString().slice(0, 10),
        a.activityTypeRef?.label ?? a.activityType,
        a.duration ?? '',
        a.distance ?? '',
        a.notes ?? '',
        a.customValues && Object.keys(a.customValues).length ? JSON.stringify(a.customValues) : ''
      ]))
    ].join('\n');

    // settings.json
    const [userDoc, habitSettingsDoc] = await Promise.all([
      User.findById(userId),
      UserHabitSettings.findOne({ userId })
        .populate('selectedHabitIds', 'name')
        .populate('hiddenHabitIds', 'name'),
    ]);
    const habitSettingsResolved = {};
    for (const [idStr, val] of Object.entries(habitSettingsDoc?.habitSettings || {})) {
      const habit = habitById.get(idStr);
      if (habit) habitSettingsResolved[habit.name] = val;
    }
    const settingsJson = JSON.stringify({
      weightUnit: userDoc.weightUnit,
      selectedHabits: (habitSettingsDoc?.selectedHabitIds || []).map(h => h.name),
      hiddenHabits: (habitSettingsDoc?.hiddenHabitIds || []).map(h => h.name),
      hasSelection: habitSettingsDoc?.hasSelection ?? false,
      habitSettings: habitSettingsResolved
    }, null, 2);

    // activity_plans.json
    const actPlans = await ActivityPlan.find({ userId })
      .populate('activityTypeRef', 'label').sort({ scheduledDate: 1 });
    const actPlansJson = JSON.stringify(actPlans.map(p => ({
      date: p.scheduledDate.toISOString().slice(0, 10),
      activity_type: p.activityTypeRef?.label ?? p.activityType,
      duration: p.duration ?? null,
      distance: p.distance ?? null,
      completed: p.completed,
      notes: p.notes ?? '',
      custom_values: p.customValues ?? {}
    })), null, 2);

    // habit_plans.json
    const habitPlans = await HabitPlan.find({ userId })
      .populate('habitId', 'name').sort({ scheduledDate: 1 });
    const habitPlansJson = JSON.stringify(habitPlans.map(p => ({
      date: p.scheduledDate.toISOString().slice(0, 10),
      habit_name: p.habitId?.name ?? p.habitName ?? '',
      completed: p.completed,
      logged_value: p.loggedValue ?? null,
      notes: p.notes ?? ''
    })), null, 2);

    // training_plans.json — referenced training types by name
    const trainingPlans = await TrainingPlan.find({ userId }).sort({ scheduledDate: 1 });
    const trainingPlansJson = JSON.stringify(trainingPlans.map(p => ({
      date: p.scheduledDate.toISOString().slice(0, 10),
      training_type: p.trainingTypeId
        ? (trainingTypeById.get(p.trainingTypeId.toString())?.name ?? null)
        : null,
      criteria: p.criteria ?? null,
      notes: p.notes ?? ''
    })), null, 2);

    // goals.json — all ObjectId references replaced by names:
    // targetRef → targetRefName, trainingTypeId → trainingTypeName,
    // parentGoalId → parentGoalName (meta-goal hierarchy).
    const goalsJson = JSON.stringify(goals.map(g => {
      const obj = g.toObject();
      const refStr = String(obj.targetRef ?? '');
      if (obj.targetRefModel === 'ActivityType') {
        obj.targetRefName = actTypeById.get(refStr)?.label ?? refStr;
      } else if (obj.targetRefModel === 'HabitDefinition') {
        obj.targetRefName = habitById.get(refStr)?.name ?? refStr;
      } else {
        obj.targetRefName = refStr; // 'strava', 'meta' or legacy string label
      }
      if (obj.trainingTypeId) {
        const tt = trainingTypeById.get(String(obj.trainingTypeId));
        if (tt) obj.trainingTypeName = tt.name;
      }
      if (obj.parentGoalId) {
        const parent = goalById.get(String(obj.parentGoalId));
        if (parent) obj.parentGoalName = parent.name;
      }
      delete obj._id;
      delete obj.userId;
      delete obj.__v;
      delete obj.targetRef;
      delete obj.trainingTypeId;
      delete obj.parentGoalId;
      return obj;
    }), null, 2);

    // strava_activities.json — lossless dump incl. raw API payloads. The
    // OAuth connection itself (tokens) is deliberately excluded.
    const stravaActs = await StravaActivity.find({ userId }).sort({ startDate: 1 });
    const stravaActsJson = JSON.stringify(stravaActs.map(a => {
      const obj = a.toObject();
      delete obj._id;
      delete obj.userId;
      delete obj.__v;
      return obj;
    }), null, 2);

    // Build ZIP
    const zip = new AdmZip();
    zip.addFile('manifest.json',          Buffer.from(manifestJson,      'utf8'));
    zip.addFile('weight.csv',             Buffer.from(weightCsv,         'utf8'));
    zip.addFile('habits.csv',             Buffer.from(habitCsv,          'utf8'));
    zip.addFile('activities.csv',         Buffer.from(actCsv,            'utf8'));
    zip.addFile('settings.json',          Buffer.from(settingsJson,      'utf8'));
    zip.addFile('habit_definitions.json', Buffer.from(habitDefsJson,     'utf8'));
    zip.addFile('activity_types.json',    Buffer.from(actTypesJson,      'utf8'));
    zip.addFile('training_types.json',    Buffer.from(trainingTypesJson, 'utf8'));
    zip.addFile('activity_plans.json',    Buffer.from(actPlansJson,      'utf8'));
    zip.addFile('habit_plans.json',       Buffer.from(habitPlansJson,    'utf8'));
    zip.addFile('training_plans.json',    Buffer.from(trainingPlansJson, 'utf8'));
    zip.addFile('goals.json',             Buffer.from(goalsJson,         'utf8'));
    zip.addFile('strava_activities.json', Buffer.from(stravaActsJson,    'utf8'));

    const filename = `deltis-export-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(zip.toBuffer());
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// Import

router.post('/import', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });

    const userId = req.user._id;
    let zip;
    try { zip = new AdmZip(req.file.buffer); }
    catch { return res.status(400).json({ error: 'Ungültige ZIP-Datei' }); }

    // Zip-bomb guard: the upload itself is capped by multer, but a crafted
    // archive can decompress to orders of magnitude more. Check the declared
    // uncompressed sizes BEFORE reading any entry.
    const entries = zip.getEntries();
    if (entries.length > 64) {
      return res.status(400).json({ error: 'Archiv enthält zu viele Dateien.' });
    }
    const totalUncompressed = entries.reduce((sum, e) => sum + (e.header.size || 0), 0);
    if (totalUncompressed > 512 * 1024 * 1024) {
      return res.status(400).json({ error: 'Archiv ist entpackt zu groß.' });
    }

    // manifest.json — absent on format-1 archives (still importable)
    const manifestEntry = zip.getEntry('manifest.json');
    if (manifestEntry) {
      const manifest = parseJson(manifestEntry);
      if (!manifest || (manifest.app && manifest.app !== 'deltis')) {
        return res.status(400).json({ error: 'Das Archiv ist kein Deltis-Export.' });
      }
      if (typeof manifest.format === 'number' && manifest.format > EXPORT_FORMAT) {
        return res.status(400).json({
          error: 'Der Export stammt aus einer neueren Deltis-Version. Bitte zuerst diese Instanz aktualisieren.'
        });
      }
    }

    const results = {
      weight: 0, habits: 0, activities: 0, plans: 0, goals: 0,
      habitDefinitions: 0, activityTypes: 0, trainingTypes: 0, stravaActivities: 0,
      settings: false, errors: []
    };

    // Helpers: resolve or create referenced documents by name
    async function resolveHabit(name, unit, type) {
      let h = await HabitDefinition.findOne({ name, $or: [{ userId }, { userId: null }] });
      if (!h) h = await HabitDefinition.create({ userId, name, unitSymbol: unit || '', type: type || 'amount' });
      return h;
    }
    async function resolveActivityType(label) {
      let t = await ActivityType.findOne({ userId, label });
      if (!t) t = await ActivityType.create({ userId, label });
      return t;
    }
    async function resolveTrainingType(name) {
      let t = await TrainingType.findOne({ userId, name });
      if (!t) t = await TrainingType.create({ userId, name });
      return t;
    }

    // Definitions FIRST so that logs/plans/goals resolve against the full
    // definition instead of creating bare placeholders.

    // habit_definitions.json — create-if-missing; existing habits (own or
    // predefined) are never overwritten.
    const habitDefsEntry = zip.getEntry('habit_definitions.json');
    if (habitDefsEntry) {
      const defs = parseJson(habitDefsEntry);
      if (Array.isArray(defs)) {
        for (const d of defs) {
          try {
            if (!d.name) continue;
            const existing = await HabitDefinition.findOne({ name: d.name, $or: [{ userId }, { userId: null }] });
            if (existing) continue;
            await HabitDefinition.create({
              userId,
              name: d.name,
              unitSymbol: d.unitSymbol || '',
              type: d.type || 'amount'
            });
            results.habitDefinitions++;
          } catch (e) { results.errors.push(`habit_definition (${d.name}): ${e.message}`); }
        }
      }
    }

    // activity_types.json — create-if-missing with the full definition
    const actTypesEntry = zip.getEntry('activity_types.json');
    if (actTypesEntry) {
      const defs = parseJson(actTypesEntry);
      if (Array.isArray(defs)) {
        for (const d of defs) {
          try {
            if (!d.label) continue;
            const existing = await ActivityType.findOne({ userId, label: d.label });
            if (existing) continue;
            await ActivityType.create({
              userId,
              label: d.label,
              showDistance: !!d.showDistance,
              showDuration: d.showDuration !== false,
              customFields: Array.isArray(d.customFields) ? d.customFields : []
            });
            results.activityTypes++;
          } catch (e) { results.errors.push(`activity_type (${d.label}): ${e.message}`); }
        }
      }
    }

    // training_types.json — create-if-missing; invalid criteria are dropped
    // (the type is still created so goals/plans keep their reference).
    const trainingTypesEntry = zip.getEntry('training_types.json');
    if (trainingTypesEntry) {
      const defs = parseJson(trainingTypesEntry);
      if (Array.isArray(defs)) {
        for (const d of defs) {
          try {
            if (!d.name) continue;
            const existing = await TrainingType.findOne({ userId, name: d.name });
            if (existing) continue;
            let criteria = d.criteria ?? {};
            const { valid, errors } = trainingCriteria.validateCriteriaMap(criteria);
            if (!valid) {
              criteria = {};
              results.errors.push(`training_type (${d.name}): Ungültige Kriterien übersprungen (${errors.join('; ')})`);
            }
            await TrainingType.create({
              userId,
              name: d.name,
              description: d.description || '',
              criteria
            });
            results.trainingTypes++;
          } catch (e) { results.errors.push(`training_type (${d.name}): ${e.message}`); }
        }
      }
    }

    // weight.csv
    const weightEntry = zip.getEntry('weight.csv');
    if (weightEntry) {
      for (const row of parseCsv(weightEntry.getData().toString('utf8'))) {
        try {
          const date = new Date(row.date);
          if (isNaN(date)) continue;
          const weight = parseFloat(row.weight);
          if (isNaN(weight)) continue;
          await WeightLog.findOneAndUpdate(
            { userId, date: { $gte: startOfDay(date), $lte: endOfDay(date) } },
            { $set: { userId, date, weight, unit: row.unit || 'kg' } },
            { upsert: true }
          );
          results.weight++;
        } catch (e) { results.errors.push(`weight (${row.date}): ${e.message}`); }
      }
    }

    // habits.csv
    const habitsEntry = zip.getEntry('habits.csv');
    if (habitsEntry) {
      for (const row of parseCsv(habitsEntry.getData().toString('utf8'))) {
        try {
          const date = new Date(row.date);
          if (isNaN(date) || !row.habit_name) continue;
          const value = parseFloat(row.value);
          if (isNaN(value)) continue;
          const habit = await resolveHabit(row.habit_name, row.unit);
          await HabitLog.findOneAndUpdate(
            { userId, habitId: habit._id, date: { $gte: startOfDay(date), $lte: endOfDay(date) } },
            { $set: { userId, habitId: habit._id, habitVersion: habit.version || 1, date, value } },
            { upsert: true }
          );
          results.habits++;
        } catch (e) { results.errors.push(`habit (${row.date}/${row.habit_name}): ${e.message}`); }
      }
    }

    // activities.csv
    const actEntry = zip.getEntry('activities.csv');
    if (actEntry) {
      for (const row of parseCsv(actEntry.getData().toString('utf8'))) {
        try {
          const date = new Date(row.date);
          if (isNaN(date) || !row.activity_type) continue;
          const actType = await resolveActivityType(row.activity_type);
          const duration = row.duration ? parseFloat(row.duration) : undefined;
          const distance = row.distance ? parseFloat(row.distance) : undefined;
          let customValues = {};
          if (row.custom_values) try { customValues = JSON.parse(row.custom_values); } catch { /* skip */ }
          const filter = {
            userId, activityType: row.activity_type,
            date: { $gte: startOfDay(date), $lte: endOfDay(date) },
            ...(duration !== undefined ? { duration } : { duration: { $exists: false } }),
            ...(distance !== undefined ? { distance } : { distance: { $exists: false } }),
          };
          await ActivityLog.findOneAndUpdate(filter, {
            $set: {
              userId, activityType: row.activity_type, activityTypeRef: actType._id,
              activityTypeVersion: actType.version || 1, date,
              ...(duration !== undefined ? { duration } : {}),
              ...(distance !== undefined ? { distance } : {}),
              ...(row.notes ? { notes: row.notes } : {}),
              customValues
            }
          }, { upsert: true });
          results.activities++;
        } catch (e) { results.errors.push(`activity (${row.date}/${row.activity_type}): ${e.message}`); }
      }
    }

    // settings.json
    const settingsEntry = zip.getEntry('settings.json');
    if (settingsEntry) {
      const s = parseJson(settingsEntry);
      if (s) {
        try {
          const update = {};
          if (s.weightUnit) update.weightUnit = s.weightUnit;

          const habitSettingsUpdate = {};

          // hasSelection === true means "deliberately chose" — restore even
          // an empty selection in that case.
          if (Array.isArray(s.selectedHabits) && (s.selectedHabits.length > 0 || s.hasSelection === true)) {
            const ids = [];
            for (const name of s.selectedHabits) {
              const h = await resolveHabit(name, '');
              ids.push(h._id);
            }
            habitSettingsUpdate.selectedHabitIds = ids;
          }

          // Hidden habits only make sense for definitions that exist here
          // (predefined ones) — never create a habit just to hide it.
          if (Array.isArray(s.hiddenHabits) && s.hiddenHabits.length > 0) {
            const ids = [];
            for (const name of s.hiddenHabits) {
              const h = await HabitDefinition.findOne({ name, $or: [{ userId }, { userId: null }] });
              if (h) ids.push(h._id);
            }
            habitSettingsUpdate.hiddenHabitIds = ids;
          }

          if (typeof s.hasSelection === 'boolean') {
            habitSettingsUpdate.hasSelection = s.hasSelection;
          }

          if (s.habitSettings && typeof s.habitSettings === 'object') {
            const resolvedSettings = {};
            for (const [name, val] of Object.entries(s.habitSettings)) {
              const h = await resolveHabit(name, '');
              resolvedSettings[h._id.toString()] = val;
            }
            habitSettingsUpdate.habitSettings = resolvedSettings;
          }

          if (Object.keys(update).length > 0) {
            await User.findByIdAndUpdate(userId, { $set: update });
          }
          if (Object.keys(habitSettingsUpdate).length > 0) {
            await UserHabitSettings.findOneAndUpdate(
              { userId },
              { $set: habitSettingsUpdate },
              { upsert: true }
            );
          }
          results.settings = Object.keys(update).length > 0 || Object.keys(habitSettingsUpdate).length > 0;
        } catch (e) { results.errors.push(`settings: ${e.message}`); }
      }
    }

    // activity_plans.json
    const actPlansEntry = zip.getEntry('activity_plans.json');
    if (actPlansEntry) {
      const plans = parseJson(actPlansEntry);
      if (Array.isArray(plans)) {
        for (const p of plans) {
          try {
            const date = new Date(p.date);
            if (isNaN(date) || !p.activity_type) continue;
            const actType = await resolveActivityType(p.activity_type);
            await ActivityPlan.findOneAndUpdate(
              { userId, activityType: p.activity_type, scheduledDate: { $gte: startOfDay(date), $lte: endOfDay(date) } },
              {
                $set: {
                  userId, activityType: p.activity_type, activityTypeRef: actType._id,
                  activityTypeVersion: actType.version || 1,
                  scheduledDate: date,
                  ...(p.duration != null ? { duration: p.duration } : {}),
                  ...(p.distance != null ? { distance: p.distance } : {}),
                  completed: p.completed ?? false,
                  ...(p.notes ? { notes: p.notes } : {}),
                  customValues: p.custom_values ?? {}
                }
              },
              { upsert: true }
            );
            results.plans++;
          } catch (e) { results.errors.push(`activity_plan (${p.date}/${p.activity_type}): ${e.message}`); }
        }
      }
    }

    // habit_plans.json
    const habitPlansEntry = zip.getEntry('habit_plans.json');
    if (habitPlansEntry) {
      const plans = parseJson(habitPlansEntry);
      if (Array.isArray(plans)) {
        for (const p of plans) {
          try {
            const date = new Date(p.date);
            if (isNaN(date) || !p.habit_name) continue;
            const habit = await resolveHabit(p.habit_name, '');
            await HabitPlan.findOneAndUpdate(
              { userId, habitId: habit._id, scheduledDate: { $gte: startOfDay(date), $lte: endOfDay(date) } },
              {
                $set: {
                  userId, habitId: habit._id, habitName: habit.name,
                  unitSymbol: habit.unitSymbol, habitType: habit.type,
                  scheduledDate: date,
                  completed: p.completed ?? false,
                  ...(p.logged_value != null ? { loggedValue: p.logged_value } : {}),
                  ...(p.notes ? { notes: p.notes } : {})
                }
              },
              { upsert: true }
            );
            results.plans++;
          } catch (e) { results.errors.push(`habit_plan (${p.date}/${p.habit_name}): ${e.message}`); }
        }
      }
    }

    // training_plans.json
    const trainingPlansEntry = zip.getEntry('training_plans.json');
    if (trainingPlansEntry) {
      const plans = parseJson(trainingPlansEntry);
      if (Array.isArray(plans)) {
        for (const p of plans) {
          try {
            const date = new Date(p.date);
            if (isNaN(date)) continue;

            if (p.training_type) {
              const tt = await resolveTrainingType(p.training_type);
              await TrainingPlan.findOneAndUpdate(
                { userId, trainingTypeId: tt._id, scheduledDate: { $gte: startOfDay(date), $lte: endOfDay(date) } },
                { $set: { userId, trainingTypeId: tt._id, criteria: null, scheduledDate: date, notes: p.notes || '' } },
                { upsert: true }
              );
            } else {
              // Ad-hoc plans carry their own criteria; dedupe by comparing
              // against the criteria of plans on the same day.
              const dayPlans = await TrainingPlan.find({
                userId, trainingTypeId: null,
                scheduledDate: { $gte: startOfDay(date), $lte: endOfDay(date) }
              });
              const wanted = JSON.stringify(p.criteria ?? null);
              const exists = dayPlans.some(x => JSON.stringify(x.criteria ?? null) === wanted);
              if (!exists) {
                await TrainingPlan.create({
                  userId, criteria: p.criteria ?? null, scheduledDate: date, notes: p.notes || ''
                });
              }
            }
            results.plans++;
          } catch (e) { results.errors.push(`training_plan (${p.date}): ${e.message}`); }
        }
      }
    }

    // strava_activities.json — upsert by stravaId (unique per user)
    const stravaEntry = zip.getEntry('strava_activities.json');
    if (stravaEntry) {
      const acts = parseJson(stravaEntry);
      if (Array.isArray(acts)) {
        for (const a of acts) {
          try {
            const stravaId = Number(a.stravaId);
            const startDate = new Date(a.startDate);
            if (!stravaId || isNaN(startDate)) continue;
            const doc = { ...a, userId, stravaId, startDate };
            delete doc._id;
            delete doc.__v;
            if (a.startDateLocal) doc.startDateLocal = new Date(a.startDateLocal);
            if (a.syncedAt) doc.syncedAt = new Date(a.syncedAt);
            await StravaActivity.findOneAndUpdate(
              { userId, stravaId },
              { $set: doc },
              { upsert: true }
            );
            results.stravaActivities++;
          } catch (e) { results.errors.push(`strava_activity (${a.stravaId}): ${e.message}`); }
        }
      }
    }

    // goals.json — meta goals first so children can resolve their parent
    const goalsEntry = zip.getEntry('goals.json');
    if (goalsEntry) {
      const goals = parseJson(goalsEntry);
      if (Array.isArray(goals)) {
        const sorted = [...goals].sort((a, b) =>
          (a.type === 'meta' ? 0 : 1) - (b.type === 'meta' ? 0 : 1));
        for (const g of sorted) {
          try {
            if (!g.name || !g.targetRefModel || !g.targetRefName) continue;

            // Resolve targetRef name → ObjectId. 'StravaActivity' → 'strava'
            // and 'Goal' → 'meta' are fixed strings; legacy labels pass
            // through unchanged.
            let targetRef = g.targetRefName;
            const refModel = g.targetRefModel;
            if (refModel === 'ActivityType') {
              const t = await resolveActivityType(g.targetRefName);
              targetRef = t._id;
            } else if (refModel === 'HabitDefinition') {
              const h = await resolveHabit(g.targetRefName, '');
              targetRef = h._id;
            }

            const { targetRefName, trainingTypeName, parentGoalName, ...goalData } = g;

            // Format-1 archives carried raw ObjectIds of the source instance —
            // they are meaningless here and must never be written.
            delete goalData.trainingTypeId;
            delete goalData.parentGoalId;

            if (trainingTypeName) {
              const tt = await resolveTrainingType(trainingTypeName);
              goalData.trainingTypeId = tt._id;
            }
            if (parentGoalName) {
              const parent = await Goal.findOne({ userId, name: parentGoalName, type: 'meta' });
              if (parent) goalData.parentGoalId = parent._id;
              else results.errors.push(`goal (${g.name}): Übergeordnetes Ziel "${parentGoalName}" nicht gefunden`);
            }

            // Restore Date objects
            if (goalData.startDate) goalData.startDate = new Date(goalData.startDate);
            if (goalData.endDate) goalData.endDate = new Date(goalData.endDate);
            if (Array.isArray(goalData.intermediateSteps)) {
              goalData.intermediateSteps = goalData.intermediateSteps.map(s => ({
                ...s, date: new Date(s.date)
              }));
            }

            await Goal.findOneAndUpdate(
              { userId, name: g.name },
              { $set: { ...goalData, targetRef, userId } },
              { upsert: true }
            );
            results.goals++;
          } catch (e) { results.errors.push(`goal (${g.name}): ${e.message}`); }
        }
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
