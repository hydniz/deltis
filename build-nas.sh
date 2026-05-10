#!/bin/bash
# Habit Tracker – Build and export Docker image for NAS deployment
#
# Builds a linux/amd64 image (compatible with most NAS devices) and saves
# it as a .tar.gz archive for transfer to the NAS.
#
# Usage: ./build-nas.sh [--arm64]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM="linux/amd64"
IMAGE="habit-tracker:latest"

# Use podman if available, fall back to docker
if command -v podman &>/dev/null; then
  RUNTIME="podman"
elif command -v docker &>/dev/null; then
  RUNTIME="docker"
else
  echo "Error: neither docker nor podman found." >&2
  exit 1
fi

if [ "${1:-}" = "--arm64" ]; then
  PLATFORM="linux/arm64"
  echo "Target architecture: arm64 (e.g. older Synology/QNAP with ARM CPU)"
else
  echo "Target architecture: amd64 (default for most NAS devices)"
fi

EXPORT_FILE="$SCRIPT_DIR/habit-tracker-$(date +%Y%m%d).tar.gz"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

echo ""
echo -e "${BOLD}=== Habit Tracker – NAS Build ===${NC}"
echo ""

echo -e "${CYAN}→${NC} Building image (${PLATFORM})..."
$RUNTIME build --platform "$PLATFORM" -t "$IMAGE" "$SCRIPT_DIR"

echo -e "${CYAN}→${NC} Exporting to $(basename "$EXPORT_FILE")..."
$RUNTIME save "$IMAGE" | gzip > "$EXPORT_FILE"

SIZE=$(du -sh "$EXPORT_FILE" | cut -f1)

echo ""
echo -e "${GREEN}✓ Done!${NC}"
echo -e "  File:  $EXPORT_FILE  (${SIZE})"
echo ""
echo -e "${BOLD}Next steps:${NC}"
echo ""
echo -e "  1. Copy files to your NAS:"
echo -e "     ${CYAN}scp $(basename "$EXPORT_FILE") .env.production.example docker-compose.yml backup.sh restore.sh <user>@<nas-ip>:/path/habit-tracker/${NC}"
echo ""
echo -e "  2. On the NAS: rename .env.production.example → .env.production and fill in values"
echo -e "     ${CYAN}cp .env.production.example .env.production${NC}"
echo ""
echo -e "  3. Load the image:"
echo -e "     ${CYAN}docker load < $(basename "$EXPORT_FILE")${NC}"
echo ""
echo -e "  4. Start the stack:"
echo -e "     ${CYAN}docker compose up -d${NC}"
echo ""
echo -e "  App available at: ${BOLD}http://<nas-ip>:3001${NC}"
echo ""
