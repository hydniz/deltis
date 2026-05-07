const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ActivityPlan = require('../models/ActivityPlan');
const ActivityType = require('../models/ActivityType');

function enrichPlan(planObj) {
  const ref = planObj.activityTypeRef;
  const version = planObj.activityTypeVersion;
  if (ref && version && ref.version !== version) {
    const historical = (ref.nameHistory || []).find(h => h.version === version);
    if (historical) planObj.historicalLabel = historical.name;
  }
  if (ref) delete ref.nameHistory;
  return planObj;
}

router.get('/', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = { userId: req.user._id };

    if (startDate || endDate) {
      query.scheduledDate = {};
      if (startDate) query.scheduledDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.scheduledDate.$lte = end;
      }
    }

    const plans = await ActivityPlan.find(query)
      .populate('activityTypeRef', 'label version nameHistory showDistance showDuration customFields')
      .sort({ scheduledDate: 1 });

    res.json(plans.map(p => enrichPlan(p.toObject())));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { activityType, activityTypeRef, scheduledDate, duration, distance, notes } = req.body;

    let activityTypeVersion;
    if (activityTypeRef) {
      const typeDoc = await ActivityType.findById(activityTypeRef).select('version');
      activityTypeVersion = typeDoc?.version;
    }

    const plan = await ActivityPlan.create({
      userId: req.user._id,
      activityType,
      activityTypeRef: activityTypeRef || undefined,
      activityTypeVersion,
      scheduledDate: new Date(scheduledDate),
      duration,
      distance,
      notes
    });
    res.status(201).json(plan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const plan = await ActivityPlan.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true }
    );
    if (!plan) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(plan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await ActivityPlan.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
