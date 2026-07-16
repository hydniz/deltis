// Criteria engine for Strava-based goals.
//
// A criteria document is a rule group:
//   { operator: 'AND'|'OR', rules: [rule, …] }
// and every rule is { kind: '<type>', …params }. Nested groups are rules of
// kind 'group', so arbitrarily complex expressions are possible.
//
// Adding a new rule type = adding one entry to RULE_TYPES below (validate +
// evaluate); storage (Mixed field on Goal) and the API pass criteria through
// untouched.
//
// Rule kinds:
//   sportType        – { values: ['Run','Ride',…] } activity sport_type/type is one of
//   metricRange      – { metric, min?, max? } numeric field within bounds (user-facing units)
//   hrPercentInRange – { minHr, maxHr, minPercent } ≥ minPercent % of the time
//                      the heart rate was within [minHr, maxHr] (uses HR stream)
//   hrZonePercent    – { zone: 1–5, minPercent } ≥ minPercent % of time in the
//                      Strava heart-rate zone (uses activity zones)
//   group            – { operator, rules } nested sub-group

const MAX_DEPTH = 5;

// Numeric activity metrics exposed to criteria, converted to the same
// user-facing units the UI shows (minutes, km, km/h, …).
const METRICS = {
  movingTime:         { label: 'Dauer (in Bewegung)', unit: 'min',  get: a => a.movingTime != null ? a.movingTime / 60 : null },
  elapsedTime:        { label: 'Dauer (gesamt)',      unit: 'min',  get: a => a.elapsedTime != null ? a.elapsedTime / 60 : null },
  distance:           { label: 'Distanz',             unit: 'km',   get: a => a.distance != null ? a.distance / 1000 : null },
  totalElevationGain: { label: 'Höhenmeter',          unit: 'm',    get: a => a.totalElevationGain ?? null },
  averageSpeed:       { label: 'Ø Geschwindigkeit',   unit: 'km/h', get: a => a.averageSpeed != null ? a.averageSpeed * 3.6 : null },
  averageHeartrate:   { label: 'Ø Herzfrequenz',      unit: 'bpm',  get: a => a.averageHeartrate ?? null },
  maxHeartrate:       { label: 'Max. Herzfrequenz',   unit: 'bpm',  get: a => a.maxHeartrate ?? null },
  averageWatts:       { label: 'Ø Leistung',          unit: 'W',    get: a => a.averageWatts ?? null },
  calories:           { label: 'Kalorien',            unit: 'kcal', get: a => a.calories ?? null },
  sufferScore:        { label: 'Relative Anstrengung', unit: '',    get: a => a.sufferScore ?? null },
};

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// Share of total recorded time in which the heart rate was within
// [minHr, maxHr], computed from the heartrate + time streams. Sample weights
// are the gaps in the time stream, capped so recording pauses don't dominate.
const MAX_SAMPLE_GAP_SECONDS = 60;

function heartratePercentInRange(activity, minHr, maxHr) {
  const hr = activity?.streams?.heartrate?.data;
  const time = activity?.streams?.time?.data;
  if (!Array.isArray(hr) || hr.length === 0) return null;

  let total = 0;
  let inRange = 0;
  for (let i = 0; i < hr.length; i++) {
    let dt = 1;
    if (Array.isArray(time) && time.length === hr.length && i > 0) {
      dt = Math.min(Math.max(time[i] - time[i - 1], 0), MAX_SAMPLE_GAP_SECONDS);
    }
    total += dt;
    if (hr[i] >= minHr && hr[i] <= maxHr) inRange += dt;
  }
  if (total === 0) return null;
  return (inRange / total) * 100;
}

