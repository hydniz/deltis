# Contributing to Deltis

Thanks for your interest in improving Deltis! This document covers everything you need to know before opening a pull request.

## Getting started

1. Fork and clone the repository.
2. Follow the [setup guide](SETUP.md) to get a local development environment running (`npm run install:all`, then `npm run dev`).
3. Create a feature branch off `main`.

## Project layout

```
server/            Express backend
  routes/          REST endpoints (mounted under /api)
  models/          Mongoose schemas
  middleware/      Auth, emergency mode, backup lock
  migrations/      Numbered schema/data migrations (run at startup)
  updater/         Helper for in-app (OTA) container updates
  utils/           Config, docker client, update state/log, ...
  tests/           Jest test suites (one per route/util)
client/            React frontend (Vite)
  src/pages/       One component per route
  src/components/  Shared components (admin/ = admin-area building blocks)
  src/tests/       Vitest + Testing Library suites
scripts/           Operational scripts (deploy, self-update, admin reset)
docs/              Deployment, updates and API documentation
```

## Conventions

### Language policy

- **Code, comments, commit messages, documentation: English.**
- **User-facing UI strings: German.** Labels, buttons, toasts and error messages shown to users are German — including error strings returned by API endpoints.

### Code style

- Prefer **early returns** over nested conditionals.
- Frontend styling uses **Tailwind utility classes** only; no separate CSS files per component.
- All API routes live under `/api` and must be protected by the auth middleware unless they are explicitly public (login, setup, version info).
- Never log sensitive data (passwords, peppers, tokens, UUIDs).

### Testing

Every change to backend or frontend logic must come with tests. The project aims for full coverage of all components.

```bash
npm test                    # backend (Jest, spins up an in-memory MongoDB)
cd client && npm test       # frontend (Vitest)
```

Both suites must pass before a PR can be merged — CI runs them on every push and pull request.

## API versioning

Frontend and backend versions are independent. Compatibility is tracked by an integer, separate from semver:

| File | Field | Meaning |
|---|---|---|
| `package.json` (root) | `apiVersion` | Current backend API contract |
| `client/src/config/compatibility.js` | `REQUIRED_API_VERSION` | Minimum API version the frontend build requires |

On page load the frontend compares its requirement against `GET /api/` and shows a warning banner on mismatch.

**When to bump:**

| Situation | Action |
|---|---|
| Frontend-only change, or non-breaking backend addition | Nothing |
| **Breaking** backend change (removed/renamed endpoint or field shape) | Bump `apiVersion` **and** `REQUIRED_API_VERSION` |
| Frontend depends on a backend feature not yet released | Bump `REQUIRED_API_VERSION` only |

## Releases & channels

Releases are Git tags; the tag format determines the update channel that in-app updates and deployments use:

| Tag | Channel | Effect |
|---|---|---|
| `vX.Y.Z` | stable | Production deploy, Docker Hub publish, GitHub Release |
| `vX.Y.Z-beta.N` | beta | Docker Hub publish + GitHub Release (no production deploy) |
| `vX.Y.Z-alpha.N` | alpha | Docker Hub publish + GitHub Release (no production deploy) |
| push to `main` | main | Beta-instance deploy + `hydniz/deltis:<short-sha>` image |

Both `package.json` files (root + `client/`) carry a `"stage"` field (`""`, `"alpha"`, `"beta"`) that is appended to the displayed version string.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full pipeline and [docs/UPDATES.md](docs/UPDATES.md) for how instances consume releases.

## Pull requests

- Keep PRs focused — one topic per PR.
- Include tests for the change and make sure both suites pass.
- Update the documentation (`README.md`, `docs/`, `docs/api/`) when behavior changes.
- Bump `apiVersion` / `REQUIRED_API_VERSION` when the API contract changes (see above).

## Reporting issues

- **Bugs & feature requests:** open a GitHub issue with steps to reproduce.
- **Security vulnerabilities:** please do **not** open a public issue — use GitHub's private vulnerability reporting (*Security → Report a vulnerability*).
