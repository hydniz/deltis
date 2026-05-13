# Habit Tracker - Project Guidelines
This habit tracker is called Deltis which is a variation of delta.

## Context
A self-hosted personal habit called deltis and activity tracking PWA. Designed for NAS deployment via Docker.
Later the Frontend will be supplemented with an android app as well as an ios app.

## Language Policy
- **Development:** All technical content (code, variable names, function names, comments, documentation, and commit messages) MUST be in **English**.
- **User Interface (UI):** All user-facing strings (labels, buttons, toast messages, tooltips) MUST be in **German**.
- **Communication:** Chat interactions should remain direct, technical, and concise.

## Coding Styles
- The application needs a 100% test coverange at all components.

## Tech Stack
- **Frontend:** React (Vite), TailwindCSS, PWA.
- **Backend:** Node.js, Express.
- **Database:** MongoDB.
- **Auth:** Bcrypt + Pepper, users will only be created by an admin.

## Coding Standards
- **UI/UX:** Mobile-first design (PWA). Use Tailwind for all styling.
- **Logic:** Use "Early Returns" to reduce nesting. 
- **API:** RESTful endpoints under `/api`. Ensure all routes are protected.
- **Security:** Never log sensitive data (passwords, peppers, UUIDs).

## Common Commands
- **Install:** `npm run install:all`
- **Dev:** `npm run dev`
- **Build:** `./build-nas.sh`
- **Backup:** `./backup.sh`

## Versioning & API Compatibility

Frontend and backend version numbers are **independent** and may drift apart. API compatibility is tracked via a dedicated integer separate from the semver version.

### Key files
| File | Field | Purpose |
|---|---|---|
| `package.json` (root) | `"apiVersion": N` | Current backend API contract version |
| `client/src/config/compatibility.js` | `REQUIRED_API_VERSION` | Minimum API version this frontend build requires |
| `package.json` (root + `client/`) | `"stage": ""` | Release stage: `""` = stable, `"alpha"`, `"beta"` |

### How the check works
On every page load the frontend calls `GET /api/` and compares `res.data.apiVersion` against `REQUIRED_API_VERSION`.
- **Match** → `✓ compatible` logged to the browser console, app runs normally.
- **Mismatch** → `✗ INCOMPATIBLE` logged, a persistent amber warning banner is shown to all users.
- **Backend unreachable** → check is skipped silently (the auth flow handles connection errors).

The backend logs its API version at server startup:
```
✓ Deltis server running on port 3001
  API version: 1 | ENV: production
```

### When to bump
| Situation | Action |
|---|---|
| Frontend-only change (UI, refactor) | No bump needed |
| Backend-only non-breaking change (new optional field) | No bump needed |
| **Breaking** backend change (removed/renamed endpoint or field shape) | Bump `apiVersion` in root `package.json` **and** `REQUIRED_API_VERSION` in `compatibility.js` |
| Frontend requires a new backend feature not yet in production | Bump `REQUIRED_API_VERSION` in `compatibility.js` only |

### Release stage
Both `package.json` files (root + `client/`) have a `"stage"` field.
- `""` → stable, no label shown, commit hash hidden in production builds
- `"alpha"` / `"beta"` → appended to the displayed version string (e.g. `0.3.0-alpha`)
- In development the full string is `{version}-{stage}+{commitHash}`; in production the hash is omitted.