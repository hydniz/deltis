# Habit Tracker

A self-hosted personal habit and activity tracking PWA. Multi-user, Docker-ready, designed for NAS deployment.

## Features

- **Activity tracking** – log workouts, runs, cycling and custom activities with custom fields
- **Weekly planner** – schedule activities and habits for the week
- **Habit tracking** – track daily habits (sleep, water intake, screen time, …) with charts
- **Weight log** – visualize weight trends over time
- **Goals** – set weekly and long-term goals with milestones
- **Multi-user** – admin creates UUID-based accounts for each user
- **Admin panel** – manage users, generate login UUIDs, change admin password
- **PWA** – installable as a native app on mobile and desktop

## Tech Stack

- **Backend**: Node.js / Express
- **Database**: MongoDB
- **Frontend**: React + Vite + TailwindCSS
- **Auth**: UUID-only for regular users; UUID + password for admin

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

- **Regular users** log in with their UUID (no password).
- **Admin** logs in with UUID + password via the *"Als Admin anmelden"* toggle on the login page.
- The admin can create and delete user accounts from the admin panel (`/admin`).
- The admin can change their password in the settings (`/settings`).

---

## License

MIT – see [LICENCE](LICENCE) for details.
