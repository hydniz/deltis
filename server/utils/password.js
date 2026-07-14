const bcrypt = require('bcryptjs');
const fs = require('fs');
const bootstrapConfig = require('./bootstrapConfig');

const ROUNDS = 12;

// Reads the current pepper at call time so bootstrap-file values are picked up
// after the module is first loaded.
function getPepper() {
  // 1. env: PEPPER_FILE
  const envFile = process.env.PEPPER_FILE;
  if (envFile) {
    try {
      const p = fs.readFileSync(envFile, 'utf8').trim();
      if (p) return p;
      throw new Error('file is empty');
    } catch (e) {
      console.error(`[auth] ERROR: could not read PEPPER_FILE "${envFile}": ${e.message}`);
      process.exit(1);
    }
  }

  // 2. env: PASSWORD_PEPPER
  if (process.env.PASSWORD_PEPPER) return process.env.PASSWORD_PEPPER;

  // 3. bootstrap file: PEPPER_FILE
  const bsFile = bootstrapConfig.get('PEPPER_FILE');
  if (bsFile) {
    try {
      const p = fs.readFileSync(bsFile, 'utf8').trim();
      if (p) return p;
      // file exists but empty – fall through
    } catch { /* path configured but file missing – fall through */ }
  }

  // 4. bootstrap file: PASSWORD_PEPPER
  const bsPepper = bootstrapConfig.get('PASSWORD_PEPPER');
  if (bsPepper) return bsPepper;

  // 5. No pepper configured – warn once, use empty string.
  if (process.env.NODE_ENV !== 'test') {
    console.warn(
      '[auth] WARNING: no pepper configured.\n' +
      '  Set PEPPER_FILE or PASSWORD_PEPPER in .env, docker-compose, or the setup wizard.\n' +
      '  IMPORTANT: configure before creating the first user account.\n'
    );
  }
  return '';
}

module.exports = {
  hash: (plaintext) => bcrypt.hash(plaintext + getPepper(), ROUNDS),
  verify: (plaintext, hash) => bcrypt.compare(plaintext + getPepper(), hash),
};
