#!/bin/bash
# Habit Tracker – Database Restore
#
# Stops the app, restores a backup, then restarts the app.
# MongoDB stays running throughout.
#
# Supports two backup formats:
#   *.archive.gz   – mongodump archives created by backup.sh / CI pre-deploy backups
#   *.ejson.gz     – EJSON snapshots created automatically before each migration
#                    and before each OTA update
#
# Usage:
#   ./restore.sh                      – list available backups
#   ./restore.sh backups/<file>       – restore from backup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Instance config: the compose .env file (if present) defines DELTIS_INSTANCE
# and DELTIS_IMAGE so multiple instances on one host use their own containers.
if [ -f "$SCRIPT_DIR/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$SCRIPT_DIR/.env"; set +a
fi
CONTAINER_NAME="${DELTIS_INSTANCE:-habit-tracker}-mongo"
APP_CONTAINER="${DELTIS_INSTANCE:-habit-tracker}-app"
APP_IMAGE="${DELTIS_IMAGE:-habit-tracker:latest}"
BACKUP_DIR="$SCRIPT_DIR/backups"
PRE_MIGRATION_DIR="$BACKUP_DIR/pre-migration"
PRE_UPDATE_DIR="$BACKUP_DIR/pre-update"
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

  HAS_ANY=false

  if ls "$BACKUP_DIR"/*.archive.gz 2>/dev/null | head -1 > /dev/null 2>&1; then
    HAS_ANY=true
    echo -e "  ${BOLD}Regular backups (mongodump):${NC}"
    echo -e "  ${CYAN}Size    File${NC}"
    echo -e "  ──────────────────────────────────────────────────────"
    while IFS= read -r f; do
      SIZE=$(du -sh "$f" | cut -f1)
      NAME=$(basename "$f")
      echo -e "  ${SIZE}\t${NAME}"
    done < <(ls -1t "$BACKUP_DIR"/*.archive.gz)
    echo ""
  fi

  if ls "$PRE_MIGRATION_DIR"/*.ejson.gz 2>/dev/null | head -1 > /dev/null 2>&1; then
    HAS_ANY=true
    echo -e "  ${BOLD}Pre-migration snapshots (EJSON):${NC}"
    echo -e "  ${CYAN}Size    File${NC}"
    echo -e "  ──────────────────────────────────────────────────────"
    while IFS= read -r f; do
      SIZE=$(du -sh "$f" | cut -f1)
      NAME="pre-migration/$(basename "$f")"
      echo -e "  ${SIZE}\t${NAME}"
    done < <(ls -1t "$PRE_MIGRATION_DIR"/*.ejson.gz)
    echo ""
  fi

  if ls "$PRE_UPDATE_DIR"/*.ejson.gz 2>/dev/null | head -1 > /dev/null 2>&1; then
    HAS_ANY=true
    echo -e "  ${BOLD}Pre-update snapshots (EJSON):${NC}"
    echo -e "  ${CYAN}Size    File${NC}"
    echo -e "  ──────────────────────────────────────────────────────"
    while IFS= read -r f; do
      SIZE=$(du -sh "$f" | cut -f1)
      NAME="pre-update/$(basename "$f")"
      echo -e "  ${SIZE}\t${NAME}"
    done < <(ls -1t "$PRE_UPDATE_DIR"/*.ejson.gz)
    echo ""
  fi

  if ! $HAS_ANY; then
    warn "No backups found in ./backups/"
    echo -e "  Create one first with: ${BOLD}./backup.sh${NC}"
  else
    echo -e "  Usage: ${BOLD}./restore.sh backups/<filename>${NC}"
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
  echo -e "  Start it first with: ${BOLD}docker compose up -d mongo${NC}"
  exit 1
fi

# Detect format
case "$BACKUP_FILE" in
  *.ejson.gz) FORMAT="ejson" ;;
  *.archive.gz) FORMAT="archive" ;;
  *)
    err "Unrecognised backup format: $BACKUP_FILE"
    err "Expected *.ejson.gz (pre-migration) or *.archive.gz (regular)"
    exit 1
    ;;
esac

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)

# ── Confirmation ─────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}=== Habit Tracker – Restore Database ===${NC}"
echo ""
echo -e "  ${CYAN}Backup file:${NC}  $BACKUP_FILE"
echo -e "  ${CYAN}Format:${NC}       $FORMAT"
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

COMPOSE_MODE=false
if $RUNTIME container inspect "$APP_CONTAINER" >/dev/null 2>&1; then
  COMPOSE_MODE=true
fi

info "Stopping app (MongoDB stays active)..."
if $COMPOSE_MODE; then
  $RUNTIME stop "$APP_CONTAINER" 2>/dev/null || true
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

touch "$LOCK_FILE"

if [ "$FORMAT" = "archive" ]; then
  info "Restoring from mongodump archive..."
  $RUNTIME cp "$BACKUP_FILE" "${CONTAINER_NAME}:/tmp/restore.archive"
  $RUNTIME exec "$CONTAINER_NAME" mongorestore \
    --db habit_tracker \
    --archive=/tmp/restore.archive \
    --gzip \
    --drop \
    --quiet

elif [ "$FORMAT" = "ejson" ]; then
  info "Restoring from EJSON pre-migration snapshot..."

  # Run a one-off app container sharing the mongo container's network stack
  # so Node.js can reach MongoDB on 127.0.0.1:27017.
  BACKUP_ABS="$(realpath "$BACKUP_FILE")"
  $RUNTIME run --rm \
    --network "container:${CONTAINER_NAME}" \
    -v "${BACKUP_ABS}:/tmp/restore.ejson.gz:ro" \
    "$APP_IMAGE" \
    node -e "
      const mongoose = require('mongoose');
      const { restoreBackup } = require('./server/migrations/backup');
      mongoose.connect('mongodb://127.0.0.1:27017/habit_tracker')
        .then(() => restoreBackup({ db: mongoose.connection.db, file: '/tmp/restore.ejson.gz' }))
        .then(() => { console.log('Restore complete.'); process.exit(0); })
        .catch(err => { console.error(err.message); process.exit(1); });
    "
fi

ok "Data restored successfully"
rm -f "$LOCK_FILE"

# ── Restart app ───────────────────────────────────────────────────────────────

info "Restarting app..."
if $COMPOSE_MODE; then
  $RUNTIME start "$APP_CONTAINER" 2>/dev/null
  sleep 2
  if $RUNTIME container inspect "$APP_CONTAINER" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
    ok "App container is running again"
  else
    warn "Container could not be started automatically."
    echo -e "  Start manually with: ${BOLD}docker compose up -d${NC}"
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
