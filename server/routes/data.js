// Data export/import endpoints (/api/data): full per-user backup as a ZIP
// archive and restore from a previously exported archive.
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
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

    // Resolve helpers
    const [allHabits, actTypes] = await Promise.all([
      HabitDefinition.find({ $or: [{ userId }, { userId: null }] }),
      ActivityType.find({ userId })
    ]);
    const habitById  = new Map(allHabits.map(h => [h._id.toString(), h]));
    const actTypeById = new Map(actTypes.map(t => [t._id.toString(), t]));

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

    // activities.csv
    const actLogs = await ActivityLog.find({ userId }).sort({ date: 1 });
    const actCsv = [
      csvRow(['date', 'activity_type', 'duration', 'distance', 'notes', 'custom_values']),
      ...actLogs.map(a => csvRow([
        a.date.toISOString().slice(0, 10),
        a.activityType,
        a.duration ?? '',
        a.distance ?? '',
        a.notes ?? '',
        a.customValues && Object.keys(a.customValues).length ? JSON.stringify(a.customValues) : ''
      ]))
    ].join('\n');

    // settings.json
    const [userDoc, habitSettingsDoc] = await Promise.all([
      User.findById(userId),
      UserHabitSettings.findOne({ userId }).populate('selectedHabitIds', 'name'),
    ]);
    const habitSettingsResolved = {};
    for (const [idStr, val] of Object.entries(habitSettingsDoc?.habitSettings || {})) {
      const habit = habitById.get(idStr);
      if (habit) habitSettingsResolved[habit.name] = val;
    }
    const settingsJson = JSON.stringify({
      weightUnit: userDoc.weightUnit,
      selectedHabits: (habitSettingsDoc?.selectedHabitIds || []).map(h => h.name),
      habitSettings: habitSettingsResolved
    }, null, 2);

    // activity_plans.json
    const actPlans = await ActivityPlan.find({ userId }).sort({ scheduledDate: 1 });
    const actPlansJson = JSON.stringify(actPlans.map(p => ({
      date: p.scheduledDate.toISOString().slice(0, 10),
      activity_type: p.activityType,
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

    // goals.json
    const goals = await Goal.find({ userId }).sort({ createdAt: 1 });
    const goalsJson = JSON.stringify(goals.map(g => {
      const obj = g.toObject();
      // Resolve targetRef ObjectId → human-readable name
      const refStr = String(obj.targetRef ?? '');
      if (obj.targetRefModel === 'ActivityType') {
        obj.targetRefName = actTypeById.get(refStr)?.label ?? refStr;
      } else if (obj.targetRefModel === 'HabitDefinition') {
        obj.targetRefName = habitById.get(refStr)?.name ?? refStr;
      } else {
        obj.targetRefName = refStr; // legacy string label
      }
      delete obj._id;
      delete obj.userId;
      delete obj.__v;
      delete obj.targetRef;
      return obj;
    }), null, 2);

    // Build ZIP
    const zip = new AdmZip();
    zip.addFile('weight.csv',          Buffer.from(weightCsv,     'utf8'));
    zip.addFile('habits.csv',          Buffer.from(habitCsv,      'utf8'));
    zip.addFile('activities.csv',      Buffer.from(actCsv,        'utf8'));
    zip.addFile('settings.json',       Buffer.from(settingsJson,  'utf8'));
    zip.addFile('activity_plans.json', Buffer.from(actPlansJson,  'utf8'));
    zip.addFile('habit_plans.json',    Buffer.from(habitPlansJson,'utf8'));
    zip.addFile('goals.json',          Buffer.from(goalsJson,     'utf8'));

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

    // Zip-bomb guard: the upload itself is capped at 10 MB by multer, but a
    // crafted archive can decompress to orders of magnitude more. Check the
    // declared uncompressed sizes BEFORE reading any entry.
    const entries = zip.getEntries();
    if (entries.length > 64) {
      return res.status(400).json({ error: 'Archiv enthält zu viele Dateien.' });
    }
    const totalUncompressed = entries.reduce((sum, e) => sum + (e.header.size || 0), 0);
    if (totalUncompressed > 50 * 1024 * 1024) {
      return res.status(400).json({ error: 'Archiv ist entpackt zu groß.' });
    }

    const results = { weight: 0, habits: 0, activities: 0, plans: 0, goals: 0, settings: false, errors: [] };

    // Helper: resolve or create habit/activity type by name
    async function resolveHabit(name, unit) {
      let h = await HabitDefinition.findOne({ name, $or: [{ userId }, { userId: null }] });
      if (!h) h = await HabitDefinition.create({ userId, name, unitSymbol: unit || '', type: 'amount' });
      return h;
    }
    async function resolveActivityType(label) {
      let t = await ActivityType.findOne({ userId, label });
      if (!t) t = await ActivityType.create({ userId, label });
      return t;
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
            { $set: { userId, habitId: habit._id, date, value } },
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
              userId, activityType: row.activity_type, activityTypeRef: actType._id, date,
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

          if (Array.isArray(s.selectedHabits) && s.selectedHabits.length > 0) {
            const ids = [];
            for (const name of s.selectedHabits) {
              const h = await resolveHabit(name, '');
              ids.push(h._id);
            }
            habitSettingsUpdate.selectedHabitIds = ids;
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
                  unitSymbol: habit.unitSymbol, scheduledDate: date,
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

    // goals.json
    const goalsEntry = zip.getEntry('goals.json');
    if (goalsEntry) {
      const goals = parseJson(goalsEntry);
      if (Array.isArray(goals)) {
        for (const g of goals) {
          try {
            if (!g.name || !g.targetRefModel || !g.targetRefName) continue;

            // Resolve targetRef name → ObjectId
            let targetRef = g.targetRefName;
            const refModel = g.targetRefModel;
            if (refModel === 'ActivityType') {
              const t = await resolveActivityType(g.targetRefName);
              targetRef = t._id;
            } else if (refModel === 'HabitDefinition') {
              const h = await resolveHabit(g.targetRefName, '');
              targetRef = h._id;
            }

            const { targetRefName, ...goalData } = g;

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
