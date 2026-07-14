// Mongoose model: TTL lock document preventing concurrent migration runs.
const mongoose = require('mongoose');

const MIGRATION_LOCK_TTL_SECONDS = 24 * 60 * 60;

// Advisory lock that prevents concurrent migration runs (e.g. multiple replicas
// of the app starting simultaneously). Singleton document with _id 'lock'.
// TTL index auto-expires the lock after a substantial interval so a crashed
// process never dead-locks the system, while reducing the chance that a
// legitimate long-running migration loses its lock mid-run.
const migrationLockSchema = new mongoose.Schema({
  _id: { type: String, default: 'lock', required: true },
  acquiredAt: { type: Date, default: Date.now, expires: MIGRATION_LOCK_TTL_SECONDS },
  host: { type: String },
});

module.exports = mongoose.model('MigrationLock', migrationLockSchema);
