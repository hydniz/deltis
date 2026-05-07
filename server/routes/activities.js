const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ActivityLog = require('../models/ActivityLog');
const ActivityType = require('../models/ActivityType');

// Berechnet den historischen Namen, falls sich der Aktivitätstyp-Name seit der Erfassung geändert hat.
function enrichActivity(activityObj) {
  const ref = activityObj.activityTypeRef;
  const version = activityObj.activityTypeVersion;
  if (ref && version && ref.version !== version) {
    const historical = (ref.nameHistory || []).find(h => h.version === version);
    if (historical) activityObj.historicalLabel = historical.name;
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

router.post('/', auth, async (req, res) => {
  try {
    const { activityType, activityTypeRef, date, duration, distance, notes, customValues } = req.body;

    let activityTypeVersion;
    if (activityTypeRef) {
      const typeDoc = await ActivityType.findById(activityTypeRef).select('version');
      activityTypeVersion = typeDoc?.version;
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
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const activity = await ActivityLog.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true }
    );
    if (!activity) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(activity);
  } catch (err) {
    res.status(400).json({ error: err.message });
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
