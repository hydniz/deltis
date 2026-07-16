// Activity log endpoints (/api/activities): list, create, update, delete.
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ActivityLog = require('../models/ActivityLog');
const ActivityType = require('../models/ActivityType');

// Enriches an ActivityLog with historical name and field definitions
// if the activity type has changed since the entry was recorded.
function enrichActivity(activityObj) {
  const ref = activityObj.activityTypeRef;
  const version = activityObj.activityTypeVersion;
  if (ref && version && ref.version !== version) {
    const historical = (ref.nameHistory || []).find(h => h.version === version);
    if (historical) {
      if (historical.name !== ref.label) activityObj.historicalLabel = historical.name;
      if (historical.customFields?.length) activityObj.historicalCustomFields = historical.customFields;
    }
  }
  if (ref) delete ref.nameHistory;
  return activityObj;
}

router.get('/', auth, async (req, res) => {
  try {
    const { startDate, endDate, typeRef, type, limit = 50, skip = 0 } = req.query;
    const query = { userId: req.user._id };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    if (typeRef) {
      query.activityTypeRef = typeRef;
    } else if (type) {
      query.activityType = type;
    }

    const [activities, total] = await Promise.all([
      ActivityLog.find(query)
        .populate('activityTypeRef', 'label version nameHistory showDistance showDuration customFields')
        .sort({ date: -1 })
        .limit(+limit)
        .skip(+skip),
      ActivityLog.countDocuments(query)
    ]);

    const enriched = activities.map(a => enrichActivity(a.toObject()));
    res.json({ activities: enriched, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resolves an activityTypeRef ONLY when it belongs to the requesting user —
// referencing another user's type is rejected (cross-tenant reference).
async function resolveOwnActivityType(refId, userId) {
  const typeDoc = await ActivityType.findOne({ _id: refId, userId }).select('version');
  if (!typeDoc) {
    const err = new Error('Aktivitätstyp nicht gefunden');
    err.status = 404;
    throw err;
  }
  return typeDoc;
}

router.post('/', auth, async (req, res) => {
  try {
    const { activityType, activityTypeRef, date, duration, distance, notes, customValues } = req.body;

    let activityTypeVersion;
    if (activityTypeRef) {
      const typeDoc = await resolveOwnActivityType(activityTypeRef, req.user._id);
      activityTypeVersion = typeDoc.version;
    }

    const activity = await ActivityLog.create({
      userId: req.user._id,
      activityType,
      activityTypeRef: activityTypeRef || undefined,
      activityTypeVersion,
      date: new Date(date),
      duration,
      distance,
      notes,
      customValues: customValues || {}
    });
    res.status(201).json(activity);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    // Field whitelist: userId/_id and version bookkeeping stay server-owned.
    const { activityType, activityTypeRef, date, duration, distance, notes, customValues } = req.body;
    const update = {};
    if (activityType !== undefined) update.activityType = activityType;
    if (date !== undefined) update.date = new Date(date);
    if (duration !== undefined) update.duration = duration;
    if (distance !== undefined) update.distance = distance;
    if (notes !== undefined) update.notes = notes;
    if (customValues !== undefined) update.customValues = customValues || {};
    const unset = {};
    if (activityTypeRef !== undefined) {
      if (activityTypeRef) {
        const typeDoc = await resolveOwnActivityType(activityTypeRef, req.user._id);
        update.activityTypeRef = activityTypeRef;
        update.activityTypeVersion = typeDoc.version;
      } else {
        unset.activityTypeRef = 1;
        unset.activityTypeVersion = 1;
      }
    }

    const activity = await ActivityLog.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: update, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { new: true }
    );
    if (!activity) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(activity);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await ActivityLog.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!result) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
