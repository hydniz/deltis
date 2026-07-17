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

> **Guard:** `deploy-remote.sh` refuses a deploy that would start against an
> empty database while the host still carries a pre-rename container/volume
> or existing backups — exactly the situation above. The workflow fails with
> a pointer to this section. For an intentionally fresh install on such a
> host, set `DELTIS_ALLOW_FRESH=1` (in the instance `.env` or the shell) and
> redeploy. The `/init` wizard additionally warns when it finds backups on a
> server whose database is empty.

### Recovering after an accidental fresh start

If a renamed/misconfigured deploy already happened and the app was
re-initialized against an empty database, the old data is still on the host —
Docker never deletes volumes on its own:

```sh
docker volume ls | grep mongo-data     # old volume, e.g. habit-tracker-mongo-data

# 1. Dump the old database from the old volume (read-only, temporary container)
docker run --rm -d --name deltis-recovery \
  -v habit-tracker-mongo-data:/data/db mongo:7
sleep 5   # let mongod start
docker exec deltis-recovery mongodump --db habit_tracker \
  --archive=/tmp/recovery.archive --gzip --quiet
mkdir -p backups
docker cp deltis-recovery:/tmp/recovery.archive \
  backups/habit_tracker_recovery.archive.gz
docker stop deltis-recovery

# 2. Restore into the running instance — restore.sh stops the app, remaps
#    habit_tracker.* → deltis.* and restarts (drops what was re-initialized!)
./restore.sh backups/habit_tracker_recovery.archive.gz
```

Anything entered after the accidental re-initialization is replaced by the
restore — export it first (Einstellungen → Daten exportieren) if it must be
kept. Once the instance is verified, remove the old volume with
`docker volume rm habit-tracker-mongo-data`.

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

## Securing MongoDB

**Never expose the MongoDB port to the internet.** Docker-published ports
bypass host firewalls like ufw (Docker writes its own iptables NAT rules), and
an internet-reachable mongod without authentication is found by automated
ransom bots within hours. They drop every database and leave a marker like
`READ_ME_TO_RECOVER_YOUR_DATA` behind — the data is NOT copied, it is simply
destroyed. This happened to a Deltis production instance on 2026-07-17.

Since that incident the compose file binds the port to localhost by default:

```yaml
ports:
  - "${MONGO_BIND:-127.0.0.1}:${MONGO_PORT:-27017}:27017"
```

Nothing in Deltis needs the published port: the app reaches mongo over the
internal compose network, and `backup.sh` / `restore.sh` /
`scripts/deploy-remote.sh` all go through `docker exec`. If you do not need
host-local `mongosh` access you can remove the `ports:` block entirely.
Only set `MONGO_BIND=0.0.0.0` if you really know what you are doing.

### Checklist per instance

```bash
# 1. Is the port reachable from outside? (run on ANOTHER machine)
nc -zv <server-ip> 27017 27018 27019

# 2. What does the host actually publish?
sudo docker ps --format '{{.Names}}\t{{.Ports}}' | grep mongo
# GOOD:  127.0.0.1:27017->27017/tcp
# BAD:   0.0.0.0:27017->27017/tcp

# 3. Has a ransom bot already been here?
sudo docker exec <instance>-mongo mongosh --quiet --eval 'db.getMongo().getDBNames()'
```

The server also checks this at startup and logs a loud `SECURITY ALERT` when
a ransom marker database is present (`server/utils/securityCheck.js`).

### Optional: enable authentication (defense in depth)

On a **fresh** instance set both variables in the instance `.env` before the
first start — the official mongo image only creates the root user while the
data volume is empty:

```bash
MONGO_ROOT_USER=deltis
MONGO_ROOT_PASSWORD=<long random secret>
DELTIS_MONGODB_URI=mongodb://deltis:<long random secret>@mongo:27017/deltis?authSource=admin
```

On an **existing** instance create the user manually once, then set the same
`.env` values and recreate the containers:

```bash
sudo docker exec -it <instance>-mongo mongosh admin --eval \
  'db.createUser({ user: "deltis", pwd: "<long random secret>", roles: [ { role: "root", db: "admin" } ] })'
```

### Ransom incident response (READ_ME_TO_RECOVER_YOUR_DATA present)

1. **Do not pay. Do not run the /init wizard.** The wizard warns when backups
   exist for exactly this situation.
2. Close the hole FIRST (localhost binding as above, `docker compose up -d`),
   otherwise the bot wipes the restored data again within hours.
3. Restore the newest backup: `./restore.sh` lists EJSON snapshots
   (`backups/pre-migration/`, `backups/pre-update/`) and mongodump archives
   (pre-deploy). Pending migrations re-run automatically on the next boot.
4. Check the other instances on the same host (beta, manual) for the marker
   and restore them the same way.
5. Rotate application secrets that live in the database or could have been
   read (JWT secret, Strava tokens); the password pepper lives in
   `/etc/deltis/` on the host and is not part of the database.
