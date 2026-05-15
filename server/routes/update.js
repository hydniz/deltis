const express = require('express');
const router = express.Router();
const http = require('http');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const appConfig = require('../utils/config');

const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Kein Zugriff' });
  next();
};

const APP_DIR = path.join(__dirname, '..', '..');

// All runtime values go through the config utility so DB overrides are respected.
const repoUrl = () => appConfig.get('UPDATE_REPO_URL');
const branch = () => appConfig.get('UPDATE_BRANCH');

// ── Module-level update state ─────────────────────────────────────────────

let updateInProgress = false;
const logBuffer = [];
const MAX_LOG_LINES = 200;
const sseClients = new Set();

function pushLog(line) {
  logBuffer.push(line);
  if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
  for (const res of sseClients) {
    res.write(`data: ${JSON.stringify({ line })}\n\n`);
  }
}

function pushRestart() {
  for (const res of sseClients) {
    res.write('event: restart\ndata: {}\n\n');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function capture(cmd, args) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(`${cmd} failed`)));
    proc.on('error', reject);
  });
}

function triggerWatchtower() {
  const token = appConfig.get('WATCHTOWER_API_TOKEN');
  const host = appConfig.get('WATCHTOWER_HOST');
  const port = parseInt(process.env.WATCHTOWER_PORT || '8080', 10);

  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: host, port, path: '/v1/update', method: 'GET',
        headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        reject(new Error(`Watchtower: HTTP ${res.statusCode}`));
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Watchtower nicht erreichbar (Timeout)'));
    });
    req.end();
  });
}

// ── Routes ────────────────────────────────────────────────────────────────

// GET /api/admin/update/status
router.get('/status', auth, adminOnly, async (req, res) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));

  if (!repoUrl()) {
    return res.json({
      configured: false,
      currentVersion: pkg.version,
      currentCommit: null,
      latestCommit: null,
      updateAvailable: null,
      updateInProgress,
    });
  }

  let latestCommit = null;
  let checkError = null;

  try {
    const raw = await capture('git', ['ls-remote', repoUrl(), `refs/heads/${branch()}`]);
    latestCommit = raw.split('\t')[0].substring(0, 7);
  } catch {
    checkError = 'GitHub nicht erreichbar';
  }

  // GIT_COMMIT is the full SHA baked in at image build time; truncate to 7 chars.
  const currentCommit = process.env.GIT_COMMIT && process.env.GIT_COMMIT !== 'unknown'
    ? process.env.GIT_COMMIT.substring(0, 7)
    : null;

  const updateAvailable = currentCommit && latestCommit
    ? currentCommit !== latestCommit
    : null;

  res.json({
    configured: true,
    currentVersion: pkg.version,
    currentCommit,
    latestCommit,
    updateAvailable,
    updateInProgress,
    ...(checkError ? { checkError } : {}),
  });
});

// GET /api/admin/update/stream
// SSE – streams live log lines. Reconnecting clients receive the buffer first.
router.get('/stream', auth, adminOnly, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  for (const line of logBuffer) {
    res.write(`data: ${JSON.stringify({ line })}\n\n`);
  }

  const keepAlive = setInterval(() => res.write(':ping\n\n'), 25000);
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(keepAlive);
  });
});

// POST /api/admin/update/start
router.post('/start', auth, adminOnly, (req, res) => {
  if (!repoUrl()) {
    return res.status(400).json({ error: 'UPDATE_REPO_URL ist nicht konfiguriert.' });
  }
  if (updateInProgress) {
    return res.status(409).json({ error: 'Ein Update läuft bereits.' });
  }

  updateInProgress = true;
  logBuffer.length = 0;
  res.json({ ok: true });

  runUpdate().catch(err => {
    pushLog(`✗ Unerwarteter Fehler: ${err.message}`);
    updateInProgress = false;
  });
});

// ── Update pipeline ───────────────────────────────────────────────────────

async function runUpdate() {
  const bar = '══════════════════════════════════════════════';
  try {
    pushLog(bar);
    pushLog('  Deltis OTA Update');
    pushLog(bar);
    pushLog('');
    pushLog('→ [1/2] Auf neues Docker-Image prüfen …');
    pushLog(`  Repository : ${repoUrl()}`);
    pushLog(`  Image      : hydniz/deltis:latest`);
    pushLog('');
    pushLog('→ [2/2] Watchtower benachrichtigen …');
    pushLog('  Watchtower pullt das Image und startet den Container');
    pushLog('  neu, falls ein neues Digest gefunden wird.');

    // Send the restart event BEFORE triggering Watchtower so the frontend
    // enters polling mode before the container is potentially killed.
    pushRestart();
    await new Promise(r => setTimeout(r, 1000));

    await triggerWatchtower();

    pushLog('');
    pushLog('✓ Watchtower ausgelöst.');
    pushLog('  – Neues Image vorhanden → Container wird neu gestartet.');
    pushLog('  – Kein neues Image      → App bleibt online.');
    pushLog(bar);

    // Reset so the status endpoint is correct again if no update happened.
    updateInProgress = false;

  } catch (err) {
    pushLog('');
    pushLog(`✗ Update fehlgeschlagen: ${err.message}`);
    updateInProgress = false;
  }
}

// Exported only so tests can inspect / reset module-level state.
router._resetState = () => {
  updateInProgress = false;
  logBuffer.length = 0;
};
router._setInProgress = (v) => { updateInProgress = v; };

module.exports = router;
