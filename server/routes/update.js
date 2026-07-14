// OTA update endpoints (/api/admin/update): update check, live log stream
// (SSE), update and rollback orchestration. See docs/UPDATES.md.
const express = require('express');
const router = express.Router();
const https = require('https');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const appConfig = require('../utils/config');
const mongoose = require('mongoose');
const { createBackup, restoreBackup, pruneOldBackups } = require('../migrations/backup');
const updateEnv = require('../utils/updateEnv');
const docker = require('../utils/dockerClient');
const updateState = require('../utils/updateState');
const ulog = require('../utils/updateLog');
const serverState = require('../utils/serverState');

const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Kein Zugriff' });
  next();
};

const APP_DIR = path.join(__dirname, '..', '..');

// Pre-update DB snapshots land next to the pre-migration ones so restore.sh
// finds them via the mounted ./backups directory.
const PRE_UPDATE_BACKUP_DIR = path.join(APP_DIR, 'backups', 'pre-update');

// Kept for backwards compatibility – detection lives in utils/updateEnv now.
const isRunningInDocker = updateEnv.isRunningInDocker;

// Config accessors
// repoUrl() returns '' when not configured – callers must check for empty string.
const repoUrl = () => appConfig.get('UPDATE_REPO_URL') || '';
const releaseChannel = () => appConfig.get('UPDATE_RELEASE_CHANNEL') || 'stable';
const dockerImageRepo = () => appConfig.get('UPDATE_DOCKER_IMAGE') || 'hydniz/deltis';

// Module-level update state
let updateInProgress = false;
const logBuffer = [];
const MAX_LOG_LINES = 400;
const sseClients = new Set();

// SSE fan-out is a sink of the persistent update logger: every ulog.log() line
// ends up in the log file AND in the browser log view.
function ssePush(line) {
  logBuffer.push(line);
  if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
  for (const res of sseClients) {
    res.write(`data: ${JSON.stringify({ line })}\n\n`);
  }
}
ulog.addSink(ssePush);

function pushRestart() {
  for (const res of sseClients) {
    res.write('event: restart\ndata: {}\n\n');
  }
}

// Helpers

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
    // HEAD commit on the configured branch via ls-remote (no API auth needed)
    const trackBranch = appConfig.get('UPDATE_BRANCH') || 'main';
    const raw = await capture('git', ['ls-remote', url, `refs/heads/${trackBranch}`]);
    const sha = raw.split('\t')[0].substring(0, 7);
    return { version: null, commitSha: sha, tagName: trackBranch };
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

function currentCommit() {
  return process.env.GIT_COMMIT && process.env.GIT_COMMIT !== 'unknown'
    ? process.env.GIT_COMMIT.substring(0, 7)
    : null;
}

function currentVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
  return pkg.version;
}

// Effective installed version for comparisons. The release stage lives in a
// separate package.json field: version "0.4.0" + stage "alpha" corresponds
// to the release tag v0.4.0-alpha.
function currentVersionWithStage() {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
  return pkg.stage ? `${pkg.version}-${pkg.stage}` : pkg.version;
}

// Semver comparison: returns 1/0/-1 for a newer/equal/older than b, or null
// when either side is not parseable. Implements the semver spec ordering:
// numeric core parts, and a prerelease sorts BELOW its plain release
// (0.4.0-alpha < 0.4.0), with dot-separated prerelease identifiers compared
// numerically where possible (alpha.2 < alpha.10).
function compareSemver(a, b) {
  const parse = (v) => {
    const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
    if (!m) return null;
    return {
      core: [Number(m[1]), Number(m[2]), Number(m[3])],
      pre: m[4] ? m[4].split('.') : null,
    };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;

  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] > pb.core[i] ? 1 : -1;
  }

  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;

  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1; // shorter prerelease list sorts lower
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      if (Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1; // numeric identifiers sort below alphanumeric
    } else if (x !== y) {
      return x > y ? 1 : -1;
    }
  }
  return 0;
}

