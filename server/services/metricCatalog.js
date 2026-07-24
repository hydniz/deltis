// The catalog of measurement templates.
//
// `HEALTH_METRICS` maps a Health Connect data type to the metric it feeds; the
// companion app reads exactly these record types and posts them to
// /api/health/sync as `metrics: [{ type, id, time, value }]`. `EXTRA_CATALOG`
// adds templates that have no Health Connect source but are common enough to
// offer as one-tap additions (mood, custom scales, …).
//
// Adding a new importable measurement = one entry in HEALTH_METRICS here plus
// the matching record read in the companion app. Everything downstream
// (storage, dedup, the metric API, goals) is generic and needs no change.
//
// Every template is German-labelled (UI language policy) with sane bounds and
// aggregation. `dayAgg` collapses several readings within a day, `agg` across a
// period. `direction` drives trend colour and the natural sense of a goal.
//
// `weight` and `exercise` are intentionally absent: weight already has WeightLog
// and exercise sessions already have HealthActivity. This catalog is only the
// scalar measurements that had nowhere to live before.

const HEALTH_METRICS = {
  // Body composition
  bodyFat: { name: 'Körperfett', unit: '%', valueType: 'percent', dayAgg: 'last', agg: 'avg', direction: 'down', min: 1, max: 70, icon: 'Percent', color: 'ocher' },
  leanBodyMass: { name: 'Magermasse', unit: 'kg', valueType: 'number', dayAgg: 'last', agg: 'avg', direction: 'up', min: 1, max: 300, icon: 'Dumbbell', color: 'sage' },
  boneMass: { name: 'Knochenmasse', unit: 'kg', valueType: 'number', dayAgg: 'last', agg: 'avg', direction: 'none', min: 0, max: 20, icon: 'Bone', color: 'stone' },
  height: { name: 'Körpergröße', unit: 'cm', valueType: 'number', dayAgg: 'last', agg: 'last', direction: 'none', min: 30, max: 260, icon: 'Ruler', color: 'stone' },

  // Vitals
  restingHeartRate: { name: 'Ruhepuls', unit: 'bpm', valueType: 'number', dayAgg: 'min', agg: 'avg', direction: 'down', min: 20, max: 200, icon: 'HeartPulse', color: 'rose' },
  heartRateVariability: { name: 'Herzfrequenzvariabilität', unit: 'ms', valueType: 'number', dayAgg: 'avg', agg: 'avg', direction: 'up', min: 0, max: 500, icon: 'Activity', color: 'rose' },
  oxygenSaturation: { name: 'Sauerstoffsättigung', unit: '%', valueType: 'percent', dayAgg: 'avg', agg: 'avg', direction: 'up', min: 50, max: 100, icon: 'Wind', color: 'sage' },
  respiratoryRate: { name: 'Atemfrequenz', unit: '/min', valueType: 'number', dayAgg: 'avg', agg: 'avg', direction: 'none', min: 0, max: 120, icon: 'Wind', color: 'sage' },
  bodyTemperature: { name: 'Körpertemperatur', unit: '°C', valueType: 'number', dayAgg: 'max', agg: 'avg', direction: 'none', min: 30, max: 45, icon: 'Thermometer', color: 'ocher' },
  basalBodyTemperature: { name: 'Basaltemperatur', unit: '°C', valueType: 'number', dayAgg: 'last', agg: 'avg', direction: 'none', min: 30, max: 45, icon: 'Thermometer', color: 'ocher' },
  bloodGlucose: { name: 'Blutzucker', unit: 'mg/dl', valueType: 'number', dayAgg: 'avg', agg: 'avg', direction: 'none', min: 0, max: 1000, icon: 'Droplet', color: 'rose' },
  vo2Max: { name: 'VO₂max', unit: 'ml/kg/min', valueType: 'number', dayAgg: 'max', agg: 'max', direction: 'up', min: 0, max: 100, icon: 'Gauge', color: 'sage' },

  // Blood pressure — two paired metrics rendered on one card (shared groupKey).
  bloodPressureSystolic: { name: 'Blutdruck (systolisch)', unit: 'mmHg', valueType: 'number', dayAgg: 'last', agg: 'avg', direction: 'down', min: 40, max: 300, groupKey: 'blood_pressure', groupOrder: 0, icon: 'Activity', color: 'rose' },
  bloodPressureDiastolic: { name: 'Blutdruck (diastolisch)', unit: 'mmHg', valueType: 'number', dayAgg: 'last', agg: 'avg', direction: 'down', min: 20, max: 200, groupKey: 'blood_pressure', groupOrder: 1, icon: 'Activity', color: 'rose' },

  // Daily activity aggregates
  steps: { name: 'Schritte', unit: '', valueType: 'number', dayAgg: 'sum', agg: 'avg', direction: 'up', min: 0, max: 200000, icon: 'Footprints', color: 'brand' },
  distance: { name: 'Distanz (Tag)', unit: 'km', valueType: 'number', dayAgg: 'sum', agg: 'sum', direction: 'up', min: 0, max: 1000, icon: 'MapPin', color: 'brand' },
  activeCalories: { name: 'Aktive Kalorien', unit: 'kcal', valueType: 'number', dayAgg: 'sum', agg: 'avg', direction: 'up', min: 0, max: 30000, icon: 'Flame', color: 'ocher' },
  totalCalories: { name: 'Gesamtkalorien', unit: 'kcal', valueType: 'number', dayAgg: 'sum', agg: 'avg', direction: 'none', min: 0, max: 30000, icon: 'Flame', color: 'ocher' },
  floorsClimbed: { name: 'Etagen', unit: '', valueType: 'number', dayAgg: 'sum', agg: 'avg', direction: 'up', min: 0, max: 10000, icon: 'TrendingUp', color: 'sage' },

  // Metabolism
  basalMetabolicRate: { name: 'Grundumsatz', unit: 'kcal', valueType: 'number', dayAgg: 'last', agg: 'avg', direction: 'none', min: 0, max: 10000, icon: 'Flame', color: 'ocher' },
  bodyWaterMass: { name: 'Körperwasser', unit: 'kg', valueType: 'number', dayAgg: 'last', agg: 'avg', direction: 'none', min: 0, max: 200, icon: 'Droplet', color: 'sage' },
  elevationGained: { name: 'Höhenmeter (Tag)', unit: 'm', valueType: 'number', dayAgg: 'sum', agg: 'sum', direction: 'up', min: 0, max: 100000, icon: 'TrendingUp', color: 'sage' },
  wheelchairPushes: { name: 'Rollstuhl-Stöße', unit: '', valueType: 'number', dayAgg: 'sum', agg: 'avg', direction: 'up', min: 0, max: 200000, icon: 'Activity', color: 'brand' },

  // Sleep — total plus the individual stages
  sleepDuration: { name: 'Schlafdauer', unit: 'h', valueType: 'duration', dayAgg: 'sum', agg: 'avg', direction: 'up', min: 0, max: 24, icon: 'Moon', color: 'ocher' },
  sleepDeep: { name: 'Tiefschlaf', unit: 'h', valueType: 'duration', dayAgg: 'sum', agg: 'avg', direction: 'up', min: 0, max: 24, icon: 'Moon', color: 'stone' },
  sleepRem: { name: 'REM-Schlaf', unit: 'h', valueType: 'duration', dayAgg: 'sum', agg: 'avg', direction: 'up', min: 0, max: 24, icon: 'Moon', color: 'stone' },
  sleepLight: { name: 'Leichtschlaf', unit: 'h', valueType: 'duration', dayAgg: 'sum', agg: 'avg', direction: 'none', min: 0, max: 24, icon: 'Moon', color: 'stone' },
  sleepAwake: { name: 'Wachzeit (nachts)', unit: 'h', valueType: 'duration', dayAgg: 'sum', agg: 'avg', direction: 'down', min: 0, max: 24, icon: 'Moon', color: 'ocher' },

  // Nutrition — from NutritionRecord; one metric per nutrient the user cares about
  nutritionEnergy: { name: 'Kalorienzufuhr', unit: 'kcal', valueType: 'number', dayAgg: 'sum', agg: 'avg', direction: 'none', min: 0, max: 20000, icon: 'Utensils', color: 'ocher' },
  protein: { name: 'Protein', unit: 'g', valueType: 'number', dayAgg: 'sum', agg: 'avg', direction: 'up', min: 0, max: 2000, icon: 'Utensils', color: 'ocher' },
  carbs: { name: 'Kohlenhydrate', unit: 'g', valueType: 'number', dayAgg: 'sum', agg: 'avg', direction: 'none', min: 0, max: 3000, icon: 'Utensils', color: 'ocher' },
  fat: { name: 'Fett', unit: 'g', valueType: 'number', dayAgg: 'sum', agg: 'avg', direction: 'none', min: 0, max: 2000, icon: 'Utensils', color: 'ocher' },
  sugar: { name: 'Zucker', unit: 'g', valueType: 'number', dayAgg: 'sum', agg: 'avg', direction: 'down', min: 0, max: 2000, icon: 'Utensils', color: 'ocher' },
  fiber: { name: 'Ballaststoffe', unit: 'g', valueType: 'number', dayAgg: 'sum', agg: 'avg', direction: 'up', min: 0, max: 500, icon: 'Utensils', color: 'sage' },
  sodium: { name: 'Natrium', unit: 'mg', valueType: 'number', dayAgg: 'sum', agg: 'avg', direction: 'down', min: 0, max: 100000, icon: 'Utensils', color: 'rose' },
  hydration: { name: 'Wasser', unit: 'ml', valueType: 'number', dayAgg: 'sum', agg: 'avg', direction: 'up', min: 0, max: 20000, icon: 'Droplet', color: 'sage' },

  // Cycle tracking (opt-in). Categorical Health Connect values are mapped to a
  // small numeric scale so they fit the metric model.
  menstruationFlow: { name: 'Menstruationsstärke', unit: '', valueType: 'scale', scaleMax: 3, dayAgg: 'max', agg: 'max', direction: 'none', min: 0, max: 3, icon: 'Droplet', color: 'rose' },
};