// Share of total time in the given Strava heart-rate zone (1–5), from the
// zones payload (distribution_buckets of the 'heartrate' entry).
function heartrateZonePercent(activity, zone) {
  const zonesPayload = Array.isArray(activity?.zones) ? activity.zones : [];
  const hrZones = zonesPayload.find(z => z?.type === 'heartrate');
  const buckets = hrZones?.distribution_buckets;
  if (!Array.isArray(buckets) || buckets.length === 0) return null;

  const total = buckets.reduce((sum, b) => sum + (b?.time || 0), 0);
  if (total === 0) return null;
  const bucket = buckets[zone - 1];
  if (!bucket) return null;
  return ((bucket.time || 0) / total) * 100;
}

// Rule registry — each kind provides validate(rule, path, errors, depth) and
// evaluate(activity, rule) → boolean. Missing data (no HR stream, no zones)
// evaluates to false: an activity can't satisfy a criterion it has no data for.
const RULE_TYPES = {
  sportType: {
    validate(rule, path, errors) {
      if (!Array.isArray(rule.values) || rule.values.length === 0 ||
          !rule.values.every(v => typeof v === 'string' && v.trim())) {
        errors.push(`${path}: "values" muss eine nicht-leere Liste von Sportarten sein`);
      }
    },
    evaluate(activity, rule) {
      const values = rule.values.map(v => v.toLowerCase());
      const sport = String(activity.sportType || '').toLowerCase();
      const legacy = String(activity.type || '').toLowerCase();
      return values.includes(sport) || values.includes(legacy);
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

  hrZonePercent: {
    validate(rule, path, errors) {
      if (!Number.isInteger(rule.zone) || rule.zone < 1 || rule.zone > 5) {
        errors.push(`${path}: "zone" muss 1–5 sein`);
      }
      if (!isFiniteNumber(rule.minPercent) || rule.minPercent <= 0 || rule.minPercent > 100) {
        errors.push(`${path}: "minPercent" muss zwischen 0 und 100 liegen`);
      }
    },
    evaluate(activity, rule) {
      const percent = heartrateZonePercent(activity, rule.zone);
      return percent != null && percent >= rule.minPercent;
    },
  },

  group: {
    validate(rule, path, errors, depth) {
      validateGroup(rule, path, errors, depth + 1);
    },
    evaluate(activity, rule) {
      return evaluateGroup(activity, rule);
    },
  },
};

function validateGroup(group, path, errors, depth) {
  if (depth > MAX_DEPTH) {
    errors.push(`${path}: maximale Verschachtelungstiefe (${MAX_DEPTH}) überschritten`);
    return;
  }
  if (!group || typeof group !== 'object') {
    errors.push(`${path}: Gruppe muss ein Objekt sein`);
    return;
  }
  if (!['AND', 'OR'].includes(group.operator)) {
    errors.push(`${path}: "operator" muss AND oder OR sein`);
  }
  if (!Array.isArray(group.rules) || group.rules.length === 0) {
    errors.push(`${path}: "rules" darf nicht leer sein`);
    return;
  }
  group.rules.forEach((rule, i) => {
    const rulePath = `${path}.rules[${i}]`;
    const type = RULE_TYPES[rule?.kind];
    if (!type) {
      errors.push(`${rulePath}: unbekannter Regel-Typ "${rule?.kind}" (verfügbar: ${Object.keys(RULE_TYPES).join(', ')})`);
      return;
    }
    type.validate(rule, rulePath, errors, depth);
  });
}

function evaluateGroup(activity, group) {
  const results = group.rules.map(rule => RULE_TYPES[rule.kind].evaluate(activity, rule));
  return group.operator === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

// Public API

// Validates a criteria document; returns { valid, errors }.
function validateCriteria(criteria) {
  const errors = [];
  validateGroup(criteria, 'criteria', errors, 1);
  return { valid: errors.length === 0, errors };
}

// True when the activity satisfies the criteria. Invalid criteria never match.
function evaluateActivity(activity, criteria) {
  if (!validateCriteria(criteria).valid) return false;
  return evaluateGroup(activity, criteria);
}

module.exports = {
  METRICS,
  RULE_TYPES,
  validateCriteria,
  evaluateActivity,
  heartratePercentInRange,
  heartrateZonePercent,
};
