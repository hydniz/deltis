// Self-update helper – runs as a short-lived SIBLING container.
//
// The app cannot replace its own container from the inside (stopping it would
// kill the process doing the replacing). Instead routes/update.js pulls the
// new image and launches THIS script in a one-shot helper container (created
// from the new image, with docker.sock and the backups volume mounted).
//
//   op=update:   stop app → rename to <name>-old → create fresh container from
//                the new image with the app's runtime config → start → wait for
//                health. On ANY failure the old container is renamed back and
//                restarted (automatic recovery), phase='failed' is recorded and
//                the UI offers the one-click rollback / DB restore.
//
//   op=rollback: stop current app → park it as <name>-failed → rename
//                <name>-old back → start it → wait for health.
//
// All progress is appended to the shared update log file and every phase
// transition is persisted to update-state.json, so the sequence of events can
// be reconstructed even if this helper dies.
//
// Spec (env UPDATE_SPEC, JSON):
//   { op, appName, newImage, stateFile, logFile, healthTimeoutSec }

const docker = require('../utils/dockerClient');
const state = require('../utils/updateState');
const ulog = require('../utils/updateLog');

const OLD_SUFFIX = '-old';
const FAILED_SUFFIX = '-failed';

function spec() {
  const raw = process.env.UPDATE_SPEC;
  if (!raw) throw new Error('UPDATE_SPEC env missing');
  return JSON.parse(raw);
}

// Builds the create-config for the replacement container: the new image plus
// everything runtime-specific from the old container (env diff, mounts, ports,
// restart policy, networks). Image-baked settings (Cmd, User, Healthcheck, …)
// intentionally come from the NEW image.
async function buildReplacementConfig(oldInspect, newImage) {
  const oldImage = await docker.inspectImage(oldInspect.Image);
  const imageEnv = new Set(oldImage.Config?.Env || []);
  // Runtime env = whatever compose/docker run injected on top of the image.
  const runtimeEnv = (oldInspect.Config?.Env || []).filter(e => !imageEnv.has(e));

  const endpoints = {};
  const shortId = oldInspect.Id.slice(0, 12);
  for (const [net, cfg] of Object.entries(oldInspect.NetworkSettings?.Networks || {})) {
    endpoints[net] = {
      Aliases: (cfg.Aliases || []).filter(a => a !== shortId),
    };
  }

  return {
    Image: newImage,
    Env: runtimeEnv,
    Labels: oldInspect.Config?.Labels || {},
    ExposedPorts: oldInspect.Config?.ExposedPorts,
    HostConfig: oldInspect.HostConfig,
    NetworkingConfig: Object.keys(endpoints).length ? { EndpointsConfig: endpoints } : undefined,
  };
}

