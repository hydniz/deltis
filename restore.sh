#!/bin/bash
# Habit Tracker – Database Restore
#
# Stops the app, restores a backup, then restarts the app.
# MongoDB stays running throughout.
#
# Usage:
#   ./restore.sh                      – list available backups
#   ./restore.sh backups/<file>       – restore from backup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_NAME="habit-tracker-mongo"
BACKUP_DIR="$SCRIPT_DIR/backups"
PID_FILE="$SCRIPT_DIR/.run.pid"
LOG_FILE="$SCRIPT_DIR/.run.log"
LOCK_FILE="$BACKUP_DIR/.backup.lock"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*" >&2; }
info() { echo -e "${CYAN}→${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }

# Use podman if available, fall back to docker
if command -v podman &>/dev/null; then
  RUNTIME="podman"
elif command -v docker &>/dev/null; then
  RUNTIME="docker"
else
  err "Neither docker nor podman found."
  exit 1
fi

# Remove lock file and temp archive on exit or error
cleanup() {
  rm -f "$LOCK_FILE"
  $RUNTIME exec "$CONTAINER_NAME" rm -f /tmp/restore.archive 2>/dev/null || true
}
trap cleanup EXIT

# ── No argument → list backups ───────────────────────────────────────────────

if [ -z "${1:-}" ]; then
  echo ""
  echo -e "${BOLD}=== Available Backups ===${NC}"
  echo ""
  if ls "$BACKUP_DIR"/*.archive.gz 2>/dev/null | head -1 > /dev/null 2>&1; then
    echo -e "  ${CYAN}Size    File${NC}"
    echo -e "  ──────────────────────────────────────────────────────"
    while IFS= read -r f; do
      SIZE=$(du -sh "$f" | cut -f1)
      NAME=$(basename "$f")
      echo -e "  ${SIZE}\t${NAME}"
    done < <(ls -1t "$BACKUP_DIR"/*.archive.gz)
    echo ""
    echo -e "  Usage: ${BOLD}./restore.sh backups/<filename>${NC}"
  else
    warn "No backups found in ./backups/"
    echo -e "  Create one first with: ${BOLD}./backup.sh${NC}"
  fi
  echo ""
  exit 0
fi

BACKUP_FILE="$1"

# ── Prerequisites ────────────────────────────────────────────────────────────

if [ ! -f "$BACKUP_FILE" ]; then
  err "Backup file not found: $BACKUP_FILE"
  exit 1
fi

if ! $RUNTIME container inspect "$CONTAINER_NAME" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
  err "MongoDB container '$CONTAINER_NAME' is not running."
  echo -e "  Start it first with: ${BOLD}./run.sh start${NC}"
  exit 1
fi

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)

# ── Confirmation ─────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}=== Habit Tracker – Restore Database ===${NC}"
echo ""
echo -e "  ${CYAN}Backup file:${NC}  $BACKUP_FILE"
echo -e "  ${CYAN}Size:${NC}         $SIZE"
echo ""
warn "WARNING: All current data will be permanently overwritten!"
echo ""
read -rp "  Type 'yes' to continue: " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo ""
  echo "  Aborted."
  echo ""
  exit 0
fi

echo ""

# ── Stop app (keep MongoDB running) ──────────────────────────────────────────

# Detect compose mode: is the app container present?
COMPOSE_MODE=false
if $RUNTIME container inspect habit-tracker-app >/dev/null 2>&1; then
  COMPOSE_MODE=true
fi

info "Stopping app (MongoDB stays active)..."
if $COMPOSE_MODE; then
  $RUNTIME stop habit-tracker-app 2>/dev/null || true
  ok "App container stopped"
elif [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    PGID=$(ps -o pgid= -p "$PID" 2>/dev/null | tr -d ' ' || echo "")
    [ -n "$PGID" ] && [ "$PGID" != "0" ] && kill -TERM "-${PGID}" 2>/dev/null || true
    kill -TERM "$PID" 2>/dev/null || true
    for i in $(seq 1 10); do
      kill -0 "$PID" 2>/dev/null || break
      sleep 0.5
    done
    kill -KILL "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  ok "Server stopped"
else
  info "App was not running"
fi

# ── Restore data ─────────────────────────────────────────────────────────────

info "Copying backup into container..."
touch "$LOCK_FILE"
$RUNTIME cp "$BACKUP_FILE" "${CONTAINER_NAME}:/tmp/restore.archive"

info "Restoring database (existing data will be dropped)..."
$RUNTIME exec "$CONTAINER_NAME" mongorestore \
  --db habit_tracker \
  --archive=/tmp/restore.archive \
  --gzip \
  --drop \
  --quiet

ok "Data restored successfully"
rm -f "$LOCK_FILE"

# ── Restart app ───────────────────────────────────────────────────────────────

info "Restarting app..."
if $COMPOSE_MODE; then
  $RUNTIME start habit-tracker-app 2>/dev/null
  sleep 2
  if $RUNTIME container inspect habit-tracker-app --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
    ok "App container is running again"
  else
    warn "Container could not be started automatically."
    echo -e "  Start manually with: ${BOLD}./run.sh compose:up${NC}"
  fi
else
  cd "$SCRIPT_DIR"
  setsid npm run dev >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 2
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    ok "Server is running again"
  else
    warn "Server could not be started automatically."
    echo -e "  Start manually with: ${BOLD}./run.sh start${NC}"
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
ok "Restore complete!"
echo ""
