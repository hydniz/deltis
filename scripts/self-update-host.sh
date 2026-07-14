#!/bin/bash
# Habit Tracker – Host-mode self-update (started detached by routes/update.js)
#
# Runs OUTSIDE the node process it is about to replace:
#   1. stop the running app
#   2. git fetch + checkout <target-ref>
#   3. npm ci (server) + npm ci/build (client)
#   4. restart the app in production mode
#   5. health check – on ANY failure roll back to <previous-ref> automatically
#
# Every step is appended to the shared update log ($UPDATE_LOG_FILE) and every
# phase transition is persisted to update-state.json ($UPDATE_STATE_FILE), so
# the whole run can be reconstructed afterwards.
#
# Usage (spawned by the app, not by hand):
#   self-update-host.sh <target-ref> <previous-ref>
# Env: UPDATE_LOG_FILE, UPDATE_STATE_FILE, APP_PID, UPDATE_IS_ROLLBACK

set -uo pipefail   # NOT -e: every failure path must be logged + handled

TARGET_REF="${1:?usage: self-update-host.sh <target-ref> <previous-ref>}"
PREVIOUS_REF="${2:?missing previous-ref}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$APP_DIR/.run.pid"
PORT_FILE="$APP_DIR/.run.port"
RUN_LOG="$APP_DIR/.run.log"

cd "$APP_DIR"

# Logging / state helpers

log() {
  local ts; ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  [ -n "${UPDATE_LOG_FILE:-}" ] && echo "[$ts] $1" >> "$UPDATE_LOG_FILE" 2>/dev/null
  echo "$1"
}

set_state() {
  [ -n "${UPDATE_STATE_FILE:-}" ] || return 0
  node -e '
    const fs = require("fs");
    const f = process.env.UPDATE_STATE_FILE;
    let s = {}; try { s = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
    Object.assign(s, JSON.parse(process.argv[1]), { updatedAt: new Date().toISOString() });
    fs.writeFileSync(f, JSON.stringify(s, null, 2));
  ' "$1" 2>/dev/null || log "! Konnte update-state.json nicht schreiben"
}

# App start/stop

stop_app() {
  log "→ [Host-Update] Stoppe App …"
  local pid="${APP_PID:-}"
  [ -z "$pid" ] && [ -f "$PID_FILE" ] && pid="$(cat "$PID_FILE")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    local pgid; pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
    [ -n "$pgid" ] && [ "$pgid" != "0" ] && kill -TERM "-${pgid}" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -KILL "$pid" 2>/dev/null || true
    log "  App gestoppt (PID $pid)"
  else
    log "  App lief nicht (mehr)"
  fi
  rm -f "$PID_FILE"
}

start_app() {
  log "→ [Host-Update] Starte App (production) …"
  setsid env NODE_ENV=production node server/index.js >> "$RUN_LOG" 2>&1 &
  echo $! > "$PID_FILE"
}

health_check() {
  log "→ [Host-Update] Warte auf Healthcheck …"
  local port
  for i in $(seq 1 40); do
    sleep 3
    port="$(cat "$PORT_FILE" 2>/dev/null || echo 3001)"
    if curl -fsS -m 3 "http://localhost:${port}/api/" >/dev/null 2>&1 \
       || wget -qO /dev/null -T 3 "http://localhost:${port}/api/" 2>/dev/null; then
      log "✓ App antwortet auf Port ${port}."
      return 0
    fi
    # Process died? No point in waiting the full timeout.
    if [ -f "$PID_FILE" ] && ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      log "✗ App-Prozess ist beendet (siehe .run.log)."
      return 1
    fi
  done
  log "✗ Healthcheck-Timeout nach 120s."
  return 1
}

checkout_and_build() {
  local ref="$1"
  log "→ [Host-Update] git fetch …"
  git fetch --all --tags --prune >> "$RUN_LOG" 2>&1 || { log "✗ git fetch fehlgeschlagen"; return 1; }
  log "→ [Host-Update] git checkout ${ref} …"
  git checkout --force "$ref" >> "$RUN_LOG" 2>&1 || { log "✗ git checkout ${ref} fehlgeschlagen"; return 1; }
  # When following a branch (main channel), fast-forward to its remote tip.
  if git show-ref --verify --quiet "refs/heads/$ref"; then
    git pull --ff-only >> "$RUN_LOG" 2>&1 || log "! git pull --ff-only fehlgeschlagen (fahre fort)"
  fi
  log "  Stand: $(git rev-parse --short HEAD)"
  log "→ [Host-Update] Installiere Server-Dependencies (npm ci) …"
  npm ci --omit=dev >> "$RUN_LOG" 2>&1 || { log "✗ npm ci fehlgeschlagen"; return 1; }
  log "→ [Host-Update] Baue Frontend (npm ci + build) …"
  npm ci --prefix client >> "$RUN_LOG" 2>&1 || { log "✗ npm ci (client) fehlgeschlagen"; return 1; }
  npm run build --prefix client >> "$RUN_LOG" 2>&1 || { log "✗ Frontend-Build fehlgeschlagen"; return 1; }
  return 0
}

# Main

sleep 2   # give the HTTP response + SSE restart event time to flush

if [ "${UPDATE_IS_ROLLBACK:-}" = "1" ]; then
  log "→ [Host-Update] ROLLBACK auf ${TARGET_REF} beginnt …"
else
  log "→ [Host-Update] Update auf ${TARGET_REF} beginnt (Rollback-Ziel: ${PREVIOUS_REF:0:7}) …"
fi
set_state "{\"phase\":\"applying\",\"detail\":\"host-script\"}"

stop_app

if checkout_and_build "$TARGET_REF"; then
  start_app
  if health_check; then
    # index.js reconciliation marks phase=success once migrations passed.
    log "✓ [Host-Update] Neue Version gestartet – Migrationen laufen beim Boot."
    set_state "{\"phase\":\"started-new\"}"
    exit 0
  fi
  log "✗ [Host-Update] Neue Version startet nicht sauber."
else
  log "✗ [Host-Update] Checkout/Build fehlgeschlagen."
fi

# Automatic recovery

if [ "${UPDATE_IS_ROLLBACK:-}" = "1" ]; then
  log "✗ [Host-Update] Rollback fehlgeschlagen. MANUELLER EINGRIFF NÖTIG (siehe .run.log)."
  set_state "{\"phase\":\"failed\",\"error\":\"Host-Rollback fehlgeschlagen\",\"recovered\":false}"
  exit 1
fi

log "→ [Host-Update] Automatische Wiederherstellung: zurück zu ${PREVIOUS_REF:0:7} …"
stop_app
if checkout_and_build "$PREVIOUS_REF" && start_app && health_check; then
  log "✓ [Host-Update] Alte Version läuft wieder."
  set_state "{\"phase\":\"failed\",\"error\":\"Update fehlgeschlagen – alte Version wiederhergestellt\",\"recovered\":true}"
  exit 1
fi

log "✗ [Host-Update] KRITISCH: Wiederherstellung fehlgeschlagen. Manuell starten: ./run.sh prod"
set_state "{\"phase\":\"failed\",\"error\":\"Update und Wiederherstellung fehlgeschlagen\",\"recovered\":false}"
exit 1
