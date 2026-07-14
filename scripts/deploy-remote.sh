#!/bin/bash
# Habit Tracker – Server-side deploy step (executed via SSH by the CI pipeline)
#
# Runs inside the instance directory (TARGET_DIR) after the CI has copied:
#   - the new image as a gzipped tar archive
#   - docker-compose.yml, backup.sh, restore.sh, rollback.sh, this script
#
# Steps:
#   1. Pre-deploy database backup (rollback safety net, keeps the last 5)
#   2. Record the currently running image in .rollback-info
#   3. Load the new image, point .env at it, recreate the containers
#   4. Wait for the container health check; fail loudly with a rollback hint
#   5. Prune old images of this instance (keeps current + previous)
#
# Must be run from inside the instance directory:
#   cd $TARGET_DIR && bash scripts/deploy-remote.sh <image-tar.gz> <new-image-ref> <tag-prefix>
#   e.g. bash scripts/deploy-remote.sh deltis-deploy.tar.gz habit-tracker:v1.2.3 v

set -euo pipefail

TAR_FILE="${1:?usage: deploy-remote.sh <image-tar.gz> <new-image-ref> <tag-prefix>}"
NEW_IMAGE="${2:?missing new image ref}"
TAG_PREFIX="${3:?missing instance tag prefix}"

if [ ! -f docker-compose.yml ]; then
  echo "✗ docker-compose.yml not found – run this script from the instance directory." >&2
  exit 1
fi

ENV_FILE=".env"
ROLLBACK_INFO=".rollback-info"

# Instance config (DELTIS_INSTANCE, ports, current DELTIS_IMAGE)
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1091
  set -a; . "$ENV_FILE"; set +a
fi
INSTANCE="${DELTIS_INSTANCE:-habit-tracker}"
MONGO_CONTAINER="${INSTANCE}-mongo"
APP_CONTAINER="${INSTANCE}-app"

echo "=== Deltis deploy: $NEW_IMAGE → instance '$INSTANCE' ==="

# ── 1. Pre-deploy database backup ────────────────────────────────────────────

BACKUP_FILE=""
if docker container inspect "$MONGO_CONTAINER" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
  mkdir -p backups
  BACKUP_FILE="backups/predeploy_$(date +%Y%m%d_%H%M%S).archive.gz"
  echo "→ Pre-deploy backup: $BACKUP_FILE"
  docker exec "$MONGO_CONTAINER" mongodump \
    --db habit_tracker \
    --archive=/tmp/pre_deploy.archive \
    --gzip --quiet
  docker cp "$MONGO_CONTAINER:/tmp/pre_deploy.archive" "$BACKUP_FILE"
  docker exec "$MONGO_CONTAINER" rm -f /tmp/pre_deploy.archive
  # Keep only the 5 most recent pre-deploy backups
  ls -1t backups/predeploy_*.archive.gz 2>/dev/null | tail -n +6 | xargs -r rm -f || true
else
  echo "→ First deploy – no running MongoDB, skipping backup."
fi

# ── 2. Record rollback info ──────────────────────────────────────────────────

PREVIOUS_IMAGE=""
if docker container inspect "$APP_CONTAINER" >/dev/null 2>&1; then
  # The image ref the running container was started from (tag, not digest)
  PREVIOUS_IMAGE="$(docker container inspect "$APP_CONTAINER" --format '{{.Config.Image}}')"
fi
if [ -n "$PREVIOUS_IMAGE" ] && [ "$PREVIOUS_IMAGE" != "$NEW_IMAGE" ]; then
  {
    echo "PREVIOUS_IMAGE=$PREVIOUS_IMAGE"
    echo "BACKUP_FILE=$BACKUP_FILE"
    echo "DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$ROLLBACK_INFO"
  echo "→ Rollback info written (previous image: $PREVIOUS_IMAGE)"
fi

# ── 3. Load new image and switch over ────────────────────────────────────────

echo "→ Loading image ..."
docker load < "$TAR_FILE"
rm -f "$TAR_FILE"

touch "$ENV_FILE"
if grep -q '^DELTIS_IMAGE=' "$ENV_FILE"; then
  sed -i "s|^DELTIS_IMAGE=.*|DELTIS_IMAGE=$NEW_IMAGE|" "$ENV_FILE"
else
  echo "DELTIS_IMAGE=$NEW_IMAGE" >> "$ENV_FILE"
fi

echo "→ Recreating containers ..."
docker compose up -d --no-build --force-recreate

# ── 4. Wait for the app health check ─────────────────────────────────────────

echo "→ Waiting for health check ..."
DEADLINE=$((SECONDS + 120))
STATUS="unknown"
while [ $SECONDS -lt $DEADLINE ]; do
  STATUS="$(docker container inspect "$APP_CONTAINER" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo unknown)"
  # Image without a HEALTHCHECK: fall back to "running"
  if [ "$STATUS" = "healthy" ]; then break; fi
  if [ "$STATUS" = "none" ]; then
    docker container inspect "$APP_CONTAINER" --format '{{.State.Running}}' 2>/dev/null | grep -q true && STATUS="healthy" && break
  fi
  sleep 5
done

if [ "$STATUS" != "healthy" ]; then
  echo "✗ App did not become healthy (status: $STATUS)."
  echo "  Roll back with:  ./rollback.sh           (image only)"
  echo "                   ./rollback.sh --with-db (image + DB backup)"
  exit 1
fi
echo "✓ App is healthy."

# ── 5. Prune old images of this instance ─────────────────────────────────────
# Only touches tags of this instance's prefix; keeps the new and previous image
# so rollback.sh always has something to roll back to.

REPO="${NEW_IMAGE%%:*}"
docker image ls --format '{{.Repository}}:{{.Tag}}' "$REPO" \
  | grep -F "${REPO}:${TAG_PREFIX}" \
  | grep -vxF "$NEW_IMAGE" \
  | { [ -n "$PREVIOUS_IMAGE" ] && grep -vxF "$PREVIOUS_IMAGE" || cat; } \
  | xargs -r docker image rm >/dev/null 2>&1 || true

echo "✓ Deploy successful: $NEW_IMAGE"
