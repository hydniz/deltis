const bcrypt = require('bcryptjs');
const fs = require('fs');

let pepper = '';

const pepperFile = process.env.PEPPER_FILE;
if (pepperFile) {
  try {
    pepper = fs.readFileSync(pepperFile, 'utf8').trim();
    if (!pepper) throw new Error('file is empty');
  } catch (e) {
    console.error(`[auth] ERROR: could not read PEPPER_FILE "${pepperFile}": ${e.message}`);
    process.exit(1);
  }
} else if (process.env.PASSWORD_PEPPER) {
  pepper = process.env.PASSWORD_PEPPER;
} else if (process.env.NODE_ENV !== 'test') {
  console.warn(
    '[auth] WARNING: no pepper configured. Set PEPPER_FILE=/path/to/pepper.key ' +
    'or PASSWORD_PEPPER=<secret> in .env for maximum protection against offline attacks.'
  );
}

const ROUNDS = 12;

module.exports = {
  hash: (plaintext) => bcrypt.hash(plaintext + pepper, ROUNDS),
  verify: (plaintext, hash) => bcrypt.compare(plaintext + pepper, hash),
};
