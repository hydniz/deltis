#!/bin/bash
# Deltis – Start/Stop Script
# Usage: ./run.sh [start|stop|restart|status|logs|prod|compose:up|compose:down]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_NAME="deltis-mongo"
MONGO_VOLUME="deltis-mongo-data"
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

# MongoDB

mongo_running() {
  podman ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"
}

mongo_exists() {
  podman container exists "$CONTAINER_NAME" 2>/dev/null
}

start_mongo() {
  if mongo_running; then
    ok "MongoDB already running"
    return
  fi

  if mongo_exists; then
    info "Starting MongoDB container..."
    podman start "$CONTAINER_NAME" >/dev/null
  else
    info "Creating MongoDB container (first time)..."
    podman run -d \
      --name "$CONTAINER_NAME" \
      -p 0.0.0.0:27017:27017 \
      -v "${MONGO_VOLUME}:/data/db" \
      --restart unless-stopped \
      mongo:7 >/dev/null
  fi

  echo -n "  Waiting for MongoDB"
  for i in $(seq 1 20); do
    if podman exec "$CONTAINER_NAME" mongosh --quiet --eval "db.runCommand('ping').ok" >/dev/null 2>&1; then
      echo -e " ${GREEN}✓${NC}"
      return
    fi
    echo -n "."
    sleep 1
  done
  echo ""
  warn "MongoDB timeout – continuing anyway"
}

stop_mongo() {
  if mongo_running; then
    info "Stopping MongoDB..."
    podman stop "$CONTAINER_NAME" >/dev/null
    ok "MongoDB stopped"
  fi
}

# Process management

server_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

stop_server() {
  if [ ! -f "$PID_FILE" ]; then
    return
  fi

  PID=$(cat "$PID_FILE")
  info "Stopping server (PID $PID)..."

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
  ok "Server stopped"
}

# Docker/Podman Compose

get_compose() {
  if command -v podman-compose &>/dev/null; then echo "podman-compose"
  elif command -v docker-compose &>/dev/null; then echo "docker-compose"
  elif docker compose version &>/dev/null 2>&1; then echo "docker compose"
  else err "Neither podman-compose nor docker-compose found."; exit 1; fi
}

cmd_compose_up() {
  echo -e "\n${BOLD}Deltis – Production (Compose)${NC}\n"
  if [ ! -f "$SCRIPT_DIR/.env.production" ]; then
    err ".env.production not found!"
    exit 1
  fi
  cd "$SCRIPT_DIR"
  COMPOSE=$(get_compose)
  info "Building image and starting containers..."
  $COMPOSE up -d --build
  echo -e "\n${GREEN}${BOLD}✓ Production is running!${NC}"
}

cmd_compose_down() {
  echo -e "\n${BOLD}Deltis – Stop Production${NC}\n"
  cd "$SCRIPT_DIR"
  COMPOSE=$(get_compose)
  $COMPOSE down
  echo -e "\n${GREEN}Stopped.${NC}\n"
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

# Commands

cmd_start() {
  echo -e "\n${BOLD}Deltis – Development Mode${NC}\n"

  if server_running; then
    err "App is already running (PID: $(cat "$PID_FILE"))"
    exit 1
  fi

  cd "$SCRIPT_DIR"
  start_mongo

  info "Starting dev server (host: 0.0.0.0)..."
  setsid npm run dev -- --host 0.0.0.0 > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"

  sleep 2
  if ! server_running; then
    err "Server failed to start. Logs:"
    tail -20 "$LOG_FILE"
    exit 1
  fi

  echo -e "\n${GREEN}${BOLD}✓ Deltis is running!${NC}"
  echo -e "  ${CYAN}Network:${NC}  http://192.168.80.57:5173"
  echo -e "  ${CYAN}Local:${NC}    http://localhost:5173"
  echo -e ""
}

cmd_stop() {
  echo -e "\n${BOLD}Deltis – Stopping${NC}\n"
  stop_server
  stop_mongo
  echo -e "\n${GREEN}All stopped.${NC}\n"
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_status() {
  echo -e "\n${BOLD}=== Deltis Status ===${NC}\n"
  mongo_running && echo -e "  MongoDB:  ${GREEN}● running${NC}" || echo -e "  MongoDB:  ${RED}● stopped${NC}"
  server_running && echo -e "  Server:   ${GREEN}● running${NC}" || echo -e "  Server:   ${RED}● stopped${NC}"
  echo ""
}

cmd_logs() {
  tail -f "$LOG_FILE"
}

cmd_prod() {
  echo -e "\n${BOLD}Deltis – Production${NC}\n"
  if server_running; then err "App is already running."; exit 1; fi

  cd "$SCRIPT_DIR"
  start_mongo
  info "Building frontend..."
  npm run build

  info "Starting production server..."
  setsid env NODE_ENV=production HOST=0.0.0.0 node server/index.js > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"

  sleep 2
  server_running && ok "Production server is running!" || err "Startup failed."
}

# Entry point

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
    echo "Usage: ./run.sh [start|stop|restart|status|logs|prod|compose:up|compose:down]"
    ;;
esac
