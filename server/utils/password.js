const bcrypt = require('bcryptjs');
const fs = require('fs');

let pepper = '';

const pepperFile = process.env.PEPPER_FILE;
if (pepperFile) {
  try {
    pepper = fs.readFileSync(pepperFile, 'utf8').trim();
    if (!pepper) throw new Error('Datei ist leer');
  } catch (e) {
    console.error(`[auth] FEHLER: PEPPER_FILE "${pepperFile}" konnte nicht gelesen werden: ${e.message}`);
    process.exit(1);
  }
} else if (process.env.PASSWORD_PEPPER) {
  pepper = process.env.PASSWORD_PEPPER;
} else if (process.env.NODE_ENV !== 'test') {
  console.warn(
    '[auth] WARNUNG: Kein Pepper konfiguriert. Setze PEPPER_FILE=/pfad/zur/pepper.key ' +
    'oder PASSWORD_PEPPER=<geheimnis> in .env für maximalen Schutz gegen Offline-Angriffe.'
  );
}

const ROUNDS = 12;

module.exports = {
  hash: (plaintext) => bcrypt.hash(plaintext + pepper, ROUNDS),
  verify: (plaintext, hash) => bcrypt.compare(plaintext + pepper, hash),
};
