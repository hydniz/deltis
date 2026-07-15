# Fresh Start & Demo Data

How to boot a completely empty Deltis instance in Docker, and how to fill it
with a reusable showcase dataset.

## Starting completely empty (Docker)

All persistent state lives in the MongoDB volume (`<instance>-mongo-data`)
and the mounted `./backups` directory. To start from zero:

```bash
# Stop the stack AND delete the MongoDB volume
docker compose down -v

# Optional: also clear backups / update state carried across containers
rm -rf backups/*

# Start fresh
docker compose up -d --build
```

On first start with an empty database the server logs `FIRST START` — open
`http://<host>:3001/admin/setup` in the browser and create the admin
account. Predefined habits and runtime migrations are seeded automatically;
no user data exists at this point.

Notes:

- `docker compose down` **without** `-v` keeps all data — the `-v` is what
  makes it a truly empty start.
- With multiple instances (`DELTIS_INSTANCE` in `.env`), each instance has
  its own volume; `-v` only removes the volume of the compose project you
  run it in.
- `.env.production` (JWT secret, pepper, ports) is configuration, not data —
  keep it.

## Seeding the demo dataset

`scripts/seed-demo.js` creates a self-contained showcase: four accounts with
settings, ~10 weeks of habit/activity/weight history (heatmaps and charts
look alive), goals and planner entries for the current week. All dates are
generated relative to *today*, so the demo always looks current no matter
when you run it.

```bash
# Local development (server not required to be running)
npm run seed:demo             # refuses to touch a non-empty database
npm run seed:demo -- --reset  # wipes user data first, then seeds

# Docker deployment — run INSIDE the app container so the same
# pepper/env is used for password hashing:
docker compose exec app node scripts/seed-demo.js --reset
```

`--reset` removes user data (accounts, habits, activities, goals, plans,
weights) but never touches migration state or the admin system config
(`SystemConfig`).

### Demo accounts

Password for all accounts: `demo1234`

| Login   | Name       | Showcase                                                                 |
|---------|------------|--------------------------------------------------------------------------|
| `admin` | Alex Admin | Administration: user management, system config, updates                   |
| `lena`  | Lena       | Sporty all-rounder: schedules, min-targets with partial fulfilment (heatmap gradations), boolean habit, periodic + long-term goals with milestones, planner |
| `jonas` | Jonas      | Quitting smoking: max-targets (incl. `max 0`), relapses as dimmed heatmap cells, improving trend |
| `mia`   | Mia        | Brand-new account — logging in shows the onboarding wizard                |

### Adapting the dataset

The script is the single source of truth for the demo — edit the persona
functions (`seedLena`, `seedJonas`) in `scripts/seed-demo.js` to change
habits, targets, schedules or history length (`WEEKS`). The data shapes are
driven by a deterministic PRNG, so repeated runs produce comparable demos.
