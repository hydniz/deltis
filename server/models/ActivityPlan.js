const mongoose = require('mongoose');

const activityPlanSchema = new mongoose.Schema({
  // Relation: Benutzer dem dieser Plan gehört
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Aktivitätsname als String (für Abwärtskompatibilität)
  activityType: { type: String, required: true },

  // Relation: direkte Referenz auf den ActivityType-Datensatz (seit v2)
  activityTypeRef: { type: mongoose.Schema.Types.ObjectId, ref: 'ActivityType' },
  // Version des ActivityType zum Zeitpunkt der Planung
  activityTypeVersion: { type: Number },

  scheduledDate: { type: Date, required: true },
  duration: { type: Number },   // geplante Minuten
  distance: { type: Number },   // geplante Kilometer
  completed: { type: Boolean, default: false },
  notes: { type: String },
  createdAt: { type: Date, default: Date.now }
});

activityPlanSchema.index({ userId: 1, scheduledDate: 1 });

module.exports = mongoose.model('ActivityPlan', activityPlanSchema);
