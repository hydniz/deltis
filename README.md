# Habit Tracker

A self-hosted personal habit and activity tracking PWA. Multi-user, Docker-ready, designed for NAS deployment.

## Features

- **Activity tracking** – log workouts, runs, cycling and custom activities with custom fields
- **Weekly planner** – schedule activities and habits for the week
- **Habit tracking** – track daily habits (sleep, water intake, screen time, …) with charts
- **Weight log** – visualize weight trends over time
- **Goals** – set weekly and long-term goals with milestones
- **Multi-user** – admin creates accounts; users log in with username + password
- **Admin panel** – manage users, change admin password
- **PWA** – installable as a native app on mobile and desktop

## Tech Stack

- **Backend**: Node.js / Express
- **Database**: MongoDB
- **Frontend**: React + Vite + TailwindCSS
- **Auth**: httpOnly JWT cookies (30 days); bcrypt + pepper for password hashing

---

## Quick start

→ **[SETUP.md](SETUP.md)** — full setup guide (local dev + Docker/NAS deployment)

---

## Getting Started (Development)

### Prerequisites

- Node.js v18+
- MongoDB

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

### Install & Run

```bash
# Install all dependencies (server + client)
npm run install:all

# Start development server (hot reload for frontend + backend)
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3001/api

### First-Time Admin Setup

1. Start the server – an admin UUID is generated automatically and printed to the console.
2. Navigate to `/admin` in the browser – you will be redirected to `/admin/setup`.
3. Your admin UUID is displayed on the setup page. **Copy and save it.**
4. Set your admin password to complete setup.
5. Log in at `/login` → click *"Als Admin anmelden"* → enter UUID + password.
6. After logging in, a prompt will appear to choose a **username**. Once set, the UUID is disabled as a login method.

> **Tip:** Set up a pepper before creating any user accounts. See [SECURITY.md](SECURITY.md).

---

## Docker Deployment (NAS / Server)

### Build and export

```bash
./build-nas.sh           # linux/amd64 (most NAS devices)
./build-nas.sh --arm64   # linux/arm64 (older Synology / QNAP)
```

### Deploy manually

```bash
# Copy files to your NAS
scp habit-tracker-$(date +%Y%m%d).tar.gz \
    .env.production.example docker-compose.yml \
    backup.sh restore.sh \
    user@nas:/path/to/habit-tracker/

# On the NAS
cp .env.production.example .env.production
mkdir -p backups
docker load < habit-tracker-*.tar.gz
docker compose up -d
```

Open `http://<nas-ip>:3001` and complete the admin setup at `/admin`.

### CI/CD via GitHub Actions

Every push to `main` automatically builds the image, transfers it and restarts the container with a database backup beforehand.

Configure these repository secrets:

| Secret | Description |
|--------|-------------|
| `SERVER_HOST` | IP or hostname of your server |
| `SERVER_USER` | SSH username |
| `SERVER_SSH_KEY` | Private SSH key (PEM format) |
| `TARGET_DIR` | Deployment directory on the server |

---

## Database Migrations

Schema and data migrations run **automatically on startup** before the Express server begins accepting traffic. No manual intervention is required in normal operation.

### How it works

1. The runner scans `server/migrations/` for files matching `NNN-*.js` (three-digit numeric prefix).
2. Already-applied migrations are recorded in the `migrations` collection — those are skipped.
3. Before applying any pending migration, a **pre-migration backup** is written to `backups/pre-migration/`.
4. Migrations apply in numeric order. If one fails, the database is **automatically restored** from the backup and the process exits.
5. A `migrationlocks` collection (TTL 24 hours) prevents concurrent runs (e.g. multiple containers starting at the same time).

### Diagnostics

```bash
# Show applied and pending migrations
npm run migrate:status
```

### Manual rollback

Pre-migration backups are kept on disk (last 5 retained):

```bash
npm run migrate:rollback                                  # list available backups
npm run migrate:rollback backups/pre-migration/<file>     # restore a specific backup
```

### Adding a migration

1. Pick the next free three-digit prefix (e.g. `003`).
2. Create `server/migrations/003-short-description.js`:

   ```javascript
   module.exports = {
     name: '003-short-description', // must match filename without .js
     async up() {
       // idempotent: safe to run on already-migrated data
     },
   };
   ```

