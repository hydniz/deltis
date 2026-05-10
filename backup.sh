#!/bin/bash
# Habit Tracker – Datenbank-Backup
#
# Sperrt während des Backups alle Schreibzugriffe (Server bleibt lesend erreichbar).
# Verwendung: ./backup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_NAME="habit-tracker-mongo"
BACKUP_DIR="$SCRIPT_DIR/backups"
LOCK_FILE="$BACKUP_DIR/.backup.lock"

# docker oder $RUNTIME verwenden (was verfügbar ist)
if command -v $RUNTIME &>/dev/null; then
  RUNTIME="$RUNTIME"
elif command -v docker &>/dev/null; then
  RUNTIME="docker"
else
  echo "Fehler: Weder docker noch $RUNTIME gefunden." >&2
  exit 1
fi
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/habit_tracker_${TIMESTAMP}.archive.gz"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*" >&2; }
info() { echo -e "${CYAN}→${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }

# Lock + temporäre Containerdatei bei Fehler oder Abbruch aufräumen
cleanup() {
  rm -f "$LOCK_FILE"
  $RUNTIME exec "$CONTAINER_NAME" rm -f /tmp/backup.archive 2>/dev/null || true
}
trap cleanup EXIT

# ─── Voraussetzungen prüfen ──────────────────────────────────────────────────

if ! $RUNTIME container inspect "$CONTAINER_NAME" >/dev/null 2>&1 || \
   ! $RUNTIME container inspect "$CONTAINER_NAME" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
  err "MongoDB-Container '$CONTAINER_NAME' läuft nicht."
  echo -e "  Starte zuerst mit: ${BOLD}./run.sh start${NC}"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# ─── Backup ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}=== Habit Tracker – Datenbank-Backup ===${NC}"
echo ""

info "Schreibzugriffe sperren (Backup-Modus aktiv)..."
touch "$LOCK_FILE"

info "Warte 2 Sekunden auf laufende Requests..."
sleep 2

info "Datenbank sichern (habit_tracker → ${BACKUP_FILE##*/})..."
$RUNTIME exec "$CONTAINER_NAME" mongodump \
  --db habit_tracker \
  --archive=/tmp/backup.archive \
  --gzip \
  --quiet

info "Backup-Datei aus Container kopieren..."
$RUNTIME cp "${CONTAINER_NAME}:/tmp/backup.archive" "$BACKUP_FILE"

info "Schreibzugriffe freigeben..."
rm -f "$LOCK_FILE"

# ─── Ergebnis ───────────────────────────────────────────────────────────────

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo ""
ok "Backup erfolgreich erstellt!"
echo -e "   ${CYAN}Datei:${NC}  $BACKUP_FILE"
echo -e "   ${CYAN}Größe:${NC}  $SIZE"
echo ""

BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/*.archive.gz 2>/dev/null | wc -l)
echo -e "  Insgesamt ${BOLD}${BACKUP_COUNT}${NC} Backup(s) in ./backups/"
echo -e "  Wiederherstellen mit: ${BOLD}./restore.sh $BACKUP_FILE${NC}"
echo ""