// Templates with no Health Connect source — offered in the catalog for manual
// tracking.
const EXTRA_CATALOG = {
  mood: { name: 'Stimmung', unit: '', valueType: 'scale', scaleMax: 5, dayAgg: 'avg', agg: 'avg', direction: 'up', min: 1, max: 5, icon: 'Smile', color: 'ocher' },
  energy: { name: 'Energielevel', unit: '', valueType: 'scale', scaleMax: 5, dayAgg: 'avg', agg: 'avg', direction: 'up', min: 1, max: 5, icon: 'Zap', color: 'ocher' },
  stress: { name: 'Stress', unit: '', valueType: 'scale', scaleMax: 5, dayAgg: 'avg', agg: 'avg', direction: 'down', min: 1, max: 5, icon: 'Activity', color: 'rose' },
  waistCircumference: { name: 'Bauchumfang', unit: 'cm', valueType: 'number', dayAgg: 'last', agg: 'avg', direction: 'down', min: 20, max: 250, icon: 'Ruler', color: 'stone' },
};

// Health Connect record types report in these base units; the companion sends
// values already in the metric's unit, but the server clamps/records defensively.
const HEALTH_TYPE_KEYS = Object.keys(HEALTH_METRICS);

function healthTemplate(type) {
  return HEALTH_METRICS[type] || null;
}

