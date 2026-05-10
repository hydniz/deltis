#!/bin/bash
# Habit Tracker – Docker-Image für NAS bauen und exportieren
#
# Baut ein linux/amd64 Image (kompatibel mit den meisten NAS-Geräten)
# und speichert es als .tar.gz für den Transfer auf das NAS.
#
# Verwendung: ./build-nas.sh [--arm64]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM="linux/amd64"
IMAGE="habit-tracker:latest"

# docker oder podman verwenden (was verfügbar ist)
if command -v podman &>/dev/null; then
  RUNTIME="podman"
elif command -v docker &>/dev/null; then
  RUNTIME="docker"
else
  echo "Fehler: Weder docker noch podman gefunden." >&2
  exit 1
fi

if [ "${1:-}" = "--arm64" ]; then
  PLATFORM="linux/arm64"
  echo "Zielarchitektur: arm64 (z.B. ältere Synology/QNAP mit ARM-CPU)"
else
  echo "Zielarchitektur: amd64 (Standard für neuere NAS-Geräte)"
fi

EXPORT_FILE="$SCRIPT_DIR/habit-tracker-$(date +%Y%m%d).tar.gz"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

echo ""
echo -e "${BOLD}=== Habit Tracker – NAS Build ===${NC}"
echo ""

echo -e "${CYAN}→${NC} Image bauen (${PLATFORM})..."
$RUNTIME build --platform "$PLATFORM" -t "$IMAGE" "$SCRIPT_DIR"

echo -e "${CYAN}→${NC} Image exportieren nach $(basename "$EXPORT_FILE")..."
$RUNTIME save "$IMAGE" | gzip > "$EXPORT_FILE"

SIZE=$(du -sh "$EXPORT_FILE" | cut -f1)

echo ""
echo -e "${GREEN}✓ Fertig!${NC}"
echo -e "  Image:  $EXPORT_FILE  (${SIZE})"
echo ""
echo -e "${BOLD}Nächste Schritte:${NC}"
echo ""
echo -e "  1. Image + Konfiguration auf NAS kopieren:"
echo -e "     ${CYAN}scp $(basename "$EXPORT_FILE") .env.production.example docker-compose.yml <user>@<nas-ip>:/pfad/habit-tracker/${NC}"
echo ""
echo -e "  2. Auf dem NAS: .env.production.example → .env.production umbenennen und ausfüllen"
echo -e "     ${CYAN}cp .env.production.example .env.production${NC}"
echo -e "     ${CYAN}nano .env.production  # VALID_UUIDS eintragen${NC}"
echo ""
echo -e "  3. Image auf NAS importieren:"
echo -e "     ${CYAN}docker load < $(basename "$EXPORT_FILE")${NC}"
echo ""
echo -e "  4. Stack starten:"
echo -e "     ${CYAN}docker compose up -d${NC}"
echo ""
echo -e "  App erreichbar unter: ${BOLD}http://<nas-ip>:3001${NC}"
echo ""
