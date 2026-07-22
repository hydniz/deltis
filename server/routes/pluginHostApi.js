// Plugin Host API (/api/plugin-host/v1): the ONLY interface a running
// plugin container has into Deltis — it never sees MongoDB, the filesystem
// or any other internal module directly. Every route is capability-gated
// against the calling plugin's granted capabilities (middleware/pluginAuth.js)
// and additionally user-scoped: a plugin can act on a specific user's data
// only once that user has individually granted it (PluginUserGrant) — an
// admin installing a plugin instance-wide does not by itself expose any
// user's personal data.
//
// This phase wires up every data capability (habits, activities, goals,
// planner, weight, user:read) plus notifications:send (stubbed — no
// push-delivery backend exists yet). goals:write is deliberately narrow —
// it only creates the same "common case" single-condition goal the web/
// Android clients' basic create form supports, not the full meta-goal/
// Strava-criteria/multi-condition surface (see docs/plugins/MANIFEST.md
// "Known limitations"). The ui:*/background:* capabilities still have no
// Host API route yet — there is nothing to call for them until the
// sandboxed-UI and scheduling infrastructure exists.
const express = require('express');
const router = express.Router();
const pluginAuth = require('../middleware/pluginAuth');
const PluginUserGrant = require('../models/PluginUserGrant');
const HabitDefinition = require('../models/HabitDefinition');
const HabitLog = require('../models/HabitLog');
const ActivityLog = require('../models/ActivityLog');
const ActivityPlan = require('../models/ActivityPlan');
const Goal = require('../models/Goal');
const WeightLog = require('../models/WeightLog');
const User = require('../models/User');
const StravaConnection = require('../models/StravaConnection');
const StravaActivity = require('../models/StravaActivity');
const strava = require('../services/strava');

function requireCapability(capability) {
  return (req, res, next) => {
    if (!req.pluginInstall.capabilities.includes(capability)) {
      return res.status(403).json({ error: `Plugin hat keine Berechtigung "${capability}".` });
    }
    next();
  };
}

