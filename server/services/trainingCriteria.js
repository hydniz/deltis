// Integration registry for training criteria.
//
// A criteria MAP bundles one criteria tree per integration:
//   { strava: { operator, rules }, garmin: { ... } }
// An activity fulfils the map when it matches the tree of the integration it
// came from — so "Zone 2 in Strava ODER Garmin" is simply a map with both
// keys. Adding an integration = adding one INTEGRATIONS entry; models, goals
// and planner pass the map through untouched.
const stravaCriteria = require('./stravaCriteria');

// Normalized match shape returned by every integration:
//   { integration, id, name, sportType, date (local), movingTime (s),
//     distance (m), averageHeartrate }
const INTEGRATIONS = {
  strava: {
    label: 'Strava',
    validate: tree => stravaCriteria.validateCriteria(tree),
    async findMatches(userId, tree, start, end) {
      const StravaActivity = require('../models/StravaActivity');
      const activities = await StravaActivity.find({
        userId,
        startDate: { $gte: start, $lte: end },
      }).select('-detail').lean();

      const matching = tree
        ? activities.filter(a => stravaCriteria.evaluateActivity(a, tree))
        : activities;

      return matching.map(a => ({
        integration: 'strava',
        id: String(a._id),
        name: a.name || a.sportType || 'Aktivität',
        sportType: a.sportType,
        date: a.startDateLocal || a.startDate,
        movingTime: a.movingTime || 0,
        distance: a.distance || 0,
        averageHeartrate: a.averageHeartrate,
      }));
    },
  },
};

function knownIntegrations() {
  return Object.keys(INTEGRATIONS);
}

// Validates a criteria map; returns { valid, errors }. `null` trees are
// allowed ("every activity of this integration counts").
function validateCriteriaMap(map) {
  const errors = [];
  if (map == null) return { valid: true, errors };
  if (typeof map !== 'object' || Array.isArray(map)) {
    return { valid: false, errors: ['Kriterien müssen als Objekt pro Integration übergeben werden.'] };
  }
  for (const [integration, tree] of Object.entries(map)) {
    const impl = INTEGRATIONS[integration];
    if (!impl) {
      errors.push(`Unbekannte Integration "${integration}" (verfügbar: ${knownIntegrations().join(', ')})`);
      continue;
    }
    if (tree == null) continue;
    const result = impl.validate(tree);
    if (!result.valid) errors.push(...result.errors.map(e => `${integration}: ${e}`));
  }
  return { valid: errors.length === 0, errors };
}

// Union of matches across all integrations in the map, sorted by date.
// Unknown integrations in stored data are skipped (forward compatibility).
async function findMatches(userId, map, start, end) {
  if (!map || typeof map !== 'object') return [];
  const all = [];
  for (const [integration, tree] of Object.entries(map)) {
    const impl = INTEGRATIONS[integration];
    if (!impl) continue;
    all.push(...await impl.findMatches(userId, tree, start, end));
  }
  return all.sort((a, b) => new Date(a.date) - new Date(b.date));
}

// Matches on one calendar day (local wall time of the athlete). The stored
// UTC start times can drift up to a day around the local date, so the query
// window carries a buffer and the local date decides.
async function findMatchesOnDay(userId, map, dayStr) {
  const dayStart = new Date(`${dayStr}T00:00:00.000Z`);
  const start = new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);
  const end = new Date(dayStart.getTime() + 2 * 24 * 60 * 60 * 1000);
  const matches = await findMatches(userId, map, start, end);
  return matches.filter(m => new Date(m.date).toISOString().slice(0, 10) === dayStr);
}

module.exports = {
  INTEGRATIONS,
  knownIntegrations,
  validateCriteriaMap,
  findMatches,
  findMatchesOnDay,
};
