const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  // Relation: Benutzer dem dieser Eintrag gehört
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Aktivitätsname als String (für Abwärtskompatibilität und einfache Abfragen)
  activityType: { type: String, required: true },

  // Relation: direkte Referenz auf den ActivityType-Datensatz (seit v2)
  activityTypeRef: { type: mongoose.Schema.Types.ObjectId, ref: 'ActivityType' },
  // Version des ActivityType zum Zeitpunkt der Erfassung (für historische Namensanzeige)
  activityTypeVersion: { type: Number },

  date: { type: Date, required: true },
  duration: { type: Number },   // Minuten
  distance: { type: Number },   // Kilometer
  notes: { type: String },
  customValues: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now }
});

activityLogSchema.index({ userId: 1, date: -1 });
activityLogSchema.index({ userId: 1, activityTypeRef: 1, date: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
