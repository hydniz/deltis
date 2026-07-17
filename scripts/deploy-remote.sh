#!/bin/bash
# Deltis – Server-side deploy step (executed via SSH by the CI pipeline)
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
#   e.g. bash scripts/deploy-remote.sh deltis-deploy.tar.gz deltis:v1.2.3 v

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
INSTANCE="${DELTIS_INSTANCE:-deltis}"
MONGO_CONTAINER="${INSTANCE}-mongo"
APP_CONTAINER="${INSTANCE}-app"

echo "=== Deltis deploy: $NEW_IMAGE → instance '$INSTANCE' ==="

# 0. Fresh-instance guard
#
# When the target mongo container does not exist, this deploy would start the
# app against an EMPTY database. That is only correct for a genuinely new
# instance — if the host still carries data under the pre-rename names
# (habit-tracker-*) or previous backups, it is almost certainly a renamed or
# misconfigured instance, and continuing silently loses the user's data
# (exactly what a missing DELTIS_INSTANCE pin caused after the
# habit-tracker → deltis rename). Abort before touching anything;
# DELTIS_ALLOW_FRESH=1 overrides for intentional fresh installs.

if ! docker container inspect "$MONGO_CONTAINER" >/dev/null 2>&1; then
  EXISTING_TRACES=""
  if [ "$INSTANCE" != "habit-tracker" ]; then
    if docker container inspect habit-tracker-mongo >/dev/null 2>&1; then
      EXISTING_TRACES="${EXISTING_TRACES}  - container 'habit-tracker-mongo' exists (pre-rename instance)\n"
    fi
    if docker volume inspect habit-tracker-mongo-data >/dev/null 2>&1; then
      EXISTING_TRACES="${EXISTING_TRACES}  - volume 'habit-tracker-mongo-data' exists (old data!)\n"
    fi
  fi
  if ls backups/*.archive.gz >/dev/null 2>&1; then
    EXISTING_TRACES="${EXISTING_TRACES}  - backups/ contains database backups from a previous instance\n"
  fi

  if [ -n "$EXISTING_TRACES" ] && [ "${DELTIS_ALLOW_FRESH:-0}" != "1" ]; then
    echo "✗ Aborting: mongo container '$MONGO_CONTAINER' does not exist (first deploy?)," >&2
    echo "  but this host carries traces of an existing instance:" >&2
    printf "%b" "$EXISTING_TRACES" >&2
    echo "  Deploying now would start against an empty database." >&2
    echo "  → Migration guide: docs/DEPLOYMENT.md, section 'Migrating an instance" >&2
    echo "    created before the rename to Deltis' (pin DELTIS_INSTANCE or clone the volume)." >&2
    echo "  → To intentionally start fresh, set DELTIS_ALLOW_FRESH=1 and redeploy." >&2
    exit 1
  fi
fi

# 1. Pre-deploy database backup

BACKUP_FILE=""
if docker container inspect "$MONGO_CONTAINER" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
  mkdir -p backups
  BACKUP_FILE="backups/predeploy_$(date +%Y%m%d_%H%M%S).archive.gz"
  echo "→ Pre-deploy backup: $BACKUP_FILE"
  docker exec "$MONGO_CONTAINER" mongodump \
    --db deltis \
    --archive=/tmp/pre_deploy.archive \
    --gzip --quiet
  docker cp "$MONGO_CONTAINER:/tmp/pre_deploy.archive" "$BACKUP_FILE"
  docker exec "$MONGO_CONTAINER" rm -f /tmp/pre_deploy.archive
  # Keep only the 5 most recent pre-deploy backups
  ls -1t backups/predeploy_*.archive.gz 2>/dev/null | tail -n +6 | xargs -r rm -f || true
else
  echo "→ First deploy – no running MongoDB, skipping backup."
fi

# 2. Record rollback info

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

# 3. Load new image and switch over

echo "→ Loading image ..."
docker load < "$TAR_FILE"
rm -f "$TAR_FILE"

touch "$ENV_FILE"
if grep -q '^DELTIS_IMAGE=' "$ENV_FILE"; then
  sed -i "s|^DELTIS_IMAGE=.*|DELTIS_IMAGE=$NEW_IMAGE|" "$ENV_FILE"
else
  echo "DELTIS_IMAGE=$NEW_IMAGE" >> "$ENV_FILE"
fi
# Sourcing $ENV_FILE above exported the OLD image ref into this shell, and
# docker compose gives the process environment precedence over the .env
# file — without this export compose would recreate the containers from
# the previous image while the deploy still reports success.
export DELTIS_IMAGE="$NEW_IMAGE"

echo "→ Recreating containers ..."
docker compose up -d --no-build --force-recreate

# 4. Wait for the app health check

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

# The health gate alone cannot catch a deploy that restarted the old image
# (that one is just as healthy) — verify the container runs the new ref.
RUNNING_IMAGE="$(docker container inspect "$APP_CONTAINER" --format '{{.Config.Image}}')"
if [ "$RUNNING_IMAGE" != "$NEW_IMAGE" ]; then
  echo "✗ Container runs $RUNNING_IMAGE instead of $NEW_IMAGE – the deploy did not take effect."
  echo "  Check DELTIS_IMAGE in $ENV_FILE and the compose environment, then retry."
  exit 1
fi
echo "✓ Running image verified: $RUNNING_IMAGE"

# 5. Prune old images of this instance
# Only touches tags of this instance's prefix; keeps the new and previous image
# so rollback.sh always has something to roll back to.

REPO="${NEW_IMAGE%%:*}"
docker image ls --format '{{.Repository}}:{{.Tag}}' "$REPO" \
  | grep -F "${REPO}:${TAG_PREFIX}" \
  | grep -vxF "$NEW_IMAGE" \
  | { [ -n "$PREVIOUS_IMAGE" ] && grep -vxF "$PREVIOUS_IMAGE" || cat; } \
  | xargs -r docker image rm >/dev/null 2>&1 || true

echo "✓ Deploy successful: $NEW_IMAGE"