// Every data route acts on behalf of one specific end user. Mirrors how each
// user connects their own Strava account today: the admin installing a
// plugin only provisions it — it still can't touch anyone's data until that
// person grants it themselves.
async function requireUserGrant(req, res, next) {
  const userId = req.headers['x-plugin-user-id'];
  if (!userId) return res.status(400).json({ error: 'X-Plugin-User-Id fehlt.' });
  try {
    const grant = await PluginUserGrant.findOne({ pluginId: req.pluginInstall.pluginId, userId, enabled: true });
    if (!grant) return res.status(403).json({ error: 'Nutzer hat dieses Plugin nicht freigegeben.' });
    req.pluginUserId = userId;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

router.use(pluginAuth);

// Lists every user who has granted this plugin — the entry point for a
// background:cron-style plugin (like strava-integration's poll loop) that
// needs to act across all its users on a timer rather than being told about
// one user at a time. Doesn't need its own capability: it only ever reveals
// who has granted *this same* plugin, nothing about other plugins/users.
router.get('/granted-users', async (req, res) => {
  try {
    const grants = await PluginUserGrant.find({ pluginId: req.pluginInstall.pluginId, enabled: true }).select('userId');
    res.json(grants.map((g) => ({ userId: g.userId })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/habits', requireCapability('habits:read'), requireUserGrant, async (req, res) => {
  try {
    const habits = await HabitDefinition.find({ userId: req.pluginUserId, deletedAt: null });
    res.json(habits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/activities', requireCapability('activities:read'), requireUserGrant, async (req, res) => {
  try {
    const { startDate, endDate, limit } = req.query;
    const query = { userId: req.pluginUserId };
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    const activities = await ActivityLog.find(query)
      .sort({ date: -1 })
      .limit(Math.min(parseInt(limit, 10) || 100, 500));
    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/activities', requireCapability('activities:write'), requireUserGrant, async (req, res) => {
  try {
    const { activityType, date, duration, distance, notes, customValues } = req.body;
    if (!activityType || !date) return res.status(400).json({ error: 'activityType und date sind erforderlich.' });
    const activity = await ActivityLog.create({
      userId: req.pluginUserId,
      activityType,
      date: new Date(date),
      duration,
      distance,
      notes,
      customValues,
      source: `plugin:${req.pluginInstall.pluginId}`,
    });
    res.status(201).json(activity);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/habits', requireCapability('habits:write'), requireUserGrant, async (req, res) => {
  try {
    const { name, unitSymbol, type } = req.body;
    if (!name || !unitSymbol) return res.status(400).json({ error: 'name und unitSymbol sind erforderlich.' });
    const habit = await HabitDefinition.create({
      userId: req.pluginUserId, name, unitSymbol, type: type || 'amount',
    });
    res.status(201).json(habit);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/habits/logs', requireCapability('habits:write'), requireUserGrant, async (req, res) => {
  try {
    const { habitId, date, value } = req.body;
    if (!habitId || !date || value == null) return res.status(400).json({ error: 'habitId, date und value sind erforderlich.' });
    const habit = await HabitDefinition.findOne({ _id: habitId, userId: req.pluginUserId, deletedAt: null });
    if (!habit) return res.status(404).json({ error: 'Gewohnheit nicht gefunden.' });

    const log = await HabitLog.create({ userId: req.pluginUserId, habitId, habitVersion: habit.version, date: new Date(date), value });
    res.status(201).json(log);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/goals', requireCapability('goals:read'), requireUserGrant, async (req, res) => {
  try {
    const goals = await Goal.find({ userId: req.pluginUserId, isActive: true });
    res.json(goals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Creates the same "common case" goal the web/Android basic create form
// supports (single condition, periodic or long-term) — not the full
// meta-goal/Strava-criteria/multi-condition surface (see
// docs/plugins/MANIFEST.md "Known limitations").
router.post('/goals', requireCapability('goals:write'), requireUserGrant, async (req, res) => {
  try {
    const { name, type, targetRef, targetRefModel, condition, targetValue, unitSymbol, metric, intervalValue, intervalUnit } = req.body;
    if (!name || !type || !targetRef || !targetRefModel || !condition || targetValue == null) {
      return res.status(400).json({ error: 'name, type, targetRef, targetRefModel, condition und targetValue sind erforderlich.' });
    }
    const goal = await Goal.create({
      userId: req.pluginUserId, name, type, targetRef, targetRefModel, condition, targetValue, unitSymbol, metric,
      intervalValue, intervalUnit,
    });
    res.status(201).json(goal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/planner', requireCapability('planner:read'), requireUserGrant, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = { userId: req.pluginUserId };
    if (startDate || endDate) {
      query.scheduledDate = {};
      if (startDate) query.scheduledDate.$gte = new Date(startDate);
      if (endDate) query.scheduledDate.$lte = new Date(endDate);
    }
    const plans = await ActivityPlan.find(query).sort({ scheduledDate: 1 });
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/planner', requireCapability('planner:write'), requireUserGrant, async (req, res) => {
  try {
    const { activityType, scheduledDate, duration, distance, notes } = req.body;
    if (!activityType || !scheduledDate) return res.status(400).json({ error: 'activityType und scheduledDate sind erforderlich.' });
    const plan = await ActivityPlan.create({
      userId: req.pluginUserId, activityType, scheduledDate: new Date(scheduledDate), duration, distance, notes,
      source: 'plugin',
    });
    res.status(201).json(plan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/weight', requireCapability('weight:read'), requireUserGrant, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const logs = await WeightLog.find({ userId: req.pluginUserId }).sort({ date: -1 }).limit(limit);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/weight', requireCapability('weight:write'), requireUserGrant, async (req, res) => {
  try {
    const { date, weight, unit } = req.body;
    if (!date || weight == null) return res.status(400).json({ error: 'date und weight sind erforderlich.' });
    const log = await WeightLog.create({ userId: req.pluginUserId, date: new Date(date), weight, unit: unit || 'kg' });
    res.status(201).json(log);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/user', requireCapability('user:read'), requireUserGrant, async (req, res) => {
  try {
    const user = await User.findById(req.pluginUserId);
    if (!user) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });
    res.json({ id: user._id, name: user.name, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Notification delivery is a stub in this phase: the request is validated
// and accepted, but not yet forwarded to any device — no push backend
// exists for the web or Android clients yet.
router.post('/notifications', requireCapability('notifications:send'), requireUserGrant, async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'title ist erforderlich.' });
  res.status(202).json({ accepted: true, delivered: false, note: 'Zustellung noch nicht implementiert.' });
});

// ── Strava sync (capability: strava:sync) ──────────────────────────────────
// StravaConnection/StravaActivity stay core-owned collections (the goal
// criteria engine in routes/goals.js reads them directly) — the plugin only
// ever reaches them through these routes, never via the generic activities:*
// capability. Tokens never leave core: this hands the plugin a short-lived,
// already-refreshed access token, never the long-lived refresh token.

router.get('/strava/connection', requireCapability('strava:sync'), requireUserGrant, async (req, res) => {
  try {
    const connection = await StravaConnection.findOne({ userId: req.pluginUserId }).select('+accessToken +refreshToken');
    if (!connection) return res.json({ connected: false });

    const accessToken = await strava.ensureFreshToken(connection);
    res.json({
      connected: true,
      athleteId: connection.athleteId,
      accessToken,
      scope: connection.scope,
      syncRequestedAt: connection.syncRequestedAt,
      lastSyncAt: connection.lastSyncAt,
      initialSyncDone: connection.initialSyncDone,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/strava/sync-result', requireCapability('strava:sync'), requireUserGrant, async (req, res) => {
  try {
    const { synced, failed, error } = req.body;
    const connection = await StravaConnection.findOne({ userId: req.pluginUserId });
    if (!connection) return res.status(404).json({ error: 'Keine Strava-Verbindung.' });

    connection.lastSyncAt = new Date();
    connection.lastSyncError = error || null;
    connection.lastSyncSyncedCount = Number(synced) || 0;
    connection.lastSyncFailedCount = Number(failed) || 0;
    if (!connection.initialSyncDone) connection.initialSyncDone = true;
    await connection.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Maps a detailed Strava activity onto the promoted top-level fields —
// mirrors the mapping that used to live in services/strava.js.
function mapStravaActivityFields(detail) {
  return {
    name: detail.name || '',
    sportType: detail.sport_type || detail.type || '',
    type: detail.type || '',
    startDate: detail.start_date ? new Date(detail.start_date) : new Date(),
    startDateLocal: detail.start_date_local ? new Date(detail.start_date_local) : undefined,
    timezone: detail.timezone,
    movingTime: detail.moving_time ?? 0,
    elapsedTime: detail.elapsed_time ?? 0,
    distance: detail.distance ?? 0,
    totalElevationGain: detail.total_elevation_gain ?? 0,
    averageSpeed: detail.average_speed,
    maxSpeed: detail.max_speed,
    averageHeartrate: detail.average_heartrate,
    maxHeartrate: detail.max_heartrate,
    averageCadence: detail.average_cadence,
    averageWatts: detail.average_watts,
    kilojoules: detail.kilojoules,
    calories: detail.calories,
    sufferScore: detail.suffer_score,
    hasHeartrate: Boolean(detail.has_heartrate),
    isTrainer: Boolean(detail.trainer),
    isCommute: Boolean(detail.commute),
    isManual: Boolean(detail.manual),
  };
}

router.post('/strava/activities', requireCapability('strava:sync'), requireUserGrant, async (req, res) => {
  try {
    const { detail, zones, streams } = req.body;
    if (!detail?.id) return res.status(400).json({ error: 'detail.id ist erforderlich.' });

    const connection = await StravaConnection.findOne({ userId: req.pluginUserId });
    const athleteId = connection?.athleteId;

    const activity = await StravaActivity.findOneAndUpdate(
      { userId: req.pluginUserId, stravaId: detail.id },
      {
        $set: {
          athleteId,
          ...mapStravaActivityFields(detail),
          detail,
          zones: zones ?? null,
          streams: streams ?? null,
          syncedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json(activity);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/strava/activities/:stravaId', requireCapability('strava:sync'), requireUserGrant, async (req, res) => {
  try {
    await StravaActivity.deleteOne({ userId: req.pluginUserId, stravaId: req.params.stravaId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