3. Add a test case in `server/tests/migrations.test.js`.

See [server/migrations/README.md](server/migrations/README.md) for full details.

---

## Logs

**Development:**
```bash
./run.sh logs        # follow background log file
```
Or run `npm run dev` directly – logs stream to stdout.

**Docker:**
```bash
docker compose logs -f app    # app server only
docker compose logs -f        # all services
```

## Backup & Restore

```bash
# Create a database backup
./backup.sh

# List available backups
./restore.sh

# Restore from a specific backup
./restore.sh backups/<filename>.archive.gz
```

Backups are stored in `./backups/` (excluded from git). Write access to the app is temporarily locked during backup to ensure consistency.

---

## Authentication

- **Users and admins** sign in through the same login form using an **identifier + password** flow.
- There is **no separate "Als Admin anmelden" toggle** on the login page.
- Regular users typically log in with their username and password.
- Admins log in through the same page with their admin credentials.
- The admin can create and delete user accounts from the admin panel (`/admin`).
- The admin can change their password in the settings (`/settings`).

### Migration from UUID-only

Existing UUID-based accounts are migrated on first login: users enter their UUID, are prompted to choose a username and password, and the UUID is permanently disabled as a login method afterwards. The UUID remains stored in the database for reference but can no longer be used to authenticate.

### Password security (Pepper)

User passwords are hashed with bcrypt (12 rounds) plus a server-side **pepper** – a secret key stored outside the database. This means a leaked database alone is not sufficient for offline password cracking. See [SECURITY.md](SECURITY.md) for setup instructions.

### Admin password reset

If the admin password is lost, it can be reset directly against the database:

```bash
node scripts/reset-admin-password.js
# or:
npm run admin:reset-password
```

See [SECURITY.md](SECURITY.md) for details.

---

## API Documentation

The full backend API reference lives in [`docs/api/`](docs/api/README.md).

| Resource | Path |
|---|---|
| Overview, auth & versioning | [docs/api/README.md](docs/api/README.md) |
| Auth | [docs/api/auth.md](docs/api/auth.md) |
| Activities & Types | [docs/api/activities.md](docs/api/activities.md) |
| Habits | [docs/api/habits.md](docs/api/habits.md) |
| Goals | [docs/api/goals.md](docs/api/goals.md) |
| Planner | [docs/api/planner.md](docs/api/planner.md) |
| Weight | [docs/api/weight.md](docs/api/weight.md) |
| Data export/import | [docs/api/data.md](docs/api/data.md) |
| Admin | [docs/api/admin.md](docs/api/admin.md) |

---

## Version Compatibility

Frontend and backend version numbers are **independent** and may drift apart. API compatibility is tracked via a dedicated integer (`apiVersion`), separate from the semver version.

### How it works

- `apiVersion` in root `package.json` — the current backend API contract version.
- `REQUIRED_API_VERSION` in `client/src/config/compatibility.js` — what this frontend build requires.
- On every page load the frontend fetches `GET /api` and compares the two values.
  - **Match** → `✓ compatible` logged to the browser console, app runs normally.
  - **Mismatch** → `✗ INCOMPATIBLE` logged, an amber warning banner is shown to all users.

The backend logs its API version at startup:
```
✓ Deltis server running on port 3001
  API version: 1 | ENV: production
```

### When to bump

| Situation | Action |
|---|---|
| UI-only change, non-breaking backend addition | Nothing |
| Breaking change (removed/renamed endpoint or field) | Bump `apiVersion` in `package.json` **and** `REQUIRED_API_VERSION` in `compatibility.js` |
| Frontend requires a new backend feature | Bump `REQUIRED_API_VERSION` only |

### Release stage

Both `package.json` files (root + `client/`) have a `"stage"` field:
- `""` → stable release, commit hash hidden in production builds
- `"alpha"` / `"beta"` → label appended to the displayed version string

---

## License

PolyForm Noncommercial License 1.0.0 – see [LICENCE](LICENCE) for details. Short: Use, modify, and share the software for personal or educational purposes but the use is not intended for commercial advantage or monetary compensation
