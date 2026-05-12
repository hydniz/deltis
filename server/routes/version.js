const { version } = require('../../package.json');

// GIT_COMMIT is injected at image build time via --build-arg.
// Falls back to 'unknown' when running outside Docker (e.g. local dev).
const commitHash = process.env.GIT_COMMIT || (() => {
  try {
    return require('child_process')
      .execSync('git rev-parse --short HEAD', { cwd: __dirname })
      .toString().trim();
  } catch {
    return 'unknown';
  }
})();

const apiVersion = `${version}+${commitHash}`;

const express = require('express');
const router = express.Router();

router.get('/', (_req, res) => {
  res.json({ version: apiVersion });
});

module.exports = router;
