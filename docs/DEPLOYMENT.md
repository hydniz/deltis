# Deployment (Beta & Production)

## Overview

| Trigger | Target | Image tag |
|---|---|---|
| Push to `main` | **beta** instance | `deltis:beta-<short-sha>` |
| Stable release tag `vX.Y.Z` (no `-beta`/`-alpha` suffix) | **production** instance | `deltis:vX.Y.Z` |

Both paths use the same reusable pipeline ([deploy.yml](../.github/workflows/deploy.yml)):

1. Run all backend + frontend tests (deploy is skipped on failure).
2. Build the Docker image and ship it to the server as a tar archive (no registry needed).
3. On the server ([scripts/deploy-remote.sh](../scripts/deploy-remote.sh)):
   - **Pre-deploy database backup** (`backups/predeploy_*.archive.gz`, last 5 kept)
   - Record the currently running image in `.rollback-info`
   - Load the new image, point `.env` at it, recreate the containers
   - Wait for the container health check — the workflow **fails** if the app does not become healthy
   - Prune old images of this instance (current + previous are always kept)

Authentication is **SSH-key-only** (`secrets.SERVER_SSH_KEY`); no passwords are used anywhere in the pipeline.

The tag convention matches the OTA update channels in `server/routes/update.js`:
`vX.Y.Z` = stable, `vX.Y.Z-beta.N` = beta, `vX.Y.Z-alpha.N` = alpha.
(A `-beta`/`-alpha` tag still publishes to Docker Hub / GitHub Releases via the existing
`dockerhub.yml` / `release.yml` workflows, but does **not** touch production.)

## One-time setup

### 1. GitHub Environments

Create two environments under **Settings → Environments**: `beta` and `production`.
Add these secrets to **each** environment (values may differ per environment):

| Secret | Example (beta) | Example (production) |
|---|---|---|
| `SERVER_HOST` | `nas.local` | `nas.local` |
| `SERVER_USER` | `deploy` | `deploy` |
| `SERVER_SSH_KEY` | private key (see below) | private key (see below) |
| `TARGET_DIR` | `/volume1/deltis-beta` | `/volume1/deltis` |

Today both environments point at the same host with different `TARGET_DIR`s.
To move an environment to its own host later, only change its `SERVER_HOST`
(and optionally `SERVER_SSH_KEY`) — nothing else.

Optionally enable **Required reviewers** on the `production` environment to get a
manual approval gate before every production deploy.

> Environment secrets take precedence over the old repository-level secrets
> (`SERVER_HOST` etc.). Delete the repository-level ones once the environments work.

### 2. SSH deploy key

Generate a dedicated key pair for CI (never reuse your personal key):

```sh
ssh-keygen -t ed25519 -f deltis_deploy -C "deltis-ci" -N ""
ssh-copy-id -i deltis_deploy.pub deploy@<server>   # or append to ~/.ssh/authorized_keys
```

Put the **private** key (`deltis_deploy`) into the `SERVER_SSH_KEY` secret, then delete
the local copy. The server user needs Docker access (`docker` group) and write access
to the `TARGET_DIR`s.

### 3. Instance directories on the server

Each instance lives in its own directory (= `TARGET_DIR`) and is identified by a
compose `.env` file:

```sh
# /volume1/deltis/.env          (production – defaults, file may even be omitted)
DELTIS_INSTANCE=deltis
APP_PORT=3001
MONGO_PORT=27017

# /volume1/deltis-beta/.env     (beta – everything must differ!)
DELTIS_INSTANCE=deltis-beta
APP_PORT=3002
MONGO_PORT=27018
```

`DELTIS_INSTANCE` scopes the container names **and the MongoDB volume name**
(`<instance>-mongo-data`), so the two instances can never share a database.
The pipeline manages the `DELTIS_IMAGE=` line in this file — leave it alone.

Each directory also needs its own `.env.production` (app secrets, see
`.env.production.example`); it is not touched by deploys.

### Migrating an instance created before the rename to Deltis

Instances deployed while the project was still called *habit-tracker* use the old
default names (`habit-tracker-app`, `habit-tracker-mongo`, volume
`habit-tracker-mongo-data`) and store their data in the MongoDB database
`habit_tracker`. All defaults are now `deltis`, so migrate **once, before
deploying a renamed build** — otherwise the app starts against an empty database.

**Quick path** (keep old container/volume names, only copy the database):

```sh
# 1. Pin the old names in the instance .env
echo "DELTIS_INSTANCE=habit-tracker" >> .env

# 2. Copy the database to its new name (app may keep running; writes made
#    between copy and deploy are lost, so do this right before deploying)
docker exec habit-tracker-mongo sh -c \
  "mongodump --db habit_tracker --archive --quiet \
   | mongorestore --archive --nsFrom 'habit_tracker.*' --nsTo 'deltis.*' --drop --quiet"

# 3. Deploy the renamed build as usual
```

**Clean path** (fully rename containers and volume, requires downtime):

```sh
# 1. Copy the database as in step 2 above, then stop the old instance
docker compose down

# 2. Clone the data volume to its new name
docker volume create deltis-mongo-data
docker run --rm -v habit-tracker-mongo-data:/from -v deltis-mongo-data:/to \
  alpine cp -a /from/. /to/

# 3. Remove any DELTIS_INSTANCE=habit-tracker line from .env, deploy,
#    verify, then clean up: docker volume rm habit-tracker-mongo-data
```

Old backups (`habit_tracker_*.archive.gz`) remain restorable — `restore.sh`
remaps the legacy namespaces to `deltis` automatically.

## Releasing

```sh
# Beta: just merge/push to main – the beta instance updates automatically.

# Production:
git tag v1.2.3
git push origin v1.2.3
```

The `v1.2.3` tag triggers, in parallel: production deploy (`deploy-production.yml`),
Docker Hub publish (`dockerhub.yml`) and the GitHub Release (`release.yml`).

## Rollback

Every deploy leaves two artifacts in the instance directory:

- `.rollback-info` — the image that was running before the deploy
- `backups/predeploy_<timestamp>.archive.gz` — mongodump taken right before the deploy

To roll back, SSH into the server:

```sh
cd <TARGET_DIR>
./rollback.sh            # switch the app back to the previous image (DB untouched)
./rollback.sh --with-db  # …and additionally restore the pre-deploy DB backup
```

Use `--with-db` when the new version ran database migrations; otherwise the plain
image rollback is enough and keeps all data written since the deploy.

Independent of deploys, `./backup.sh` and `./restore.sh` continue to work per
instance (they read `DELTIS_INSTANCE` from the same `.env`).