// null = not determinable, true/false otherwise. An update is only offered
// when the channel's latest version is NEWER than the installed one – an
// older release on the channel (e.g. alpha 0.3.1 while 0.4.0 is installed)
// is not an update.
function computeUpdateAvailable(latest, channel) {
  if (!latest) return null;
  if (channel === 'main') {
    const cur = currentCommit();
    return cur && latest.commitSha ? cur !== latest.commitSha : null;
  }
  if (!latest.version) return null;
  const cmp = compareSemver(latest.version, currentVersionWithStage());
  // Not valid semver on either side → fall back to reporting any difference.
  if (cmp === null) return latest.version !== currentVersionWithStage();
  return cmp > 0;
}

// Maps a GitHub release to the Docker-Hub tag published by CI:
//   stable/beta/alpha → semver without the leading 'v' (dockerhub.yml)
//   main              → short commit SHA (docker-publish.yml)
function dockerImageRefFor(latest, channel) {
  const tag = channel === 'main' ? latest.commitSha : latest.version;
  if (!tag) return null;
  return `${dockerImageRepo()}:${tag}`;
}

// Dumps every collection to backups/pre-update/ and prunes old snapshots.
// Returns the absolute path of the written file. Restorable via restore.sh.
async function createPreUpdateBackup() {
  const file = await createBackup({ db: mongoose.connection.db, dir: PRE_UPDATE_BACKUP_DIR });
  await pruneOldBackups({ dir: PRE_UPDATE_BACKUP_DIR, keep: 5 });
  return file;
}

// Background update check
// Periodically checks GitHub so the admin UI can show an "update available"
// badge without hammering the API on every page load.

let lastCheck = null;
let checkTimers = [];

