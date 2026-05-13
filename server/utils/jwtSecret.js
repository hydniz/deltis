const fs = require('fs');

let secret;

// JWT_SECRET_FILE takes precedence over JWT_SECRET when both are set.
const secretFile = process.env.JWT_SECRET_FILE;
if (secretFile) {
  try {
    secret = fs.readFileSync(secretFile, 'utf8').trim();
    if (!secret) throw new Error('file is empty');
  } catch (e) {
    console.error(`[jwt] ERROR: could not read JWT_SECRET_FILE "${secretFile}": ${e.message}`);
    process.exit(1);
  }
} else if (process.env.JWT_SECRET) {
  secret = process.env.JWT_SECRET;
} else if (process.env.NODE_ENV === 'test') {
  // Jest sets NODE_ENV=test. Provide a deterministic default so the suite
  // starts without configuration — this secret must never leave the test process.
  secret = 'deltis-test-only-secret-do-not-use-in-production';
} else {
  console.error(
    '[jwt] ERROR: JWT_SECRET is not set.\n' +
    '  Option A (file):    JWT_SECRET_FILE=/path/to/file  in .env  (takes precedence)\n' +
    '  Option B (direct):  JWT_SECRET=<value>             in .env\n' +
    '  Generate a value:   openssl rand -base64 64'
  );
  process.exit(1);
}

module.exports = secret;