// Builds the fields for a MetricDefinition from a template. `key` becomes the
// template name; callers set userId/builtin/healthType.
function definitionFromTemplate(key, template) {
  return {
    key,
    name: template.name,
    unit: template.unit || '',
    valueType: template.valueType || 'number',
    scaleMax: template.scaleMax || 5,
    dayAggregation: template.dayAgg || 'last',
    aggregation: template.agg || 'last',
    direction: template.direction || 'none',
    min: template.min ?? null,
    max: template.max ?? null,
    groupKey: template.groupKey || null,
    groupOrder: template.groupOrder || 0,
    icon: template.icon || 'Activity',
    color: template.color || 'rose',
  };
}

// The full catalog the UI offers (health-backed first, then manual-only),
// each tagged with whether Health Connect can fill it.
function fullCatalog() {
  const health = Object.entries(HEALTH_METRICS).map(([key, t]) => ({
    key, ...definitionFromTemplate(key, t), healthType: key, importable: true,
  }));
  const extra = Object.entries(EXTRA_CATALOG).map(([key, t]) => ({
    key, ...definitionFromTemplate(key, t), healthType: null, importable: false,
  }));
  return [...health, ...extra];
}

module.exports = {
  HEALTH_METRICS,
  EXTRA_CATALOG,
  HEALTH_TYPE_KEYS,
  healthTemplate,
  definitionFromTemplate,
  fullCatalog,
};