// Waits until the container reports healthy (or just running when the image
// has no HEALTHCHECK). Returns true on success.
async function waitHealthy(id, timeoutSec, label) {
  const deadline = Date.now() + timeoutSec * 1000;
  let sawRunningAt = null;
  while (Date.now() < deadline) {
    let insp;
    try { insp = await docker.inspectContainer(id); } catch { insp = null; }
    const health = insp?.State?.Health?.Status;
    const running = insp?.State?.Running === true;

    if (health === 'healthy') { ulog.log(`✓ ${label}: Healthcheck OK`); return true; }
    if (health === 'unhealthy') { ulog.log(`✗ ${label}: Healthcheck meldet 'unhealthy'`); return false; }
    if (insp && !running && insp.State?.ExitCode !== undefined && insp.State?.Status === 'exited') {
      ulog.log(`✗ ${label}: Container beendet (Exit-Code ${insp.State.ExitCode})`);
      return false;
    }
    // No HEALTHCHECK in the image: require 15s of stable running instead.
    if (!health && running) {
      if (!sawRunningAt) sawRunningAt = Date.now();
      if (Date.now() - sawRunningAt > 15000) { ulog.log(`✓ ${label}: läuft stabil (kein Healthcheck definiert)`); return true; }
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  ulog.log(`✗ ${label}: Healthcheck-Timeout nach ${timeoutSec}s`);
  return false;
}

async function removeIfExists(name) {
  try {
    await docker.inspectContainer(name);
  } catch {
    return; // does not exist
  }
  ulog.log(`→ Entferne alten Container '${name}' …`);
  await docker.removeContainer(name, true);
}

// ── op=update ─────────────────────────────────────────────────────────────────

async function doUpdate({ appName, newImage, healthTimeoutSec = 180 }) {
  const oldName = `${appName}${OLD_SUFFIX}`;

  ulog.log('→ [Updater] Inspiziere laufenden App-Container …');
  const oldInspect = await docker.inspectContainer(appName);
  const config = await buildReplacementConfig(oldInspect, newImage);
  ulog.log(`  Alt: ${oldInspect.Config.Image} (${oldInspect.Id.slice(0, 12)})`);
  ulog.log(`  Neu: ${newImage}`);

  // Only one rollback target is kept – drop the one from the previous update.
  await removeIfExists(oldName);

  ulog.log('→ [Updater] Stoppe App-Container …');
  state.write({ phase: 'applying', detail: 'stopping-app' });
  await docker.stopContainer(oldInspect.Id, 30);

  ulog.log(`→ [Updater] Benenne '${appName}' → '${oldName}' um (Rollback-Ziel) …`);
  await docker.renameContainer(oldInspect.Id, oldName);

  let newId = null;
  try {
    ulog.log(`→ [Updater] Erstelle neuen Container '${appName}' aus ${newImage} …`);
    const created = await docker.createContainer(appName, config);
    newId = created.Id;

    ulog.log('→ [Updater] Starte neuen Container …');
    state.write({ phase: 'applying', detail: 'starting-new', newContainerId: newId.slice(0, 12) });
    await docker.startContainer(newId);

    ulog.log(`→ [Updater] Warte auf Healthcheck (max. ${healthTimeoutSec}s) …`);
    const healthy = await waitHealthy(newId, healthTimeoutSec, 'Neuer Container');
    if (!healthy) throw new Error('Neuer Container wurde nicht healthy');

    // The new app itself flips the phase to 'success' once migrations passed
    // (see index.js boot reconciliation). 'started-new' means: swap done.
    state.write({ phase: 'started-new', oldContainerName: oldName, recovered: false });
    ulog.log('✓ [Updater] Container-Tausch abgeschlossen. Der neue Container übernimmt.');
    ulog.log(`  Rollback-Ziel bleibt gestoppt erhalten: '${oldName}'`);
    return 0;
  } catch (err) {
    ulog.log(`✗ [Updater] Update fehlgeschlagen: ${err.message}`);
    ulog.log('→ [Updater] Automatische Wiederherstellung: alte Version wird neu gestartet …');

    // Best-effort recovery – every step logged, nothing may throw uncaught.
    let recovered = false;
    try {
      if (newId) {
        ulog.log('  – Entferne fehlgeschlagenen neuen Container …');
        await docker.removeContainer(newId, true);
      }
      ulog.log(`  – Benenne '${oldName}' zurück zu '${appName}' …`);
      await docker.renameContainer(oldName, appName);
      ulog.log('  – Starte alte Version …');
      await docker.startContainer(appName);
      recovered = await waitHealthy(appName, healthTimeoutSec, 'Alte Version');
    } catch (recErr) {
      ulog.log(`✗ [Updater] Wiederherstellung fehlgeschlagen: ${recErr.message}`);
      ulog.log(`  MANUELLER EINGRIFF NÖTIG: docker start ${appName} bzw. ${oldName}`);
    }

    state.write({
      phase: 'failed',
      error: err.message,
      recovered,
      failedAt: new Date().toISOString(),
    });
    if (recovered) ulog.log('✓ [Updater] Alte Version läuft wieder. Details siehe Update-Log.');
    return 1;
  }
}

// ── op=rollback ───────────────────────────────────────────────────────────────

async function doRollback({ appName, healthTimeoutSec = 180 }) {
  const oldName = `${appName}${OLD_SUFFIX}`;
  const failedName = `${appName}${FAILED_SUFFIX}`;

  ulog.log('→ [Updater] Rollback: prüfe Rollback-Ziel …');
  await docker.inspectContainer(oldName); // throws if missing

  await removeIfExists(failedName);

  ulog.log('→ [Updater] Stoppe aktuellen Container …');
  state.write({ phase: 'applying', detail: 'rollback-stopping' });
  try {
    await docker.stopContainer(appName, 30);
    ulog.log(`→ [Updater] Parke aktuellen Container als '${failedName}' …`);
    await docker.renameContainer(appName, failedName);
  } catch (err) {
    // Current container may already be gone/stopped – rollback continues.
    ulog.log(`  Hinweis: ${err.message}`);
  }

  ulog.log(`→ [Updater] Benenne '${oldName}' zurück zu '${appName}' und starte …`);
  await docker.renameContainer(oldName, appName);
  await docker.startContainer(appName);

  const healthy = await waitHealthy(appName, healthTimeoutSec, 'Wiederhergestellte Version');
  state.write({
    phase: healthy ? 'rolled-back' : 'failed',
    error: healthy ? null : 'Rollback: wiederhergestellte Version wurde nicht healthy',
    recovered: healthy,
  });
  ulog.log(healthy
    ? '✓ [Updater] Rollback abgeschlossen – vorherige Version läuft.'
    : '✗ [Updater] Rollback: Container startet nicht sauber. MANUELLER EINGRIFF NÖTIG.');
  return healthy ? 0 : 1;
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const s = spec();
  if (s.logFile) ulog.attachToFile(s.logFile);
  ulog.log(`→ [Updater] Helper gestartet (op=${s.op || 'update'})`);

  if (s.op === 'rollback') return doRollback(s);
  return doUpdate(s);
}

/* istanbul ignore next – exercised via integration, not unit tests */
if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(err => {
      try {
        ulog.log(`✗ [Updater] Unerwarteter Fehler: ${err.message}`);
        state.write({ phase: 'failed', error: err.message, recovered: false });
      } catch { /* nothing left to do */ }
      process.exit(1);
    });
}

module.exports = { doUpdate, doRollback, buildReplacementConfig, waitHealthy, main };
