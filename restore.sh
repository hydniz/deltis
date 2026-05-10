#!/bin/bash
# Habit Tracker – Datenbank wiederherstellen
#
# Stoppt den Server, spielt das Backup ein, startet den Server neu.
# MongoDB bleibt während der gesamten Wiederherstellung aktiv.
#
# Verwendung:
#   ./restore.sh                    – verfügbare Backups auflisten
#   ./restore.sh backups/<datei>    – Backup einspielen

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_NAME="habit-tracker-mongo"
BACKUP_DIR="$SCRIPT_DIR/backups"
PID_FILE="$SCRIPT_DIR/.run.pid"
LOG_FILE="$SCRIPT_DIR/.run.log"
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

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*" >&2; }
info() { echo -e "${CYAN}→${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }

# Lock + temporäre Containerdatei bei Fehler aufräumen
cleanup() {
  rm -f "$LOCK_FILE"
  $RUNTIME exec "$CONTAINER_NAME" rm -f /tmp/restore.archive 2>/dev/null || true
}
trap cleanup EXIT

# ─── Kein Argument → Backups auflisten ──────────────────────────────────────

if [ -z "${1:-}" ]; then
  echo ""
  echo -e "${BOLD}=== Verfügbare Backups ===${NC}"
  echo ""
  if ls "$BACKUP_DIR"/*.archive.gz 2>/dev/null | head -1 > /dev/null 2>&1; then
    echo -e "  ${CYAN}Größe   Datei${NC}"
    echo -e "  ──────────────────────────────────────────────────────"
    while IFS= read -r f; do
      SIZE=$(du -sh "$f" | cut -f1)
      NAME=$(basename "$f")
      echo -e "  ${SIZE}\t${NAME}"
    done < <(ls -1t "$BACKUP_DIR"/*.archive.gz)
    echo ""
    echo -e "  Verwendung: ${BOLD}./restore.sh backups/<dateiname>${NC}"
  else
    warn "Keine Backups in ./backups/ gefunden."
    echo -e "  Erstelle zuerst ein Backup mit: ${BOLD}./backup.sh${NC}"
  fi
  echo ""
  exit 0
fi

BACKUP_FILE="$1"

# ─── Voraussetzungen prüfen ──────────────────────────────────────────────────

if [ ! -f "$BACKUP_FILE" ]; then
  err "Backup-Datei nicht gefunden: $BACKUP_FILE"
  exit 1
fi

if ! $RUNTIME container inspect "$CONTAINER_NAME" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
  err "MongoDB-Container '$CONTAINER_NAME' läuft nicht."
  echo -e "  Starte zuerst mit: ${BOLD}./run.sh start${NC}"
  exit 1
fi

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)

# ─── Bestätigung ─────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}=== Habit Tracker – Daten wiederherstellen ===${NC}"
echo ""
echo -e "  ${CYAN}Backup-Datei:${NC}  $BACKUP_FILE"
echo -e "  ${CYAN}Größe:${NC}         $SIZE"
echo ""
warn "WARNUNG: Alle aktuellen Daten werden unwiderruflich überschrieben!"
echo ""
read -rp "  Zum Fortfahren 'ja' eingeben: " CONFIRM

if [ "$CONFIRM" != "ja" ]; then
  echo ""
  echo "  Abgebrochen."
  echo ""
  exit 0
fi

echo ""

# ─── Server stoppen (MongoDB bleibt aktiv) ───────────────────────────────────

# Compose-Modus erkennen: App-Container vorhanden?
COMPOSE_MODE=false
if $RUNTIME container inspect habit-tracker-app >/dev/null 2>&1; then
  COMPOSE_MODE=true
fi

info "App stoppen, MongoDB bleibt aktiv..."
if $COMPOSE_MODE; then
  $RUNTIME stop habit-tracker-app 2>/dev/null || true
  ok "App-Container gestoppt"
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
  ok "Server gestoppt"
else
  info "App lief bereits nicht"
fi

# ─── Daten einspielen ────────────────────────────────────────────────────────

info "Backup-Datei in Container kopieren..."
touch "$LOCK_FILE"
$RUNTIME cp "$BACKUP_FILE" "${CONTAINER_NAME}:/tmp/restore.archive"

info "Datenbank wiederherstellen (bestehende Daten werden gelöscht)..."
$RUNTIME exec "$CONTAINER_NAME" mongorestore \
  --db habit_tracker \
  --archive=/tmp/restore.archive \
  --gzip \
  --drop \
  --quiet

ok "Daten erfolgreich wiederhergestellt"
rm -f "$LOCK_FILE"

# ─── Server neu starten ──────────────────────────────────────────────────────

info "App neu starten..."
if $COMPOSE_MODE; then
  $RUNTIME start habit-tracker-app 2>/dev/null
  sleep 2
  if $RUNTIME container inspect habit-tracker-app --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
    ok "App-Container läuft wieder"
  else
    warn "Container konnte nicht gestartet werden."
    echo -e "  Manuell starten mit: ${BOLD}./run.sh compose:up${NC}"
  fi
else
  cd "$SCRIPT_DIR"
  setsid npm run dev >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 2
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    ok "Server läuft wieder"
  else
    warn "Server konnte nicht automatisch gestartet werden."
    echo -e "  Manuell starten mit: ${BOLD}./run.sh start${NC}"
  fi
fi

# ─── Ergebnis ────────────────────────────────────────────────────────────────

echo ""
ok "Wiederherstellung abgeschlossen!"
echo ""
