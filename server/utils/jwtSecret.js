const fs = require('fs');

let secret;

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
} else {
  console.error(
    '[jwt] ERROR: JWT_SECRET is not set.\n' +
    '  Option A (direct):  JWT_SECRET=<value>             in .env\n' +
    '  Option B (file):    JWT_SECRET_FILE=/path/to/file  in .env\n' +
    '  Generate a value:   openssl rand -base64 64'
  );
  process.exit(1);
}

module.exports = secret;
