// Post-connect database security check.
//
// Automated MongoDB ransom bots wipe every database of an exposed, unauthen-
// ticated mongod and leave a marker database ("READ_ME_TO_RECOVER_YOUR_DATA"
// and similar) with a ransom note. If such a marker exists, the data loss has
// already happened — the operator must restore a backup and close the exposed
// port, NOT initialize a fresh instance (and never pay: these bots do not
// keep copies). This check makes the situation unmissable in the logs.

// Name patterns used by known MongoDB wiper/ransom campaigns.
const RANSOM_PATTERNS = [
  /READ_?_?ME/i,
  /RECOVER/i,
  /RANSOM/i,
  /PLEASE_?READ/i,
  /HOW_?TO_?RESTORE/i,
  /WARNING/i,
];

const SYSTEM_DBS = new Set(['admin', 'config', 'local']);

// Pure helper: which of the given database names look like ransom markers?
function findRansomMarkers(dbNames) {
  return (dbNames || [])
    .filter(name => typeof name === 'string' && !SYSTEM_DBS.has(name))
    .filter(name => RANSOM_PATTERNS.some(p => p.test(name)));
}

// Lists the server's databases and logs a loud warning when ransom markers
// are present. Returns the marker names (empty when clean or unreadable —
// listDatabases may be forbidden for restricted users, which is fine).
async function warnIfDatabaseCompromised(connection, log = console) {
  try {
    const { databases } = await connection.db.admin().listDatabases({ nameOnly: true });
    const markers = findRansomMarkers(databases.map(d => d.name));
    if (markers.length > 0) {
      log.error('');
      log.error('═'.repeat(66));
      log.error('  ⚠ SECURITY ALERT: ransom marker database(s) detected:');
      for (const name of markers) log.error(`    - ${name}`);
      log.error('  This MongoDB instance was very likely wiped by a ransom bot.');
      log.error('  → Do NOT pay and do NOT re-initialize the app.');
      log.error('  → Close the exposed MongoDB port (see docs/DEPLOYMENT.md,');
      log.error('    "Securing MongoDB"), then restore the latest backup');
      log.error('    (./restore.sh).');
      log.error('═'.repeat(66));
      log.error('');
    }
    return markers;
  } catch {
    return [];
  }
}

module.exports = { findRansomMarkers, warnIfDatabaseCompromised, RANSOM_PATTERNS };
