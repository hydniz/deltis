const mongoose = require('mongoose');

// Tracks which migrations have been applied to this database.
// Insertion is the success marker: a row exists iff `up()` completed cleanly.
const migrationSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, index: true },
  appliedAt: { type: Date, default: Date.now },
  durationMs: { type: Number },
});

module.exports = mongoose.model('Migration', migrationSchema);
