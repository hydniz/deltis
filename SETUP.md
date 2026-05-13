# Deltis – Setup Guide

Everything you need to get the app running, from prerequisites to first login.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Environment variables](#2-environment-variables)
3. [Local development](#3-local-development)
4. [Production deployment (Docker / NAS)](#4-production-deployment-docker--nas)
5. [First-time admin setup](#5-first-time-admin-setup)

---

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

---

## 2. Environment variables

### Required vs. optional

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGODB_URI` | **yes** | — | MongoDB connection string |
| `PORT` | no | `3001` | HTTP port the server listens on |
| `NODE_ENV` | **yes** | — | `development` or `production` |
| `JWT_SECRET_FILE` | **yes*** | — | Path to a file containing the JWT secret (takes precedence) |
| `JWT_SECRET` | **yes*** | — | JWT secret value directly in env (used when `JWT_SECRET_FILE` is not set) |
| `PEPPER_FILE` | recommended | — | Path to a file containing the password pepper |
| `PASSWORD_PEPPER` | recommended | — | Alternative: pepper value directly in env |
| `VALID_UUIDS` | no | — | Legacy migration only (see note below) |
| `GIT_COMMIT` | no | `unknown` | Injected automatically by `build-nas.sh` |

> **\* JWT_SECRET:** exactly one of `JWT_SECRET` or `JWT_SECRET_FILE` must be set.  
> **Pepper:** omitting both `PEPPER_FILE` and `PASSWORD_PEPPER` is allowed but weakens password security — a warning is printed at startup.

### Generating secrets

```bash
# JWT secret (64 bytes, base64-encoded)
openssl rand -base64 64

# Password pepper (48 bytes)
openssl rand -base64 48
```

> **⚠ Never change the pepper after users have registered.** All password hashes would become invalid. See [SECURITY.md](SECURITY.md) for details.

> **⚠ Changing `JWT_SECRET` invalidates all active sessions** — every user must log in again.

---

## 3. Local development

### 3.1 — Install dependencies

```bash
npm run install:all
```

### 3.2 — Create `.env`

Copy the template and fill in the values:

```bash
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

### 3.3 — Start

```bash
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3001/api

Continue with [First-time admin setup](#5-first-time-admin-setup).

---

## 4. Production deployment (Docker / NAS)

### 4.1 — Prepare secrets on the host

```bash
# Create a directory for secrets (outside the project)
sudo mkdir -p /etc/deltis
sudo chmod 700 /etc/deltis

# Generate and store the JWT secret
openssl rand -base64 64 | sudo tee /etc/deltis/jwt_secret > /dev/null
sudo chmod 600 /etc/deltis/jwt_secret

# Generate and store the password pepper
openssl rand -base64 48 | sudo tee /etc/deltis/pepper.txt > /dev/null
sudo chmod 600 /etc/deltis/pepper.txt
```

### 4.2 — Create `.env.production`

```bash
cp .env.production.example .env.production
```

Edit `.env.production`:

```env
PORT=3001
NODE_ENV=production

# Point to the secret files created in step 4.1
JWT_SECRET_FILE=/etc/deltis/jwt_secret
PEPPER_FILE=/etc/deltis/pepper.txt
```

> `MONGODB_URI` is overridden by `docker-compose.yml` automatically — leave it out or set it to anything.

### 4.3 — Mount secret files into the container

Edit `docker-compose.yml` to mount the JWT secret file (the pepper is already mounted):

```yaml
volumes:
  - /etc/deltis/pepper.txt:/etc/deltis/pepper.txt:ro
  - /etc/deltis/jwt_secret:/etc/deltis/jwt_secret:ro
```

### 4.4 — Build and start

```bash
# Build image for linux/amd64 (most NAS devices)
./build-nas.sh

# Start containers
docker compose up -d
```

Open `http://<host-ip>:3001` and continue with [First-time admin setup](#5-first-time-admin-setup).

### Updating

```bash
./build-nas.sh          # rebuilds image with current code
docker compose up -d    # recreates container with new image (DB is preserved)
```

### CI/CD via GitHub Actions

Three workflows run automatically on the repository:

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | Push to any branch except `main`, PRs | Runs tests |
| `deploy.yml` | Push to `main` | Tests → builds image → deploys to NAS via SSH |
| `dockerhub.yml` | Push of a `v*` tag | Tests → builds multi-platform image → pushes to Docker Hub |
| `release.yml` | Push of a `v*` tag | Tests → builds image → creates GitHub Release with assets |

**Required repository secrets** (Settings → Secrets → Actions):

| Secret | Used by | Description |
|---|---|---|
| `SERVER_HOST` | `deploy.yml` | IP or hostname of the NAS |
| `SERVER_USER` | `deploy.yml` | SSH username |
| `SERVER_SSH_KEY` | `deploy.yml` | Private SSH key (PEM format) |
| `TARGET_DIR` | `deploy.yml` | Deployment directory on the server |
| `DOCKERHUB_USERNAME` | `dockerhub.yml` | Docker Hub account username |
| `DOCKERHUB_TOKEN` | `dockerhub.yml` | Docker Hub access token (create at hub.docker.com → Account Settings → Security) |

**Docker Hub image:** `<DOCKERHUB_USERNAME>/deltis`

Tags pushed on every release (e.g. tag `v1.2.3`):
- `1.2.3` — exact version
- `1.2` — floating major.minor
- `1` — floating major
- `latest` — always the newest release

**To pull the image on your NAS (alternative to `build-nas.sh`):**
```bash
docker pull <your-username>/deltis:latest
```
Update `docker-compose.yml` to use `image: <your-username>/deltis:latest` instead of `build: .`.

---

## 5. First-time admin setup

This runs **once** after the very first start.

1. Open the app in the browser (`http://localhost:5173` in dev, `http://<host>:3001` in prod).
2. You will be redirected to `/admin/setup`.
3. Set a password for the admin account.
4. Log in at `/login` with `admin` + the password you just set.
5. A prompt appears to choose a **username** for your admin account — set it to complete the first-time setup.
6. Go to `/admin` to create regular user accounts.

> **Tip:** The admin's initial UUID is printed to the server console on first start — you won't need it if you complete the setup via the browser immediately.

---

## Quick reference

```
REQUIRED (always):
  MONGODB_URI          MongoDB connection string
  NODE_ENV             development | production
  JWT_SECRET           or JWT_SECRET_FILE (one required)

RECOMMENDED:
  PEPPER_FILE          or PASSWORD_PEPPER

OPTIONAL:
  PORT                 default: 3001
  VALID_UUIDS          legacy UUID migration only
```
