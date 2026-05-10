const express = require('express');
const router = express.Router();
const AdmZip = require('adm-zip');
const multer = require('multer');
const auth = require('../middleware/auth');
const WeightLog = require('../models/WeightLog');
const HabitLog = require('../models/HabitLog');
const HabitDefinition = require('../models/HabitDefinition');
const ActivityLog = require('../models/ActivityLog');
const ActivityType = require('../models/ActivityType');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip files are accepted'));
    }
  }
});

// ── CSV helpers ──────────────────────────────────────────────────────────────

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
  return lines.slice(1)
    .filter(l => l.trim())
    .map(line => {
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

// ── Export ───────────────────────────────────────────────────────────────────

router.get('/export', auth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Weight logs
    const weights = await WeightLog.find({ userId }).sort({ date: 1 });
    const weightCsv = [
      csvRow(['date', 'weight', 'unit']),
      ...weights.map(w => csvRow([
        w.date.toISOString().slice(0, 10),
        w.weight,
        w.unit
      ]))
    ].join('\n');

    // Habit logs (resolve habit name via populate)
    const habitLogs = await HabitLog.find({ userId })
      .populate('habitId', 'name unitSymbol')
      .sort({ date: 1 });
    const habitCsv = [
      csvRow(['date', 'habit_name', 'unit', 'value']),
      ...habitLogs.map(h => csvRow([
        h.date.toISOString().slice(0, 10),
        h.habitId?.name ?? '',
        h.habitId?.unitSymbol ?? '',
        h.value
      ]))
    ].join('\n');

    // Activity logs
    const actLogs = await ActivityLog.find({ userId }).sort({ date: 1 });
    const actCsv = [
      csvRow(['date', 'activity_type', 'duration', 'distance', 'notes', 'custom_values']),
      ...actLogs.map(a => csvRow([
        a.date.toISOString().slice(0, 10),
        a.activityType,
        a.duration ?? '',
        a.distance ?? '',
        a.notes ?? '',
        a.customValues && Object.keys(a.customValues).length
          ? JSON.stringify(a.customValues)
          : ''
      ]))
    ].join('\n');

    const zip = new AdmZip();
    zip.addFile('weight.csv', Buffer.from(weightCsv, 'utf8'));
    zip.addFile('habits.csv', Buffer.from(habitCsv, 'utf8'));
    zip.addFile('activities.csv', Buffer.from(actCsv, 'utf8'));
    const zipBuffer = zip.toBuffer();

    const filename = `habit-tracker-export-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(zipBuffer);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── Import ───────────────────────────────────────────────────────────────────

router.post('/import', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });

    const userId = req.user._id;
    let zip;
    try {
      zip = new AdmZip(req.file.buffer);
    } catch {
      return res.status(400).json({ error: 'Ungültige ZIP-Datei' });
    }

    const results = { weight: 0, habits: 0, activities: 0, errors: [] };

    // ── Weight ────────────────────────────────────────────────────────────
    const weightEntry = zip.getEntry('weight.csv');
    if (weightEntry) {
      const rows = parseCsv(weightEntry.getData().toString('utf8'));
      for (const row of rows) {
        try {
          const date = new Date(row.date);
          if (isNaN(date)) continue;
          const weight = parseFloat(row.weight);
          if (isNaN(weight)) continue;
          await WeightLog.findOneAndUpdate(
            { userId, date: { $gte: startOfDay(date), $lte: endOfDay(date) } },
            { $set: { userId, date, weight, unit: row.unit || 'kg' } },
            { upsert: true, new: true }
          );
          results.weight++;
        } catch (e) {
          results.errors.push(`weight row (${row.date}): ${e.message}`);
        }
      }
    }

    // ── Habits ────────────────────────────────────────────────────────────
    const habitsEntry = zip.getEntry('habits.csv');
    if (habitsEntry) {
      const rows = parseCsv(habitsEntry.getData().toString('utf8'));
      for (const row of rows) {
        try {
          const date = new Date(row.date);
          if (isNaN(date) || !row.habit_name) continue;
          const value = parseFloat(row.value);
          if (isNaN(value)) continue;

          let habit = await HabitDefinition.findOne({
            name: row.habit_name,
            $or: [{ userId }, { userId: null }]
          });
          if (!habit) {
            habit = await HabitDefinition.create({
              userId,
              name: row.habit_name,
              unitSymbol: row.unit || '',
              type: 'amount'
            });
          }

          await HabitLog.findOneAndUpdate(
            { userId, habitId: habit._id, date: { $gte: startOfDay(date), $lte: endOfDay(date) } },
            { $set: { userId, habitId: habit._id, date, value } },
            { upsert: true, new: true }
          );
          results.habits++;
        } catch (e) {
          results.errors.push(`habit row (${row.date} / ${row.habit_name}): ${e.message}`);
        }
      }
    }

    // ── Activities ────────────────────────────────────────────────────────
    const actEntry = zip.getEntry('activities.csv');
    if (actEntry) {
      const rows = parseCsv(actEntry.getData().toString('utf8'));
      for (const row of rows) {
        try {
          const date = new Date(row.date);
          if (isNaN(date) || !row.activity_type) continue;

          let actType = await ActivityType.findOne({ userId, label: row.activity_type });
          if (!actType) {
            actType = await ActivityType.create({ userId, label: row.activity_type });
          }

          let customValues = {};
          if (row.custom_values) {
            try { customValues = JSON.parse(row.custom_values); } catch { /* ignore */ }
          }

          const duration = row.duration ? parseFloat(row.duration) : undefined;
          const distance = row.distance ? parseFloat(row.distance) : undefined;

          // Match by type + day + duration + distance so that two activities of the
          // same type on the same day are kept separate if their values differ,
          // but a re-import of identical data never creates duplicates.
          const actFilter = {
            userId,
            activityType: row.activity_type,
            date: { $gte: startOfDay(date), $lte: endOfDay(date) },
            ...(duration !== undefined ? { duration } : { duration: { $exists: false } }),
            ...(distance !== undefined ? { distance } : { distance: { $exists: false } }),
          };

          await ActivityLog.findOneAndUpdate(
            actFilter,
            {
              $set: {
                userId,
                activityType: row.activity_type,
                activityTypeRef: actType._id,
                date,
                ...(duration !== undefined ? { duration } : {}),
                ...(distance !== undefined ? { distance } : {}),
                ...(row.notes ? { notes: row.notes } : {}),
                customValues
              }
            },
            { upsert: true, new: true }
          );
          results.activities++;
        } catch (e) {
          results.errors.push(`activity row (${row.date} / ${row.activity_type}): ${e.message}`);
        }
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
