#!/bin/bash
# Habit Tracker – Deployment Rollback
#
# Rolls the app back to the image that was running before the last deploy
# and optionally restores the pre-deploy database backup.
#
# The deploy pipeline (scripts/deploy-remote.sh) writes .rollback-info before
# every update:
#   PREVIOUS_IMAGE=<image ref running before the deploy>
#   BACKUP_FILE=<pre-deploy mongodump archive>
#
# Usage:
#   ./rollback.sh             – roll back the app image (DB untouched)
#   ./rollback.sh --with-db   – roll back the image AND restore the pre-deploy DB backup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLLBACK_INFO="$SCRIPT_DIR/.rollback-info"
ENV_FILE="$SCRIPT_DIR/.env"

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

WITH_DB=false
[ "${1:-}" = "--with-db" ] && WITH_DB=true

# ── Read rollback info ───────────────────────────────────────────────────────

if [ ! -f "$ROLLBACK_INFO" ]; then
  err "No rollback info found ($ROLLBACK_INFO)."
  echo -e "  This file is written automatically before every CI deploy."
  exit 1
fi

# shellcheck disable=SC1090
. "$ROLLBACK_INFO"

if [ -z "${PREVIOUS_IMAGE:-}" ]; then
  err "PREVIOUS_IMAGE missing in $ROLLBACK_INFO."
  exit 1
fi

if ! $RUNTIME image inspect "$PREVIOUS_IMAGE" >/dev/null 2>&1; then
  err "Previous image '$PREVIOUS_IMAGE' is no longer available locally."
  echo -e "  Re-load it from a release asset or Docker Hub first."
  exit 1
fi

# ── Confirmation ─────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}=== Habit Tracker – Rollback ===${NC}"
echo ""
echo -e "  ${CYAN}Roll back to image:${NC}  $PREVIOUS_IMAGE"
if $WITH_DB; then
  if [ -z "${BACKUP_FILE:-}" ] || [ ! -f "$SCRIPT_DIR/$BACKUP_FILE" ]; then
    err "Pre-deploy DB backup not found: ${BACKUP_FILE:-<none>}"
    exit 1
  fi
  echo -e "  ${CYAN}Restore DB backup:${NC}   $BACKUP_FILE"
  warn "The current database content will be overwritten!"
else
  echo -e "  ${CYAN}Database:${NC}            untouched (use --with-db to restore the pre-deploy backup)"
fi
echo ""
read -rp "  Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo ""
  echo "  Aborted."
  exit 0
fi
echo ""

# ── Point compose back at the previous image ─────────────────────────────────

info "Setting DELTIS_IMAGE=$PREVIOUS_IMAGE in .env ..."
touch "$ENV_FILE"
if grep -q '^DELTIS_IMAGE=' "$ENV_FILE"; then
  sed -i "s|^DELTIS_IMAGE=.*|DELTIS_IMAGE=$PREVIOUS_IMAGE|" "$ENV_FILE"
else
  echo "DELTIS_IMAGE=$PREVIOUS_IMAGE" >> "$ENV_FILE"
fi

info "Recreating app container ..."
if [ "$RUNTIME" = "docker" ]; then
  (cd "$SCRIPT_DIR" && docker compose up -d --no-build --force-recreate app)
else
  (cd "$SCRIPT_DIR" && podman compose up -d --no-build --force-recreate app)
fi
ok "App is running on $PREVIOUS_IMAGE again."

# ── Optional DB restore ──────────────────────────────────────────────────────

if $WITH_DB; then
  echo ""
  info "Restoring pre-deploy database backup via restore.sh ..."
  # restore.sh asks for its own confirmation, stops the app during restore
  # and restarts it afterwards.
  "$SCRIPT_DIR/restore.sh" "$SCRIPT_DIR/$BACKUP_FILE"
fi

echo ""
ok "Rollback complete."
echo ""
