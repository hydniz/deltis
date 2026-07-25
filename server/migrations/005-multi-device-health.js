// Health Connect goes multi-device: a user may sync from several phones. The
// old schema had a unique index on `userId` (one connection per user) — drop it
// so the new unique `(userId, deviceId)` index (declared on the model, created
// by syncIndexes at boot) can take over.
//
// Idempotent: if the old index is already gone there is nothing to do.
const mongoose = require('mongoose');

function log(msg) { console.log(`[migration]   ${msg}`); }

async function up() {
  const coll = mongoose.connection.collection('healthconnections');

  let indexes = [];
  try {
    indexes = await coll.indexes();
  } catch (err) {
    // No collection yet (fresh install) → nothing to migrate.
    log(`Multi-device health: no healthconnections collection (${err.message}), nothing to do`);
    return;
  }

  // The old single-field unique index on userId. Match by key shape rather than
  // name so a differently-named equivalent is still caught.
  const stale = indexes.find(ix =>
    ix.unique &&
    ix.key && Object.keys(ix.key).length === 1 && ix.key.userId === 1);

  if (!stale) {
    log('Multi-device health: no unique userId index found, nothing to do');
    return;
  }

  await coll.dropIndex(stale.name);
  log(`Multi-device health: dropped unique index "${stale.name}" on healthconnections.userId`);
}

module.exports = { name: '005-multi-device-health', up };
