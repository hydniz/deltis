# Deltis – Setup Guide

Everything you need to get the app running, from prerequisites to first login.

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Configuration & secrets](#2-configuration--secrets)
3. [Local development](#3-local-development)
4. [Production deployment (Docker / NAS)](#4-production-deployment-docker--nas)
5. [First-time setup wizard](#5-first-time-setup-wizard)
6. [Updating](#6-updating)

## 1. Prerequisites

### Local development

| Requirement | Minimum version |
|---|---|
| Node.js | 18 |
| MongoDB | 7 |

**Install MongoDB on Ubuntu/Debian:**
```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
  | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] \
  https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" \
  | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

sudo apt-get update && sudo apt-get install -y mongodb-org
sudo systemctl start mongod && sudo systemctl enable mongod
```

### Production (Docker / NAS)

- Docker Engine + Docker Compose

## 2. Configuration & secrets

Configuration values are resolved in this order (highest priority first):

1. **Environment variables** (`.env` / `.env.production` / compose `environment:`)
2. **`/etc/deltis/deltis.config.json`** — written by the setup wizard and the admin UI
3. **Built-in defaults**

That means you can either configure everything up front via env vars, or start with an empty configuration and let the **setup wizard** (see [section 5](#5-first-time-setup-wizard)) store MongoDB URI, JWT secret and pepper for you.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGODB_URI` | yes* | — | MongoDB connection string |
| `PORT` | no | `3001` | HTTP port the server listens on |
| `NODE_ENV` | yes | — | `development` or `production` |
| `JWT_SECRET_FILE` | recommended* | — | Path to a file containing the JWT secret (takes precedence over `JWT_SECRET`) |
| `JWT_SECRET` | recommended* | — | JWT secret value directly in env |
| `PEPPER_FILE` | recommended* | — | Path to a file containing the password pepper |
| `PASSWORD_PEPPER` | recommended* | — | Alternative: pepper value directly in env |
| `VALID_UUIDS` | no | — | Legacy migration only |
| `GIT_COMMIT` | no | `unknown` | Injected automatically by the build |

> **\*** Each of these can also be set through the setup wizard / admin UI instead
> (stored in `deltis.config.json`). Without a JWT secret the server generates a
> temporary one at startup — sessions then end on every restart. Without a pepper
> the server starts with a warning; see [SECURITY.md](SECURITY.md) for why you want one.

### Generating secrets

```bash
openssl rand -base64 64   # JWT secret
openssl rand -base64 48   # password pepper
```

> **⚠ Never change the pepper after users have registered** — all password hashes
> become invalid. **Changing the JWT secret** logs every user out.

## 3. Local development

```bash
# 1. Install dependencies (server + client)
npm run install:all

# 2. Create .env
cp .env.production.example .env
```

Minimum `.env` for local development:

```env
MONGODB_URI=mongodb://localhost:27017/habit_tracker
PORT=3001
NODE_ENV=development

# Generate with: openssl rand -base64 64
JWT_SECRET=<your-generated-secret>

# Optional but recommended — generate with: openssl rand -base64 48
PASSWORD_PEPPER=<your-pepper>
```

```bash
# 3. Start (backend + frontend with hot reload)
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3001/api

Continue with the [first-time setup wizard](#5-first-time-setup-wizard).

## 4. Production deployment (Docker / NAS)

### 4.1 — Prepare secrets on the host

The compose file mounts the host directory `/etc/deltis/` into the container, so
secret files placed there are available automatically:

```bash
sudo mkdir -p /etc/deltis
sudo chmod 700 /etc/deltis

openssl rand -base64 64 | sudo tee /etc/deltis/jwt_secret > /dev/null
openssl rand -base64 48 | sudo tee /etc/deltis/pepper.key > /dev/null
sudo chmod 600 /etc/deltis/jwt_secret /etc/deltis/pepper.key
```

### 4.2 — Create `.env.production`

```bash
cp .env.production.example .env.production
```

```env
PORT=3001
NODE_ENV=production

JWT_SECRET_FILE=/etc/deltis/jwt_secret
PEPPER_FILE=/etc/deltis/pepper.key
```

> `MONGODB_URI` is overridden by `docker-compose.yml` — inside the container
> MongoDB is reachable via the service name `mongo`.

### 4.3 — Start

**Option A — prebuilt image from Docker Hub (recommended):**

```bash
echo "DELTIS_IMAGE=hydniz/deltis:latest" > .env
mkdir -p backups
docker compose up -d --no-build
```

**Option B — build from source:**

```bash
./build-nas.sh           # linux/amd64 (most NAS devices)
./build-nas.sh --arm64   # linux/arm64
mkdir -p backups
docker compose up -d
```

Open `http://<host-ip>:3001` and continue with the
[first-time setup wizard](#5-first-time-setup-wizard).

### Running multiple instances (e.g. beta + production)

Each instance gets its own directory with its own compose `.env`
(`DELTIS_INSTANCE`, `APP_PORT`, `MONGO_PORT`) — see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#3-instance-directories-on-the-server).

### CI/CD

The repository ships GitHub Actions workflows for automated testing, publishing
and deployment:

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | every push & PR | Runs backend + frontend tests |
| `deploy-beta.yml` | push to `main` | Deploys to the beta instance |
| `deploy-production.yml` | stable tag `vX.Y.Z` | Deploys to the production instance |
| `docker-publish.yml` | push to `main` | Publishes `hydniz/deltis:latest` + `:<short-sha>` to Docker Hub |
| `dockerhub.yml` | any `v*` tag | Publishes semver-tagged images to Docker Hub |
| `release.yml` | any `v*` tag | Creates a GitHub Release with build assets |

Deployment setup (GitHub environments, SSH keys, rollback) is documented in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## 5. First-time setup wizard

On the very first start the app redirects to `/admin/setup`:

1. **System configuration** *(only shown when no MongoDB connection exists yet)* —
   enter the MongoDB URI and optionally a JWT secret and pepper. Values are stored
   in `/etc/deltis/deltis.config.json`; env vars always take precedence.
2. **Security configuration** *(shown when no pepper is configured)* — same as
   above without the MongoDB field. The wizard warns you if you continue without
   a pepper: configure it **before** creating accounts, never after.
3. **Admin account** — choose a username and password.
4. Sign in at `/login` and create user accounts under
   *Administration → Nutzerverwaltung*.

> Users created by an admin receive a temporary password and must change it on
> first login.

## 6. Updating

**In-app (recommended):** *Administration → Updates* checks the configured release
channel (stable / beta / alpha) and updates with an automatic pre-update backup and
rollback on failure. See [docs/UPDATES.md](docs/UPDATES.md).

**Manually (Docker):**

```bash
./backup.sh
docker compose pull   # or: ./build-nas.sh when building from source
docker compose up -d --no-build --force-recreate
```

The database volume is preserved across updates; schema migrations run
automatically at startup ([server/migrations/README.md](server/migrations/README.md)).
