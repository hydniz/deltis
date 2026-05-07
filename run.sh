#!/bin/bash
# Habit Tracker – Start/Stop Skript
# Verwendung: ./run.sh [start|stop|restart|status|logs|prod]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_NAME="habit-tracker-mongo"
MONGO_VOLUME="habit-tracker-mongo-data"
PID_FILE="$SCRIPT_DIR/.run.pid"
LOG_FILE="$SCRIPT_DIR/.run.log"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*"; }
info() { echo -e "${CYAN}→${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }

# ─── MongoDB ────────────────────────────────────────────────────────────────

mongo_running() {
  podman ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"
}

mongo_exists() {
  podman container exists "$CONTAINER_NAME" 2>/dev/null
}

start_mongo() {
  if mongo_running; then
    ok "MongoDB läuft bereits"
    return
  fi

  if mongo_exists; then
    info "MongoDB Container starten..."
    podman start "$CONTAINER_NAME" >/dev/null
  else
    info "MongoDB Container erstellen (einmalig)..."
    podman run -d \
      --name "$CONTAINER_NAME" \
      -p 127.0.0.1:27017:27017 \
      -v "${MONGO_VOLUME}:/data/db" \
      --restart unless-stopped \
      mongo:7 >/dev/null
  fi

  echo -n "  Warte auf MongoDB"
  for i in $(seq 1 20); do
    if podman exec "$CONTAINER_NAME" mongosh --quiet --eval "db.runCommand('ping').ok" >/dev/null 2>&1; then
      echo -e " ${GREEN}✓${NC}"
      return
    fi
    echo -n "."
    sleep 1
  done
  echo ""
  warn "MongoDB Timeout – starte trotzdem weiter"
}

stop_mongo() {
  if mongo_running; then
    info "MongoDB stoppen..."
    podman stop "$CONTAINER_NAME" >/dev/null
    ok "MongoDB gestoppt"
  fi
}

# ─── Prozess-Verwaltung ─────────────────────────────────────────────────────

server_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

stop_server() {
  if [ ! -f "$PID_FILE" ]; then
    return
  fi

  PID=$(cat "$PID_FILE")
  info "Server stoppen (PID $PID)..."

  # Komplette Prozessgruppe beenden (setsid erstellt neue Session → PGID = PID)
  if PGID=$(ps -o pgid= -p "$PID" 2>/dev/null | tr -d ' ') && [ -n "$PGID" ] && [ "$PGID" != "0" ]; then
    kill -TERM "-${PGID}" 2>/dev/null || true
  fi
  kill -TERM "$PID" 2>/dev/null || true

  # Auf sauberes Beenden warten
  for i in $(seq 1 8); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.5
  done
  kill -KILL "$PID" 2>/dev/null || true

  rm -f "$PID_FILE"
  ok "Server gestoppt"
}

# ─── Docker/Podman Compose ──────────────────────────────────────────────────

get_compose() {
  if command -v podman-compose &>/dev/null; then echo "podman-compose"
  elif command -v docker-compose &>/dev/null; then echo "docker-compose"
  elif docker compose version &>/dev/null 2>&1; then echo "docker compose"
  else err "Weder podman-compose noch docker-compose gefunden."; exit 1; fi
}

cmd_compose_up() {
  echo -e "\n${BOLD}Habit Tracker – Production (Compose)${NC}\n"
  if [ ! -f "$SCRIPT_DIR/.env.production" ]; then
    err ".env.production nicht gefunden!"
    echo "  Vorlage kopieren und ausfüllen:"
    echo -e "  ${BOLD}cp .env.production.example .env.production${NC}"
    exit 1
  fi
  cd "$SCRIPT_DIR"
  COMPOSE=$(get_compose)
  info "Image bauen und Container starten..."
  $COMPOSE up -d --build
  echo -e "\n${GREEN}${BOLD}✓ Production läuft!${NC}"
  echo -e "  ${CYAN}App:${NC}  http://localhost:3001\n"
}

cmd_compose_down() {
  echo -e "\n${BOLD}Habit Tracker – Production stoppen${NC}\n"
  cd "$SCRIPT_DIR"
  COMPOSE=$(get_compose)
  $COMPOSE down
  echo -e "\n${GREEN}Gestoppt.${NC}\n"
}

cmd_compose_logs() {
  cd "$SCRIPT_DIR"
  COMPOSE=$(get_compose)
  info "Logs (Strg+C zum Beenden):"
  $COMPOSE logs -f
}

cmd_compose_rebuild() {
  echo -e "\n${BOLD}Habit Tracker – Image neu bauen${NC}\n"
  cd "$SCRIPT_DIR"
  COMPOSE=$(get_compose)
  $COMPOSE build --no-cache
  ok "Build abgeschlossen – starte mit: ${BOLD}./run.sh compose:up${NC}"
  echo ""
}

# ─── Befehle ────────────────────────────────────────────────────────────────

cmd_start() {
  echo -e "\n${BOLD}Habit Tracker – Entwicklungsmodus${NC}\n"

  if server_running; then
    err "App läuft bereits (PID: $(cat "$PID_FILE"))"
    echo "  Stoppe zuerst mit:  ./run.sh stop"
    exit 1
  fi

  cd "$SCRIPT_DIR"
  start_mongo

  info "Dev-Server starten..."
  # setsid erzeugt neue Prozessgruppe → alle Kindprozesse werden mit kill -PGID beendet
  setsid npm run dev > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"

  # Kurz warten und prüfen ob der Prozess noch läuft
  sleep 2
  if ! server_running; then
    err "Server konnte nicht gestartet werden. Logs:"
    tail -20 "$LOG_FILE"
    exit 1
  fi

  echo -e "\n${GREEN}${BOLD}✓ Habit Tracker läuft!${NC}"
  echo -e "  ${CYAN}Frontend:${NC}  http://localhost:5173"
  echo -e "  ${CYAN}Backend:${NC}   http://localhost:3001"
  echo -e ""
  echo -e "  Logs anzeigen:  ${BOLD}./run.sh logs${NC}"
  echo -e "  Stoppen:        ${BOLD}./run.sh stop${NC}\n"
}

cmd_stop() {
  echo -e "\n${BOLD}Habit Tracker – Stoppen${NC}\n"
  stop_server
  stop_mongo
  echo -e "\n${GREEN}Alles gestoppt.${NC}\n"
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_status() {
  echo -e "\n${BOLD}=== Habit Tracker Status ===${NC}\n"

  if mongo_running; then
    echo -e "  MongoDB:   ${GREEN}● läuft${NC}"
  elif mongo_exists; then
    echo -e "  MongoDB:   ${YELLOW}● gestoppt (Container existiert)${NC}"
  else
    echo -e "  MongoDB:   ${RED}● nicht eingerichtet${NC}"
  fi

  if server_running; then
    echo -e "  Server:    ${GREEN}● läuft${NC} (PID: $(cat "$PID_FILE"))"
  else
    echo -e "  Server:    ${RED}● gestoppt${NC}"
  fi

  echo ""
}

cmd_logs() {
  if [ ! -f "$LOG_FILE" ]; then
    err "Keine Logs gefunden. Starte zuerst mit: ./run.sh start"
    exit 1
  fi
  echo -e "${CYAN}Logs (Strg+C zum Beenden):${NC}\n"
  tail -f "$LOG_FILE"
}

cmd_prod() {
  echo -e "\n${BOLD}Habit Tracker – Production${NC}\n"

  if server_running; then
    err "App läuft bereits. Stoppe zuerst mit: ./run.sh stop"
    exit 1
  fi

  cd "$SCRIPT_DIR"
  start_mongo

  info "Frontend bauen..."
  npm run build

  info "Production-Server starten..."
  setsid env NODE_ENV=production node server/index.js > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"

  sleep 2
  if ! server_running; then
    err "Server konnte nicht gestartet werden:"
    tail -20 "$LOG_FILE"
    exit 1
  fi

  echo -e "\n${GREEN}${BOLD}✓ Production-Server läuft!${NC}"
  echo -e "  ${CYAN}App:${NC}  http://localhost:3001\n"
}

# ─── Einstiegspunkt ─────────────────────────────────────────────────────────

case "${1:-help}" in
  start)          cmd_start ;;
  stop)           cmd_stop ;;
  restart)        cmd_restart ;;
  status)         cmd_status ;;
  logs)           cmd_logs ;;
  prod)           cmd_prod ;;
  compose:up)     cmd_compose_up ;;
  compose:down)   cmd_compose_down ;;
  compose:logs)   cmd_compose_logs ;;
  compose:build)  cmd_compose_rebuild ;;
  *)
    echo -e "\n${BOLD}Habit Tracker – Steuerung${NC}"
    echo ""
    echo -e "  ${CYAN}── Entwicklung ──────────────────────────────────────${NC}"
    echo -e "  ${BOLD}./run.sh start${NC}          Dev-Modus (MongoDB + Server + Frontend)"
    echo -e "  ${BOLD}./run.sh stop${NC}           Alles stoppen"
    echo -e "  ${BOLD}./run.sh restart${NC}        Neu starten"
    echo -e "  ${BOLD}./run.sh status${NC}         Status anzeigen"
    echo -e "  ${BOLD}./run.sh logs${NC}           Logs verfolgen"
    echo ""
    echo -e "  ${CYAN}── Production (Docker/Podman Compose) ───────────────${NC}"
    echo -e "  ${BOLD}./run.sh compose:up${NC}     Container bauen & starten"
    echo -e "  ${BOLD}./run.sh compose:down${NC}   Container stoppen"
    echo -e "  ${BOLD}./run.sh compose:logs${NC}   Container-Logs verfolgen"
    echo -e "  ${BOLD}./run.sh compose:build${NC}  Image neu bauen (ohne Cache)"
    echo ""
    echo -e "  ${CYAN}── Backup & Restore ─────────────────────────────────${NC}"
    echo -e "  ${BOLD}./backup.sh${NC}             Datenbank sichern"
    echo -e "  ${BOLD}./restore.sh${NC}            Verfügbare Backups auflisten"
    echo -e "  ${BOLD}./restore.sh <datei>${NC}    Backup einspielen"
    echo ""
    ;;
esac
