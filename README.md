# Deltis

A self-hosted habit and activity tracking PWA. Multi-user, Docker-ready, built for home servers and NAS devices.

Deltis keeps your training log, habits, weight and goals in one place — on your own hardware, with no third-party services involved.

## Features

- **Activity tracking** – log workouts, runs, rides and custom activity types with custom fields
- **Weekly planner** – schedule activities and habits for the week
- **Habit tracking** – daily habits (sleep, water intake, screen time, …) with charts
- **Weight log** – weight trend visualization over time
- **Goals** – weekly and long-term goals with milestones
- **Multi-user** – an admin creates accounts; users sign in with username + password
- **Admin panel** – user management, runtime configuration, in-app updates
- **Over-the-air updates** – update to new releases from the admin UI, with automatic backup and rollback ([details](docs/UPDATES.md))
- **PWA** – installable as an app on mobile and desktop

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js / Express |
| Database | MongoDB |
| Frontend | React (Vite) + TailwindCSS |
| Auth | httpOnly JWT cookies; bcrypt + pepper for password hashing |
| Deployment | Docker Compose; prebuilt images on Docker Hub (`hydniz/deltis`) |

## Quick start (Docker)

```bash
# Get compose file and env template
mkdir deltis && cd deltis
curl -O https://raw.githubusercontent.com/hydniz/deltis/main/docker-compose.yml
curl -o .env.production https://raw.githubusercontent.com/hydniz/deltis/main/.env.production.example

# Use the prebuilt image instead of building from source
echo "DELTIS_IMAGE=hydniz/deltis:latest" > .env

mkdir -p backups
docker compose up -d --no-build
```

Open `http://<host>:3001` — the app redirects to a **setup wizard** that walks you through:

1. **System configuration** – MongoDB connection, JWT secret and password pepper (all can also be provided via `.env.production`, see [SETUP.md](SETUP.md))
2. **Admin account** – choose a username and password
3. Done — sign in and create user accounts under *Administration → Nutzerverwaltung*

For building from source, secret files, NAS specifics and every environment variable, see the full **[setup guide](SETUP.md)**.

## Updates

Deltis updates itself from the admin UI (*Administration → Updates*). Pick a release channel (stable / beta / alpha), and the app pulls the new version, taking a database backup first and rolling back automatically if anything fails.

The update mechanism adapts to how the app runs (Docker with socket access, Docker without, bare host). See [docs/UPDATES.md](docs/UPDATES.md) for how it works and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the CI/CD pipeline behind releases.

## Backup & restore

```bash
./backup.sh                               # create a database backup
./restore.sh                              # list available backups
./restore.sh backups/<file>.archive.gz    # restore a specific backup
```

Backups live in `./backups/` (never committed). Writes are locked during a backup to keep it consistent. Automatic backups are also taken before every update, deploy and database migration.

## Development

Prerequisites: Node.js ≥ 18 and a local MongoDB ≥ 7 (install instructions in [SETUP.md](SETUP.md)).

```bash
npm run install:all    # install server + client dependencies
npm run dev            # backend on :3001, frontend with hot reload on :5173
```

Run the tests:

```bash
npm test               # backend (Jest)
cd client && npm test  # frontend (Vitest)
```

Database schema migrations run automatically at startup; see [server/migrations/README.md](server/migrations/README.md) for how they work and how to add one.

If you want to contribute, please read **[CONTRIBUTING.md](CONTRIBUTING.md)** first — it covers the project conventions (language policy, testing, API versioning, release channels).

## Documentation

| Topic | Document |
|---|---|
| Setup guide (dev + production) | [SETUP.md](SETUP.md) |
| Contributing & conventions | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Security, auth model, pepper, admin reset | [SECURITY.md](SECURITY.md) |
| In-app (OTA) updates & rollback | [docs/UPDATES.md](docs/UPDATES.md) |
| CI/CD deployment pipeline | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| REST API reference | [docs/api/README.md](docs/api/README.md) |
| Database migrations | [server/migrations/README.md](server/migrations/README.md) |

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) — you may use, modify and share this software for any noncommercial purpose. Commercial use is not permitted.
