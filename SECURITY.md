# Security & Authentication

Documentation of the authentication system, password security, and available
administration tools.

---

## Authentication Model

### Session management

Authentication uses **httpOnly JWT cookies** (30-day expiry). The cookie is set by `POST /api/auth/login` and cleared by `POST /api/auth/logout`. It is inaccessible to JavaScript — XSS attacks cannot steal it.

The JWT payload contains `{ userId, sv }`. On every request the server calls `jwt.verify()` (microseconds) and loads the user from the database by `_id`. Credentials (password, pepper) are **never** checked per-request.

`sv` is the **session version**: every password change (self-service or admin reset) increments `user.sessionVersion`, which immediately invalidates all previously issued tokens for that account. The session performing the change receives a freshly signed cookie and stays logged in; every other device/cookie is logged out.

### Regular users

Users log in with **username + password**.

### Admin

The admin logs in through the same `/login` page with the admin username and password.

### First-time setup / migration from UUID

If a user account was created before usernames existed, they can still log in with their UUID (as long as no username has been set yet). On the next login a prompt appears to choose a username and password — after that, the UUID is **permanently blocked** as a login method.

---

## Password Security: Pepper

### What is a pepper?

A **pepper** is a server-side secret appended to every password before hashing:

```
stored hash = bcrypt( plaintext + pepper, rounds=12 )
```

Unlike the salt (random, per-password, stored in the DB), the pepper is **not stored in the database**. Even if an attacker obtains the full database dump, they cannot crack passwords offline without also having the pepper.

### Configuring the pepper

Set one of the following options in your `.env` / `.env.production` file:

#### Option A: File (recommended)

```env
PEPPER_FILE=/etc/deltis/pepper.key
```

Generate the pepper file (one-time):

```bash
openssl rand -base64 48 | sudo tee /etc/deltis/pepper.key
sudo chmod 600 /etc/deltis/pepper.key
```

The path should be **outside** the project directory and must not be committed to git.

#### Option B: Environment variable

```env
PASSWORD_PEPPER=your_very_long_random_secret_here
```

Less secure — the value may appear in process listings.

#### Option C: First-installation wizard

If neither option is set, the `/init` wizard offers a security step **before**
the admin account is created: it generates a cryptographically random pepper
(and JWT secret) with one click and stores it in
`/etc/deltis/deltis.config.json`. `.env` values always take precedence and are
shown as locked in the wizard.

#### No pepper

Without configuration the server starts with a warning. Passwords are hashed with bcrypt only, without a pepper. Functionally correct, but weaker against database leaks.

### Important notes

> **CRITICAL: Never change or delete the pepper while user accounts exist.**
> All existing password hashes become invalid and users can no longer log in.
> If rotation is absolutely necessary, all users must reset their passwords.

> **Docker / NAS:** Provide the pepper via a mounted file (e.g. `/etc/deltis/pepper.key`) —
> the value never appears in the image or Compose file.

---

## JWT Secret

The JWT secret signs all session tokens. See [SETUP.md](SETUP.md) for how to configure it.

> **Changing `JWT_SECRET` / `JWT_SECRET_FILE` invalidates all active sessions.**
> Every user must log in again after a secret rotation.

---

## Admin Password Reset

If the admin password is lost, it can be reset directly against the database —
without knowing the current password.

### Prerequisites

- Access to the server's filesystem (SSH or local)
- `MONGODB_URI` in `.env` must point to the running database
- Node.js and the project dependencies (`npm install`) must be installed

### Usage

**Interactive** (recommended — password input is not echoed):

```bash
node scripts/reset-admin-password.js
# or:
npm run admin:reset-password
```

**Non-interactive** (scripts, CI):

```bash
# Via stdin (password not in process list)
printf '%s' "$NEW_ADMIN_PASSWORD" | node scripts/reset-admin-password.js

# As argument (avoid on shared systems — appears in process list)
node scripts/reset-admin-password.js --password "$NEW_ADMIN_PASSWORD"
```

### Password requirements

Minimum **8 characters**. No further restrictions.

### Technical note

The reset script uses plain bcrypt for `adminSecretHash` — not the pepper. This is intentional: the admin secret has always been stored without a pepper and the script works independently of the pepper configuration.

---

## API Endpoints (Auth)

See [docs/api/auth.md](docs/api/auth.md) for the full reference.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | no | Verify credentials, set JWT cookie |
| `POST` | `/api/auth/logout` | no | Clear JWT cookie |
| `GET` | `/api/auth/me` | ✓ | Return current user object |
| `PUT` | `/api/auth/me` | ✓ | Update display name / weight unit |
| `PUT` | `/api/auth/me/username` | ✓ | Set or change username |
| `PUT` | `/api/auth/me/password` | ✓ | Change password (requires current password) |
| `PUT` | `/api/auth/me/password/forced` | ✓ | Forced change (no current password; only when `mustChangePassword` is true) |

---

## Request Hardening

The following protections apply to **every** API request:

### Input sanitization (`server/middleware/sanitizeBody.js`)

`req.body` and `req.query` are recursively cleaned before any route handler
runs: keys starting with `$`, keys containing `.` and prototype-pollution keys
(`__proto__`, `constructor`, `prototype`) are removed. This blocks MongoDB
operator injection (e.g. `{ "identifier": { "$gt": "" } }`) at the door.
Additionally, `POST /api/auth/login` strictly requires string credentials.

### Per-route authorization invariants

- Every data route filters by `userId: req.user._id` — reads and writes.
- Update payloads are **field-whitelisted**; `userId`, `_id`, version fields
  and history arrays can never be set by a client (mass-assignment protection).
- Cross-document references are ownership-checked: an `activityTypeRef`,
  `habitId` or goal `targetRef` must belong to the requesting user (habits may
  also be global/predefined). Foreign references return `404`.
- Admin routes require `isAdmin` (`adminOnly` middleware); the public setup
  endpoints (`/api/admin/setup*`, `/api/init`) are rate limited and lock
  themselves once the first admin account exists.

### Session security

- Cookies: `httpOnly`, `SameSite=Lax`, `Secure` in production.
- Password change/reset invalidates all other sessions (see session version).
- `TRUST_PROXY` (env) controls how many reverse-proxy hops are trusted for
  client IPs — required for correct rate limiting behind a proxy.

### Response headers (`server/middleware/securityHeaders.js`)

`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, a Content-Security-Policy for the SPA,
`Permissions-Policy`, and `Strict-Transport-Security` in production.
`X-Powered-By` is disabled.

### Data lifecycle

- Deleting a user (admin) cascades to **all** personal data: logs, plans,
  goals, activity types, habit definitions and settings.
- ZIP imports are limited (10 MB upload, 64 entries, 50 MB uncompressed) to
  prevent zip-bomb resource exhaustion.

### Known accepted trade-offs

- Login responses distinguish "unknown username" from "wrong password"
  (`PASSWORD_REQUIRED` drives the two-step login UI). Username enumeration is
  accepted for now; revisit before opening registration to the public internet.
- The rate limiter is in-memory (single instance). For multi-instance
  deployments move it to a shared store.