async function performBackgroundCheck() {
  const url = repoUrl();
  const channel = releaseChannel();
  if (!url) {
    lastCheck = { configured: false, checkedAt: new Date().toISOString() };
    return lastCheck;
  }
  try {
    const latest = await fetchLatestForChannel(url, channel);
    lastCheck = {
      configured: true,
      channel,
      latest,
      updateAvailable: computeUpdateAvailable(latest, channel),
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    lastCheck = {
      configured: true,
      channel,
      error: err.message,
      updateAvailable: null,
      checkedAt: new Date().toISOString(),
    };
  }
  return lastCheck;
}

// Called once from index.js after startup. Timers are unref'd so they never
// keep the process (or tests) alive.
function startBackgroundChecks() {
  if (process.env.NODE_ENV === 'test') return;
  const hours = parseFloat(process.env.UPDATE_CHECK_INTERVAL_HOURS || '6');
  const initial = setTimeout(() => performBackgroundCheck().catch(() => {}), 15000);
  const interval = setInterval(() => performBackgroundCheck().catch(() => {}), hours * 3600 * 1000);
  initial.unref();
  interval.unref();
  checkTimers = [initial, interval];
}

// Routes

// GET /api/admin/update/status
router.get('/status', auth, adminOnly, async (req, res) => {
  const channel = releaseChannel();
  const url = repoUrl();
  const inDocker = isRunningInDocker();
  const mode = await updateEnv.getUpdateMode();
  const st = updateState.read();

  const stateSummary = {
    phase: st.phase || 'idle',
    error: st.error || null,
    recovered: st.recovered ?? null,
    backupFile: st.backupFile || null,
    fromVersion: st.fromVersion || null,
    toVersion: st.toVersion || null,
    // Rollback is offered when a parked old container / previous ref exists.
    rollbackAvailable: !!(st.oldContainerName || st.previousRef),
  };

  // configured=false means UPDATE_REPO_URL is not set – the UI shows a setup hint.
  if (!url) {
    return res.json({
      configured: false,
      currentVersion: currentVersion(),
      currentCommit: null,
      latestCommit: null,
      updateAvailable: null,
      updateInProgress,
      channel,
      inDocker,
      mode,
      updateState: stateSummary,
    });
  }

  let latest = null;
  let checkError = null;

  try {
    latest = await fetchLatestForChannel(url, channel);
  } catch (err) {
    checkError = err.message;
  }

  // latestCommit is the short SHA of the latest available version (null on error).
  const latestCommit = latest?.commitSha ?? null;
  const updateAvailable = checkError ? null : computeUpdateAvailable(latest, channel);

  res.json({
    configured: true,
    currentVersion: currentVersion(),
    currentCommit: currentCommit(),
    channel,
    repoUrl: url,
    inDocker,
    mode,
    updateState: stateSummary,
    // Image the manual instructions / socket update would use.
    dockerImage: latest ? dockerImageRefFor(latest, channel) : `${dockerImageRepo()}:latest`,
    // latest contains the full release detail object (version, tagName, releaseUrl, …)
    latest,
    // latestCommit kept as a flat field for backwards-compatibility with tests
    latestCommit: checkError ? null : latestCommit,
    updateAvailable,
    updateInProgress,
    ...(checkError ? { checkError } : {}),
  });
});

// GET /api/admin/update/check – cached background check (cheap, no GitHub hit
// unless no check ran yet). Drives the sidebar "update available" badge.
router.get('/check', auth, adminOnly, async (req, res) => {
  if (!lastCheck) await performBackgroundCheck();
  res.json(lastCheck);
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
router.post('/start', auth, adminOnly, async (req, res) => {
  if (!repoUrl()) {
    return res.status(400).json({ error: 'UPDATE_REPO_URL ist nicht konfiguriert.' });
  }
  if (updateInProgress) {
    return res.status(409).json({ error: 'Ein Update läuft bereits.' });
  }

  const mode = await updateEnv.getUpdateMode();
  if (mode === 'docker-manual') {
    return res.status(400).json({
      error: 'Kein Docker-Zugriff: Update muss manuell per Docker durchgeführt werden.',
      mode,
    });
  }

  updateInProgress = true;
  logBuffer.length = 0;
  res.json({ ok: true, mode });

  runUpdate(mode).catch(err => {
    ulog.log(`✗ Unerwarteter Fehler: ${err.message}`);
    updateState.write({ phase: 'failed', error: err.message, recovered: null });
    updateInProgress = false;
  });
});

// POST /api/admin/update/rollback
// One-click rollback after a failed (or unwanted) update.
//   body.restoreDb=true additionally restores the pre-update DB snapshot
//   BEFORE the container swap, so the old version boots on its own schema.
router.post('/rollback', auth, adminOnly, async (req, res) => {
  if (updateInProgress) {
    return res.status(409).json({ error: 'Ein Update läuft bereits.' });
  }
  const st = updateState.read();
  const restoreDb = req.body?.restoreDb === true;

  if (!st.oldContainerName && !st.previousRef && !(restoreDb && st.backupFile)) {
    return res.status(400).json({ error: 'Kein Rollback-Ziel vorhanden.' });
  }

  updateInProgress = true;
  logBuffer.length = 0;
  res.json({ ok: true });

  runRollback(st, restoreDb).catch(err => {
    ulog.log(`✗ Rollback-Fehler: ${err.message}`);
    updateState.write({ phase: 'failed', error: `Rollback: ${err.message}` });
    updateInProgress = false;
  });
});

// Update pipeline

const BAR = '══════════════════════════════════════════════';

async function runUpdate(mode) {
  const channel = releaseChannel();
  const url = repoUrl();
  const logFile = ulog.startRun('update');

  try {
    ulog.log(BAR);
    ulog.log('  Deltis OTA Update');
    ulog.log(BAR);
    ulog.log('');
    ulog.log(`→ Modus      : ${mode}`);
    ulog.log(`→ Kanal      : ${channel}`);
    ulog.log(`→ Repository : ${url}`);
    ulog.log(`→ Log-Datei  : ${path.basename(logFile)}`);
    ulog.log('');

    // [1/4] Determine target version
    let latest;
    try {
      ulog.log('→ [1/4] Neueste Version ermitteln …');
      latest = await fetchLatestForChannel(url, channel);
      if (channel === 'main') {
        ulog.log(`  Neuester Commit auf main: ${latest.commitSha}`);
      } else {
        ulog.log(`  Neueste ${channel}-Version : ${latest.tagName}`);
      }
    } catch (err) {
      ulog.log(`✗ GitHub nicht erreichbar: ${err.message}`);
      updateInProgress = false;
      return;
    }

    updateState.reset({
      phase: 'backing-up',
      mode,
      channel,
      fromVersion: currentVersion(),
      fromCommit: currentCommit(),
      toVersion: latest.version || latest.commitSha,
      logFile,
      startedAt: new Date().toISOString(),
    });

    // [2/4] Pre-update backup (hard gate)
    // Safety net: without a verified backup NO update is performed.
    ulog.log('');
    ulog.log('→ [2/4] Datensicherung erstellen …');
    let backupFile;
    try {
      backupFile = await createPreUpdateBackup();
      const size = fs.statSync(backupFile).size;
      if (size <= 0) throw new Error('Backup-Datei ist leer');
      ulog.log(`  Backup gespeichert: backups/pre-update/${path.basename(backupFile)} (${(size / 1024).toFixed(1)} KiB)`);
      updateState.write({ backupFile });
    } catch (err) {
      ulog.log(`✗ Datensicherung fehlgeschlagen: ${err.message}`);
      ulog.log('  Update abgebrochen – die Datenbank bleibt unverändert.');
      updateState.write({ phase: 'failed', error: `Backup fehlgeschlagen: ${err.message}`, recovered: true });
      updateInProgress = false;
      return;
    }

    // [3/4 + 4/4] Mode dispatch
    if (mode === 'docker-socket') {
      await runDockerSocketUpdate(latest, channel);
    } else if (mode === 'host') {
      await runHostUpdate(latest, channel);
    } else {
      ulog.log(`✗ Update im Modus '${mode}' nicht möglich.`);
      updateState.write({ phase: 'failed', error: `Modus ${mode} nicht updatefähig`, recovered: true });
      updateInProgress = false;
    }
  } catch (err) {
    ulog.log('');
    ulog.log(`✗ Update fehlgeschlagen: ${err.message}`);
    updateState.write({ phase: 'failed', error: err.message });
    updateInProgress = false;
  }
}

// Full self-update via docker.sock: pull image, then hand over to a one-shot
// helper container that performs the swap (see server/updater/applyUpdate.js).
async function runDockerSocketUpdate(latest, channel) {
  const ref = dockerImageRefFor(latest, channel);
  if (!ref) throw new Error('Docker-Image-Tag konnte nicht bestimmt werden.');

  ulog.log('');
  ulog.log(`→ [3/4] Neues Image pullen: ${ref} …`);
  updateState.write({ phase: 'pulling', toImage: ref });
  await docker.pullImage(ref, status => ulog.log(`  ${status}`));
  ulog.log('✓ Image gepullt.');

  ulog.log('');
  ulog.log('→ [4/4] Updater-Container starten …');
  const selfId = docker.selfContainerId();
  const self = await docker.inspectContainer(selfId);
  const appName = self.Name.replace(/^\//, '');
  updateState.write({ appContainerName: appName, fromImage: self.Config.Image });

  // The helper needs the backups volume (state + logs) and the Docker socket.
  const backupBinds = (self.HostConfig?.Binds || [])
    .filter(b => b.includes('/app/backups'));
  const helperName = `${appName}-updater`;

  try { await docker.removeContainer(helperName, true); } catch { /* none */ }

  const spec = {
    op: 'update',
    appName,
    newImage: ref,
    logFile: ulog.currentLogFile(),
    healthTimeoutSec: 180,
  };

  const helper = await docker.createContainer(helperName, {
    Image: ref,
    Cmd: ['node', 'server/updater/applyUpdate.js'],
    Env: [`UPDATE_SPEC=${JSON.stringify(spec)}`],
    HostConfig: {
      AutoRemove: true,
      Binds: [
        ...backupBinds,
        `${updateEnv.DOCKER_SOCKET}:/var/run/docker.sock`,
      ],
    },
  });

  ulog.log(`  Helper-Container: ${helperName} (${helper.Id.slice(0, 12)})`);
  ulog.log('  Der Helper stoppt jetzt diesen Container und tauscht ihn aus.');
  ulog.log('  Bei einem Fehler wird automatisch die alte Version wiederhergestellt.');
  updateState.write({ phase: 'applying' });

  // Tell the frontend to enter reconnect-polling BEFORE we get stopped.
  pushRestart();
  await new Promise(r => setTimeout(r, 500));
  await docker.startContainer(helper.Id);
  // From here on the helper owns the process – this container will be stopped.

  // Watchdog: if the helper dies without doing anything (we are still alive
  // and the state never left 'applying'/'pulling'), surface the failure
  // instead of showing "Update läuft…" forever.
  const watchdog = setTimeout(() => {
    const st = updateState.read();
    if (updateInProgress && ['pulling', 'applying'].includes(st.phase)) {
      ulog.log('✗ Updater-Container hat nicht übernommen (Timeout nach 5 Minuten).');
      ulog.log('  Dieser Container läuft unverändert weiter.');
      updateState.write({ phase: 'failed', error: 'Updater-Container hat nicht übernommen', recovered: true });
      updateInProgress = false;
    }
  }, 5 * 60 * 1000);
  watchdog.unref();
}

// Host mode: a detached shell script checks out the target ref, reinstalls
// dependencies, rebuilds the frontend and restarts the app.
async function runHostUpdate(latest, channel) {
  const targetRef = channel === 'main'
    ? (appConfig.get('UPDATE_BRANCH') || 'main')
    : latest.tagName;
  const previousRef = await capture('git', ['-C', APP_DIR, 'rev-parse', 'HEAD']).catch(() => null);
  if (!previousRef) {
    ulog.log('✗ Kein Git-Repository gefunden – Host-Update nicht möglich.');
    updateState.write({ phase: 'failed', error: 'Kein Git-Repository', recovered: true });
    updateInProgress = false;
    return;
  }

  ulog.log('');
  ulog.log(`→ [3/4] Host-Update auf '${targetRef}' vorbereiten …`);
  ulog.log(`  Aktueller Stand: ${previousRef.slice(0, 7)} (Rollback-Ziel)`);
  updateState.write({ phase: 'applying', previousRef, targetRef });

  const script = path.join(APP_DIR, 'scripts', 'self-update-host.sh');
  if (!fs.existsSync(script)) {
    ulog.log(`✗ Update-Skript fehlt: ${script}`);
    updateState.write({ phase: 'failed', error: 'self-update-host.sh fehlt', recovered: true });
    updateInProgress = false;
    return;
  }

  // Never touch the working tree / process from inside the test runner.
  if (process.env.NODE_ENV === 'test') {
    ulog.log('  (Testmodus: Update-Skript wird nicht ausgeführt)');
    updateInProgress = false;
    return;
  }

  ulog.log('→ [4/4] Update-Skript wird gestartet (App wird neu gestartet) …');
  pushRestart();
  await new Promise(r => setTimeout(r, 500));

  const { spawn } = require('child_process');
  const child = spawn('bash', [script, targetRef, previousRef], {
    cwd: APP_DIR,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      UPDATE_LOG_FILE: ulog.currentLogFile() || '',
      UPDATE_STATE_FILE: updateState.STATE_FILE,
      APP_PID: String(process.pid),
    },
  });
  child.unref();
  // From here on the script owns the process – it will stop this app.
}

// Rollback pipeline

async function runRollback(st, restoreDb) {
  const logFile = ulog.startRun('rollback');
  try {
    ulog.log(BAR);
    ulog.log('  Deltis Rollback');
    ulog.log(BAR);
    ulog.log(`→ Log-Datei: ${path.basename(logFile)}`);
    ulog.log('');

    // Optional: restore the pre-update DB snapshot FIRST, while this app
    // still has the DB connection. The old code version then boots on the
    // schema it understands.
    if (restoreDb) {
      if (!st.backupFile || !fs.existsSync(st.backupFile)) {
        throw new Error(`Pre-Update-Backup nicht gefunden: ${st.backupFile || '–'}`);
      }
      ulog.log(`→ [1/2] Datenbank wiederherstellen: ${path.basename(st.backupFile)} …`);
      // Block API writes while collections are dropped and re-imported
      // (same mechanism backup.sh uses – see middleware in index.js).
      const lockFile = path.join(APP_DIR, 'backups', '.backup.lock');
      fs.writeFileSync(lockFile, 'rollback');
      try {
        await restoreBackup({ db: mongoose.connection.db, file: st.backupFile });
        for (const model of Object.values(mongoose.models)) {
          try { await model.syncIndexes(); } catch (e) {
            ulog.log(`  Hinweis: syncIndexes ${model.modelName}: ${e.message}`);
          }
        }
      } finally {
        try { fs.unlinkSync(lockFile); } catch { /* already gone */ }
      }
      ulog.log('✓ Datenbank wiederhergestellt.');
    } else {
      ulog.log('→ [1/2] Datenbank bleibt unverändert (restoreDb=false).');
    }

    // Container / code swap back
    const mode = await updateEnv.getUpdateMode();

    if (st.oldContainerName && mode === 'docker-socket') {
      ulog.log('→ [2/2] Container-Rollback per Docker …');
      const selfId = docker.selfContainerId();
      const self = await docker.inspectContainer(selfId);
      const appName = self.Name.replace(/^\//, '');
      const backupBinds = (self.HostConfig?.Binds || []).filter(b => b.includes('/app/backups'));
      const helperName = `${appName}-updater`;
      try { await docker.removeContainer(helperName, true); } catch { /* none */ }

      const spec = {
        op: 'rollback',
        appName,
        logFile: ulog.currentLogFile(),
        healthTimeoutSec: 180,
      };
      const helper = await docker.createContainer(helperName, {
        Image: self.Config.Image, // current image contains the updater code
        Cmd: ['node', 'server/updater/applyUpdate.js'],
        Env: [`UPDATE_SPEC=${JSON.stringify(spec)}`],
        HostConfig: {
          AutoRemove: true,
          Binds: [...backupBinds, `${updateEnv.DOCKER_SOCKET}:/var/run/docker.sock`],
        },
      });
      ulog.log(`  Helper-Container: ${helperName} (${helper.Id.slice(0, 12)})`);
      pushRestart();
      await new Promise(r => setTimeout(r, 500));
      await docker.startContainer(helper.Id);
      return; // helper takes over
    }

    if (st.previousRef && mode === 'host' && process.env.NODE_ENV !== 'test') {
      ulog.log(`→ [2/2] Host-Rollback auf ${st.previousRef.slice(0, 7)} …`);
      const script = path.join(APP_DIR, 'scripts', 'self-update-host.sh');
      const { spawn } = require('child_process');
      pushRestart();
      await new Promise(r => setTimeout(r, 500));
      const child = spawn('bash', [script, st.previousRef, st.previousRef], {
        cwd: APP_DIR,
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          UPDATE_LOG_FILE: ulog.currentLogFile() || '',
          UPDATE_STATE_FILE: updateState.STATE_FILE,
          APP_PID: String(process.pid),
          UPDATE_IS_ROLLBACK: '1',
        },
      });
      child.unref();
      return; // script takes over
    }

    // No container/code swap possible (e.g. after automatic recovery the old
    // version is already running) – the DB restore above was the rollback.
    ulog.log('→ [2/2] Kein Container-/Code-Wechsel nötig.');
    if (restoreDb) {
      // Schema is back in sync with this code version – re-run migrations
      // (no-op when everything matches) and leave emergency mode.
      const { runMigrations } = require('../migrations/runner');
      await runMigrations({ exitOnFailure: false });
      await appConfig.loadAll();
      serverState.emergencyMode = null;
    }
    updateState.write({ phase: 'rolled-back', error: null, recovered: true });
    ulog.log('✓ Rollback abgeschlossen.');
    ulog.log(BAR);
    updateInProgress = false;
  } catch (err) {
    ulog.log(`✗ Rollback fehlgeschlagen: ${err.message}`);
    updateState.write({ phase: 'failed', error: `Rollback: ${err.message}` });
    updateInProgress = false;
  }
}

// Exported only so tests can inspect / reset module-level state.
router._resetState = () => {
  updateInProgress = false;
  logBuffer.length = 0;
  lastCheck = null;
  for (const t of checkTimers) clearTimeout(t);
  checkTimers = [];
  updateState.clear();
  ulog._reset();
  ulog.addSink(ssePush);
};
router._setInProgress = (v) => { updateInProgress = v; };
router._createPreUpdateBackup = createPreUpdateBackup;
router._PRE_UPDATE_BACKUP_DIR = PRE_UPDATE_BACKUP_DIR;
router._computeUpdateAvailable = computeUpdateAvailable;
router._compareSemver = compareSemver;
router._dockerImageRefFor = dockerImageRefFor;
router._performBackgroundCheck = performBackgroundCheck;
router.startBackgroundChecks = startBackgroundChecks;

module.exports = router;
