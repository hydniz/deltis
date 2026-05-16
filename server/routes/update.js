const express = require('express');
const router = express.Router();
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const appConfig = require('../utils/config');

const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Kein Zugriff' });
  next();
};

const APP_DIR = path.join(__dirname, '..', '..');

// ── Docker detection ──────────────────────────────────────────────────────────
// /.dockerenv is created by the Docker runtime inside every container.
// RUNNING_IN_DOCKER can be set explicitly in docker-compose as a fallback.
function isRunningInDocker() {
  try { fs.accessSync('/.dockerenv'); return true; } catch { /* */ }
  return process.env.RUNNING_IN_DOCKER === '1' || process.env.RUNNING_IN_DOCKER === 'true';
}

// ── Config accessors ──────────────────────────────────────────────────────────
const repoUrl = () => appConfig.get('UPDATE_REPO_URL') || 'https://github.com/hydniz/deltis';
const releaseChannel = () => appConfig.get('UPDATE_RELEASE_CHANNEL') || 'stable';

// ── Module-level update state ─────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// Queries the GitHub API over HTTPS and returns parsed JSON.
function fetchGitHubJson(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      method: 'GET',
      headers: {
        'User-Agent': 'Deltis-OTA/1.0',
        'Accept': 'application/vnd.github+json',
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        } else {
          reject(new Error(`GitHub API ${res.statusCode}: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('GitHub API timeout')); });
    req.end();
  });
}

// Extracts owner/repo from a GitHub URL (https://github.com/owner/repo).
function parseGitHubRepo(url) {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.\s]+?)(?:\.git)?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

// Returns a regex that matches the given channel's tag format.
function channelTagRegex(channel) {
  switch (channel) {
    case 'stable': return /^v\d+\.\d+\.\d+$/;
    case 'beta':   return /^v\d+\.\d+\.\d+-beta(\.\d+)?$/;
    case 'alpha':  return /^v\d+\.\d+\.\d+-alpha(\.\d+)?$/;
    default:       return null;
  }
}

// Fetches the latest version available for the configured release channel.
// Returns { version, commitSha, tagName } or throws.
async function fetchLatestForChannel(url, channel) {
  const parsed = parseGitHubRepo(url);
  if (!parsed) throw new Error('Ungültige GitHub-URL.');

  if (channel === 'main') {
    // HEAD commit on main branch via ls-remote (no API auth needed)
    const raw = await capture('git', ['ls-remote', url, 'refs/heads/main']);
    const sha = raw.split('\t')[0].substring(0, 7);
    return { version: null, commitSha: sha, tagName: 'main' };
  }

  const releases = await fetchGitHubJson(`/repos/${parsed.owner}/${parsed.repo}/releases`);
  const re = channelTagRegex(channel);
  const match = releases.find(r => !r.draft && re.test(r.tag_name));
  if (!match) throw new Error(`Keine ${channel}-Version auf GitHub gefunden.`);

  return {
    version: match.tag_name.replace(/^v/, ''),
    commitSha: match.target_commitish?.substring(0, 7) ?? null,
    tagName: match.tag_name,
    publishedAt: match.published_at,
    releaseUrl: match.html_url,
  };
}

function triggerWatchtower() {
  const token = appConfig.get('WATCHTOWER_API_TOKEN');
  const host = appConfig.get('WATCHTOWER_HOST');
  const port = parseInt(process.env.WATCHTOWER_PORT || '8080', 10);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: host,
        port,
        path: '/v1/update',
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
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

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/admin/update/status
router.get('/status', auth, adminOnly, async (req, res) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
  const channel = releaseChannel();
  const url = repoUrl();
  const inDocker = isRunningInDocker();

  let latest = null;
  let checkError = null;

  try {
    latest = await fetchLatestForChannel(url, channel);
  } catch (err) {
    checkError = err.message;
  }

  const currentCommit = process.env.GIT_COMMIT && process.env.GIT_COMMIT !== 'unknown'
    ? process.env.GIT_COMMIT.substring(0, 7)
    : null;

  let updateAvailable = null;
  if (!checkError && latest) {
    if (channel === 'main') {
      updateAvailable = currentCommit && latest.commitSha
        ? currentCommit !== latest.commitSha
        : null;
    } else {
      // Compare semver strings: current package.json version vs latest release tag
      updateAvailable = latest.version ? latest.version !== pkg.version : null;
    }
  }

  res.json({
    currentVersion: pkg.version,
    currentCommit,
    channel,
    repoUrl: url,
    inDocker,
    latest,
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

// ── Update pipeline ───────────────────────────────────────────────────────────

async function runUpdate() {
  const bar = '══════════════════════════════════════════════';
  const channel = releaseChannel();
  const url = repoUrl();
  const inDocker = isRunningInDocker();

  try {
    pushLog(bar);
    pushLog('  Deltis OTA Update');
    pushLog(bar);
    pushLog('');

    if (inDocker) {
      pushLog('⚠  DOCKER-UMGEBUNG ERKANNT');
      pushLog('   Direktes Ändern des Container-Inhalts ist ein Anti-Pattern.');
      pushLog('   Der korrekte Weg: Neues Docker-Image bauen und pullen.');
      pushLog('   Dieser Update-Button löst Watchtower aus, das genau das tut.');
      pushLog('');
    }

    pushLog(`→ Kanal      : ${channel}`);
    pushLog(`→ Repository : ${url}`);
    pushLog('');

    let latest;
    try {
      pushLog('→ [1/2] Neueste Version ermitteln …');
      latest = await fetchLatestForChannel(url, channel);
      if (channel === 'main') {
        pushLog(`  Neuester Commit auf main: ${latest.commitSha}`);
      } else {
        pushLog(`  Neueste ${channel}-Version : ${latest.tagName}`);
      }
    } catch (err) {
      pushLog(`✗ GitHub nicht erreichbar: ${err.message}`);
      updateInProgress = false;
      return;
    }

    pushLog('');
    pushLog('→ [2/2] Watchtower benachrichtigen …');
    pushLog('  Watchtower pullt das neue Docker-Image und startet den');
    pushLog('  Container neu, falls ein neues Digest gefunden wird.');

    // Send restart event before triggering so the frontend enters polling mode.
    pushRestart();
    await new Promise(r => setTimeout(r, 1000));

    await triggerWatchtower();

    pushLog('');
    pushLog('✓ Watchtower ausgelöst.');
    pushLog('  – Neues Image vorhanden → Container wird neu gestartet.');
    pushLog('  – Kein neues Image      → App bleibt online.');
    pushLog(bar);

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
