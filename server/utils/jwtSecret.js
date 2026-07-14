// Resolves the JWT signing secret: env file/value, then bootstrap config file.
// Falls back to a temporary random secret (sessions end on restart) with a warning.
const fs = require('fs');
const crypto = require('crypto');
const bootstrapConfig = require('./bootstrapConfig');

// JWT_SECRET_FILE takes precedence over JWT_SECRET, both in env and bootstrap file.
function loadSecret() {
  // 1. env: JWT_SECRET_FILE
  const envFile = process.env.JWT_SECRET_FILE;
  if (envFile) {
    try {
      const s = fs.readFileSync(envFile, 'utf8').trim();
      if (s) return s;
      throw new Error('file is empty');
    } catch (e) {
      console.error(`[jwt] ERROR: could not read JWT_SECRET_FILE "${envFile}": ${e.message}`);
      process.exit(1);
    }
  }

  // 2. env: JWT_SECRET
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  // 3. bootstrap file: JWT_SECRET_FILE
  const bsFile = bootstrapConfig.get('JWT_SECRET_FILE');
  if (bsFile) {
    try {
      const s = fs.readFileSync(bsFile, 'utf8').trim();
      if (s) return s;
      throw new Error('file is empty');
    } catch (e) {
      console.error(`[jwt] ERROR: could not read JWT_SECRET_FILE from bootstrap "${bsFile}": ${e.message}`);
      // Don't exit here – fall through to next option
    }
  }

  // 4. bootstrap file: JWT_SECRET
  const bsSecret = bootstrapConfig.get('JWT_SECRET');
  if (bsSecret) return bsSecret;

  // 5. Test environment: deterministic default
  if (process.env.NODE_ENV === 'test') {
    return 'deltis-test-only-secret-do-not-use-in-production';
  }

  // 6. Setup / first-start: random ephemeral secret.
  //    Sessions are lost on every restart until a proper secret is configured.
  const temp = crypto.randomBytes(48).toString('base64');
  console.warn(
    '\n[jwt] WARNING: JWT_SECRET is not configured.\n' +
    '  A temporary random secret is used – all sessions are lost on restart.\n' +
    '  Configure via admin setup wizard or set JWT_SECRET in .env / deltis.config.json.\n'
  );
  return temp;
}

module.exports = loadSecret();
