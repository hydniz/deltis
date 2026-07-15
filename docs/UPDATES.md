# OTA Updates & Rollback

## Update detection

The backend checks GitHub for new releases in the background (default: every
6 h, configurable via `UPDATE_CHECK_INTERVAL_HOURS`). Admins see a pulsing dot
on **Admin → Updates (OTA)** in the sidebar when a newer version exists on the
configured release channel (`stable` = `vX.Y.Z` tags, `beta`/`alpha` =
suffixed tags, `main` = HEAD of the `main` branch). The tracked branch is fixed:
a channel selects a release stream, so pointing an instance at an arbitrary
branch is deliberately not offered.

### A channel switch never downgrades

An update is only ever offered when the channel's latest version is **newer**
than the installed one (`updateBlockReason()` in `server/routes/update.js`).
Switching to a channel that trails the installed build — e.g. stable `v1.2.3` →
alpha `v1.2.0-alpha` — reports `downgrade` and starts nothing; the instance
stays put until that channel overtakes it. The same check blocks re-installing
the version already running (`up-to-date`), which is why **Update starten** is
disabled unless `updateAvailable === true`.

The guard runs inside the update pipeline as well, before the backup step, so
the rule holds even for a caller that bypasses the UI. Going back to an older
version is what the explicit **rollback** is for — never a side effect of
changing channels.

## Update modes

On the updates page the app reports how it is running and picks the strongest
available mechanism automatically (`server/utils/updateEnv.js`):

| Mode | Detected when | Update mechanism |
|---|---|---|
| `docker-socket` | in Docker **and** `/var/run/docker.sock` is mounted and answers | Full self-update: pull image → helper container swaps the app container |
| `docker-manual` | in Docker without any engine control | UI shows manual `docker pull` / `docker compose up` instructions |
| `host` | not in Docker | Git-based self-update (`scripts/self-update-host.sh`) |

Enable `docker-socket` mode by uncommenting the socket mount in
`docker-compose.yml`. Note that mounting the Docker socket grants the app
root-equivalent control over the host's Docker engine — standard trade-off for
self-updating containers.

## Update pipeline (all modes)

1. **Determine target version** from GitHub (release tag or branch HEAD).
2. **Pre-update database backup** — hard gate: if the backup fails or is
   empty, **the update is aborted** and nothing is touched. Snapshots land in
   `backups/pre-update/` (EJSON, restorable via `./restore.sh`, last 5 kept).
3. **Apply** (mode-specific, see above). In `docker-socket` mode the old
   container is kept (stopped, renamed `<name>-old`) as an instant rollback
   target.
4. **Migrations** run automatically when the new version boots. The migration
   runner takes its own pre-migration backup and auto-restores it if a
   migration fails.
5. **Verification** — the swap only counts as done when the new container
   reports `healthy`; the new app itself marks the update `success` after
   migrations passed (boot reconciliation in `server/index.js`).

Every step is written to `backups/update-logs/<run>.log` with timestamps —
by the app, the helper container and the freshly booted new version — so a
failed update can be reconstructed end-to-end. The same lines stream live
into the admin UI (SSE).

## Failure handling ("Notfallbetrieb")

- **Swap fails / new container unhealthy** (docker-socket & host modes): the
  updater automatically restores and restarts the previous version. The UI
  then shows a red "Update fehlgeschlagen" panel.
- **Migration fails on the new version**: the runner restores the
  pre-migration backup; if the app still cannot initialize, it enters
  **emergency mode** instead of crash-looping: only login, version info and
  the update/rollback endpoints stay reachable, everything else answers 503.
  A red banner tells users what happened.
- **One-click rollback** (Admin → Updates):
  - *Rollback (nur App)* — swaps the parked old container / previous git ref
    back in; the database keeps all data written since the update.
  - *Rollback + Datenbank* — additionally restores the pre-update snapshot
    (data written after the update is lost — the UI warns about this). Use
    this when the update ran schema migrations.

State travels in `backups/update-state.json` (host-mounted), so the app knows
after a container swap whether an update was in flight, succeeded, or failed.

## Port auto-discovery

If the configured port (default 3001) is taken at startup, the server probes
the next 20 ports, binds the first free one and announces it via:
- a prominent startup log box,
- the `.run.port` file next to the app,
- the `port` field in `GET /api/`.

## Relevant files

| File | Purpose |
|---|---|
| `server/utils/updateEnv.js` | Docker/socket detection, mode selection |
| `server/utils/dockerClient.js` | Minimal Docker Engine API client (unix socket) |
| `server/utils/updateState.js` | Persistent update state (`backups/update-state.json`) |
| `server/utils/updateLog.js` | Persistent step-by-step update logs |
| `server/routes/update.js` | Orchestrator + status/check/start/rollback/stream endpoints |
| `server/updater/applyUpdate.js` | Helper-container: swap / rollback with auto-recovery |
| `scripts/self-update-host.sh` | Host-mode update/rollback script |
| `server/middleware/emergencyGuard.js` | Reduced API in emergency mode |
| `server/utils/portFinder.js` | Port auto-discovery |
