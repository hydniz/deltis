#!/bin/bash
# Deltis – Database Backup
#
# Locks write access during backup (the app stays readable).
# Usage: ./backup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Instance config: the compose .env file (if present) defines DELTIS_INSTANCE
# so multiple instances (e.g. prod + beta) on one host use their own containers.
if [ -f "$SCRIPT_DIR/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$SCRIPT_DIR/.env"; set +a
fi
CONTAINER_NAME="${DELTIS_INSTANCE:-deltis}-mongo"
BACKUP_DIR="$SCRIPT_DIR/backups"
LOCK_FILE="$BACKUP_DIR/.backup.lock"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/deltis_${TIMESTAMP}.archive.gz"

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
  $RUNTIME exec "$CONTAINER_NAME" rm -f /tmp/backup.archive 2>/dev/null || true
}
trap cleanup EXIT

# Prerequisites

if ! $RUNTIME container inspect "$CONTAINER_NAME" >/dev/null 2>&1 || \
   ! $RUNTIME container inspect "$CONTAINER_NAME" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
  err "MongoDB container '$CONTAINER_NAME' is not running."
  echo -e "  Start it first with: ${BOLD}./run.sh start${NC}"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# Backup

echo ""
echo -e "${BOLD}=== Deltis – Database Backup ===${NC}"
echo ""

info "Locking write access..."
touch "$LOCK_FILE"

info "Waiting 2 seconds for in-flight requests..."
sleep 2

info "Dumping database (deltis → ${BACKUP_FILE##*/})..."
$RUNTIME exec "$CONTAINER_NAME" mongodump \
  --db deltis \
  --archive=/tmp/backup.archive \
  --gzip \
  --quiet

info "Copying archive out of container..."
$RUNTIME cp "${CONTAINER_NAME}:/tmp/backup.archive" "$BACKUP_FILE"

info "Releasing write lock..."
rm -f "$LOCK_FILE"

# Result

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo ""
ok "Backup created successfully!"
echo -e "   ${CYAN}File:${NC}  $BACKUP_FILE"
echo -e "   ${CYAN}Size:${NC}  $SIZE"
echo ""

BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/*.archive.gz 2>/dev/null | wc -l)
echo -e "  ${BOLD}${BACKUP_COUNT}${NC} backup(s) total in ./backups/"
echo -e "  Restore with: ${BOLD}./restore.sh $BACKUP_FILE${NC}"
echo ""
