const mongoose = require('mongoose');

const intermediateStepSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  targetValue: { type: Number, required: true },
  description: { type: String }
}, { _id: false });

// Filter, der auf die Aktivität selbst angewandt wird (nur bei aggregation='max' relevant)
const activityFilterSchema = new mongoose.Schema({
  fieldKey: { type: String, required: true },
  fieldType: { type: String, enum: ['select', 'number'], default: 'select' },
  // select/multiselect:
  operator: { type: String, enum: ['anyOf', 'allOf'], default: 'anyOf' },
  values: [{ type: String }],
  // number (duration, distance, custom number):
  numOperator: { type: String, enum: ['min', 'max', 'exact'], default: 'min' },
  numValue: { type: Number }
}, { _id: false });

const conditionSchema = new mongoose.Schema({
  metric: { type: String },
  condition: { type: String, enum: ['min', 'max', 'exact'] },
  targetValue: { type: Number },
  unitSymbol: { type: String },
  valueScope: { type: String, enum: ['total', 'perActivity'], default: 'total' },
  aggregation: { type: String, enum: ['sum', 'max'], default: 'sum' },
  // Nur bei aggregation='max': Aktivität muss diese Felder erfüllen um in die Bestleistung einzugehen
  activityFilters: [activityFilterSchema]
}, { _id: false });

const goalSchema = new mongoose.Schema({
  // Relation: Benutzer dem dieses Ziel gehört
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  name: { type: String, required: true },
  description: { type: String },

  type: {
    type: String,
    // periodic-* = frei konfigurierbares Intervall (neu)
    // weekly-*   = Legacy, wird wie periodic mit intervalValue=1, intervalUnit='week' behandelt
    enum: ['periodic-activity', 'periodic-habit', 'weekly-activity', 'weekly-habit', 'long-term-activity', 'long-term-habit'],
    required: true
  },

  // Intervall für periodische Ziele (ignoriert bei langfristigen Zielen)
  intervalValue: { type: Number, default: 1, min: 1 },
  intervalUnit: { type: String, enum: ['day', 'week', 'month'], default: 'week' },

  // Polymorphe Relation: zeigt entweder auf ActivityType oder HabitDefinition.
  // Neue Einträge speichern hier die ObjectId des referenzierten Dokuments.
  // Alte Einträge (legacy) speichern einen String-Label (Aktivität) oder ObjectId-String (Gewohnheit).
  targetRef: { type: mongoose.Schema.Types.Mixed, required: true },

  // Bestimmt welches Modell targetRef referenziert.
  // Neue Werte: 'ActivityType' | 'HabitDefinition'
  // Legacy-Werte: 'activity' | 'habit' (werden weiterhin unterstützt)
  targetRefModel: {
    type: String,
    enum: ['ActivityType', 'HabitDefinition', 'activity', 'habit'],
    required: true
  },

  // Legacy single-condition fields (backward compat)
  condition: { type: String, enum: ['min', 'max', 'exact'], required: true },
  targetValue: { type: Number, required: true },
  unitSymbol: { type: String },

  // Wie der Wert gemessen wird (legacy single-metric, now also used as fallback)
  // 'count'    – Anzahl der Einträge (Standard für Aktivitäten)
  // 'distance' – Summe der Distanz in km (nur Aktivitätsziele)
  // 'duration' – Summe der Dauer in Minuten (nur Aktivitätsziele)
  // 'value'    – Summe der eingetragenen Werte (Standard für Gewohnheiten)
  // 'custom_fieldKey' – Summe eines custom fields (kein enum, erlaubt beliebige Werte)
  metric: { type: String },

  // Multi-condition support
  conditionOperator: { type: String, enum: ['AND', 'OR'], default: 'AND' },
  conditions: [conditionSchema],

  // Nur für langfristige Ziele
  startDate: { type: Date },
  endDate: { type: Date },
  startValue: { type: Number },
  intermediateSteps: [intermediateStepSchema],

  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

goalSchema.index({ userId: 1, isActive: 1 });

module.exports = mongoose.model('Goal', goalSchema);
