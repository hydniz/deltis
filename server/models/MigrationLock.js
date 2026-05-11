const mongoose = require('mongoose');

// Advisory lock that prevents concurrent migration runs (e.g. multiple replicas
// of the app starting simultaneously). Singleton document with _id 'lock'.
// TTL index auto-expires the lock after 30 minutes so a crashed process never
// dead-locks the system.
const migrationLockSchema = new mongoose.Schema({
  _id: { type: String, default: 'lock', required: true },
  acquiredAt: { type: Date, default: Date.now, expires: 1800 },
  host: { type: String },
});

module.exports = mongoose.model('MigrationLock', migrationLockSchema);
