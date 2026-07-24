// Criteria engine for Health Connect activities.
//
// Structurally parallel to services/stravaCriteria.js so a criteria map can
// express "Zone 2 in Strava OR Health Connect" with the same rule vocabulary.
// The tree machinery lives in services/criteriaEngine.js.
//
// Health Connect carries no heart-rate ZONES, so `hrZonePercent` has no
// counterpart here; `hrPercentInRange` works because HealthActivity stores its
// samples in the same stream shape Strava uses, letting the existing helper in
// stravaCriteria evaluate them unchanged.
//
// Rule kinds:
//   sportType        – { values: ['Run','Ride',…] } normalized family or raw type
//   metricRange      – { metric, min?, max? } numeric field within bounds
//   hrPercentInRange – { minHr, maxHr, minPercent } ≥ minPercent % of the time
//   group            – { operator, rules } nested sub-group
const { createEngine } = require('./criteriaEngine');
const { heartratePercentInRange } = require('./stravaCriteria');
const { healthFamily } = require('./activityMerge');

// Numeric metrics exposed to criteria, in the same user-facing units the
// Strava engine uses so rules read identically across integrations.
const METRICS = {
  movingTime:         { label: 'Dauer (in Bewegung)', unit: 'min',  get: a => a.movingTime != null ? a.movingTime / 60 : null },
  elapsedTime:        { label: 'Dauer (gesamt)',      unit: 'min',  get: a => a.elapsedTime != null ? a.elapsedTime / 60 : null },
  distance:           { label: 'Distanz',             unit: 'km',   get: a => a.distance != null ? a.distance / 1000 : null },
  totalElevationGain: { label: 'Höhenmeter',          unit: 'm',    get: a => a.totalElevationGain ?? null },
  averageSpeed:       { label: 'Ø Geschwindigkeit',   unit: 'km/h', get: a => a.averageSpeed != null ? a.averageSpeed * 3.6 : null },
  averageHeartrate:   { label: 'Ø Herzfrequenz',      unit: 'bpm',  get: a => a.averageHeartrate ?? null },
  maxHeartrate:       { label: 'Max. Herzfrequenz',   unit: 'bpm',  get: a => a.maxHeartrate ?? null },
  calories:           { label: 'Kalorien',            unit: 'kcal', get: a => a.calories ?? null },
  steps:              { label: 'Schritte',            unit: '',     get: a => a.steps ?? null },
  averageWatts:       { label: 'Ø Leistung',          unit: 'W',    get: a => a.averageWatts ?? null },
  maxWatts:           { label: 'Max. Leistung',       unit: 'W',    get: a => a.maxWatts ?? null },
  averageCadence:     { label: 'Ø Trittfrequenz',     unit: '/min', get: a => a.averageCadence ?? null },
};

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

const BASE_RULE_TYPES = {
  sportType: {
    validate(rule, path, errors) {
      if (!Array.isArray(rule.values) || rule.values.length === 0 ||
          !rule.values.every(v => typeof v === 'string' && v.trim())) {
        errors.push(`${path}: "values" muss eine nicht-leere Liste von Sportarten sein`);
      }
    },
    // Matches either the raw Health Connect type or the normalized family, so
    // a rule written as ['Run'] catches EXERCISE_TYPE_RUNNING_TREADMILL too.
    evaluate(activity, rule) {
      const wanted = rule.values.map(v => v.toLowerCase());
      const family = healthFamily(activity);
      const raw = String(activity.exerciseType || '').toLowerCase();
      const sport = String(activity.sportType || '').toLowerCase();
      return wanted.some(v =>
        v === family || v === raw || v === sport ||
        raw.includes(v) || sport.includes(v));
    },
  },

  metricRange: {
    validate(rule, path, errors) {
      if (!METRICS[rule.metric]) {
        errors.push(`${path}: unbekannte Metrik "${rule.metric}" (verfügbar: ${Object.keys(METRICS).join(', ')})`);
      }
      if (rule.min == null && rule.max == null) {
        errors.push(`${path}: mindestens "min" oder "max" angeben`);
      }
      if (rule.min != null && !isFiniteNumber(rule.min)) errors.push(`${path}: "min" muss eine Zahl sein`);
      if (rule.max != null && !isFiniteNumber(rule.max)) errors.push(`${path}: "max" muss eine Zahl sein`);
      if (isFiniteNumber(rule.min) && isFiniteNumber(rule.max) && rule.min > rule.max) {
        errors.push(`${path}: "min" darf nicht größer als "max" sein`);
      }
    },
    evaluate(activity, rule) {
      const value = METRICS[rule.metric].get(activity);
      if (value == null) return false;
      if (rule.min != null && value < rule.min) return false;
      if (rule.max != null && value > rule.max) return false;
      return true;
    },
  },

  hrPercentInRange: {
    validate(rule, path, errors) {
      if (!isFiniteNumber(rule.minHr) || !isFiniteNumber(rule.maxHr) || rule.minHr > rule.maxHr) {
        errors.push(`${path}: gültiger Pulsbereich "minHr"–"maxHr" erforderlich`);
      }
      if (!isFiniteNumber(rule.minPercent) || rule.minPercent <= 0 || rule.minPercent > 100) {
        errors.push(`${path}: "minPercent" muss zwischen 0 und 100 liegen`);
      }
    },
    evaluate(activity, rule) {
      const percent = heartratePercentInRange(activity, rule.minHr, rule.maxHr);
      return percent != null && percent >= rule.minPercent;
    },
  },
};

const { RULE_TYPES, validateCriteria, evaluateActivity } = createEngine(BASE_RULE_TYPES);

module.exports = { METRICS, RULE_TYPES, validateCriteria, evaluateActivity };
