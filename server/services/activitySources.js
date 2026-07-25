// User-controlled priority of ACTIVITY sources for the cross-source dedup.
//
// Activities are de-duplicated (not summed) — one workout arriving from several
// platforms is collapsed to a single canonical record by services/activityMerge.
// That already prefers Strava (richer) over Health Connect, then falls back to
// richness. This lets the user impose their own order AMONG Health Connect
// sources (e.g. "trust my Garmin sessions over my phone's"), fed to
// reconcileUser as its `originPriorities` map.
const HealthActivity = require('../models/HealthActivity');
const User = require('../models/User');
const { appLabel } = require('./metricSources');

// { dataOrigin: priorityIndex } from the user's saved order (lower = higher
// priority). Unlisted origins are simply absent → reconcileUser defaults them
// low, so any listed source outranks them.
async function priorityMap(userId) {
  const user = await User.findById(userId).select('activityOriginPriority').lean();
  const order = (user && user.activityOriginPriority) || [];
  const map = {};
  order.forEach((origin, i) => { if (origin) map[origin] = i; });
  return map;
}

// The distinct activity source apps the user has actually synced, with labels.
async function detectedSources(userId) {
  const origins = await HealthActivity.distinct('dataOrigin', { userId });
  return origins.filter(Boolean).map(o => ({ origin: o, appLabel: appLabel(o) }));
}

module.exports = { priorityMap, detectedSources };
