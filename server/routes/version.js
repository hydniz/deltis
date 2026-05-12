const { execSync } = require('child_process');
const { version } = require('../../package.json');

let commitHash = 'unknown';
try {
  commitHash = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
} catch {}

const apiVersion = `${version}+${commitHash}`;

const express = require('express');
const router = express.Router();

router.get('/', (_req, res) => {
  res.json({ version: apiVersion });
});

module.exports = router;
