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
    # Mapping von 0.0.0.0 ermöglicht Zugriff über die Netzwerk-IP
    podman run -d \
      --name "$CONTAINER_NAME" \
      -p 0.0.0.0:27017:27017 \
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

  if PGID=$(ps -o pgid= -p "$PID" 2>/dev/null | tr -d ' ') && [ -n "$PGID" ] && [ "$PGID" != "0" ]; then
    kill -TERM "-${PGID}" 2>/dev/null || true
  fi
  kill -TERM "$PID" 2>/dev/null || true

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
    exit 1
  fi
  cd "$SCRIPT_DIR"
  COMPOSE=$(get_compose)
  info "Image bauen und Container starten..."
  $COMPOSE up -d --build
  echo -e "\n${GREEN}${BOLD}✓ Production läuft!${NC}"
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
  $COMPOSE logs -f
}

cmd_compose_rebuild() {
  cd "$SCRIPT_DIR"
  COMPOSE=$(get_compose)
  $COMPOSE build --no-cache
}

# ─── Befehle ────────────────────────────────────────────────────────────────

cmd_start() {
  echo -e "\n${BOLD}Habit Tracker – Entwicklungsmodus${NC}\n"

  if server_running; then
    err "App läuft bereits (PID: $(cat "$PID_FILE"))"
    exit 1
  fi

  cd "$SCRIPT_DIR"
  start_mongo

  info "Dev-Server starten (Host: 0.0.0.0)..."
  # --host 0.0.0.0 bündelt Vite an alle Schnittstellen
  setsid npm run dev -- --host 0.0.0.0 > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"

  sleep 2
  if ! server_running; then
    err "Server konnte nicht gestartet werden. Logs:"
    tail -20 "$LOG_FILE"
    exit 1
  fi

  echo -e "\n${GREEN}${BOLD}✓ Habit Tracker läuft!${NC}"
  echo -e "  ${CYAN}Netzwerk:${NC}  http://192.168.80.57:5173"
  echo -e "  ${CYAN}Lokal:${NC}     http://localhost:5173"
  echo -e ""
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
  mongo_running && echo -e "  MongoDB:   ${GREEN}● läuft${NC}" || echo -e "  MongoDB:   ${RED}● gestoppt${NC}"
  server_running && echo -e "  Server:    ${GREEN}● läuft${NC}" || echo -e "  Server:    ${RED}● gestoppt${NC}"
  echo ""
}

cmd_logs() {
  tail -f "$LOG_FILE"
}

cmd_prod() {
  echo -e "\n${BOLD}Habit Tracker – Production${NC}\n"
  if server_running; then err "App läuft bereits."; exit 1; fi

  cd "$SCRIPT_DIR"
  start_mongo
  info "Frontend bauen..."
  npm run build

  info "Production-Server starten..."
  # HOST Umgebungsvariable für Node-Backend
  setsid env NODE_ENV=production HOST=0.0.0.0 node server/index.js > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"

  sleep 2
  server_running && ok "Production-Server läuft!" || err "Start fehlgeschlagen."
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
    echo "Verwendung: ./run.sh [start|stop|restart|status|logs|prod|compose:up|compose:down]"
    ;;
esac