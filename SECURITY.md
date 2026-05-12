# Security & Authentication

Documentation of the authentication system, password security, and available
administration tools.

---

## Authentication Model

### Regular Users

After the one-time migration, users log in with **username + password**.

| Phase          | Login method                           | Bearer token format            |
|----------------|----------------------------------------|--------------------------------|
| Migration      | UUID (no password required)            | `<uuid>`                       |
| After migration| Username + password                    | `<username>:<password>`        |

The UUID is **permanently blocked** once a username is set. The server rejects UUID
logins with `HTTP 401 / code: UUID_BLOCKED`.

### Admin

| Login method                     | Token format                      |
|----------------------------------|-----------------------------------|
| Username + admin secret          | `<username>:<admin-secret>`       |

The admin secret is independent of the regular user password and stored separately
in `adminSecretHash`. It is **not** subject to the pepper mechanism.

### Migration Flow (Existing Users)

1. User enters UUID in the login field, password field left empty
2. Login succeeds (server: no `passwordHash` → migration mode)
3. A modal appears: choose username + password (admin: username only)
4. After saving: UUID is blocked, `localStorage` token updated to `username:password`
5. All future logins: username + password

---

## Password Security: Pepper

### What Is a Pepper?

A **pepper** is a server-side secret appended to every password before hashing:

```
stored hash = bcrypt( plaintext + pepper, rounds=12 )
```

Unlike the salt (random, per-password, stored in the DB), the pepper is
**not stored in the database**. Even if an attacker obtains the full database,
they cannot crack passwords offline without also having the pepper.

### Configuring the Pepper

Set one of the following options in your `.env` file:

#### Option A: File (recommended)

```env
PEPPER_FILE=/run/secrets/habit_tracker_pepper
```

Generate the pepper file (one-time):

```bash
# 48 bytes = 64 Base64 characters, cryptographically secure
openssl rand -base64 48 > /run/secrets/habit_tracker_pepper
chmod 600 /run/secrets/habit_tracker_pepper
```

The path should be **outside** the project directory and must not be committed to git.

#### Option B: Environment variable

```env
PASSWORD_PEPPER=your_very_long_random_secret_here
```

Less secure than Option A, as the value may appear in process listings and logs.

#### No pepper (not recommended)

Without configuration the server starts with a warning. Passwords are hashed with
bcrypt only, without a pepper. Functionally correct, but weaker against database leaks.

### Important Notes

> **CRITICAL: Never change or delete the pepper while user accounts exist.**
> All existing password hashes will become invalid and users will no longer be able to
> log in. If rotation is absolutely necessary, all users must reset their passwords.

> **Docker / NAS:** The pepper can be provided via Docker Secrets
> (e.g. `/run/secrets/habit_tracker_pepper`) – the file is mounted into the container
> automatically without appearing in the image or Compose file.

---

## Admin Password Reset

If the admin password is lost, it can be reset directly against the database –
without knowing the current password.

### Prerequisites

- Access to the server's filesystem (SSH or local)
- `MONGODB_URI` in `.env` must point to the running database
- Node.js and the project dependencies (`npm install`) must be installed

### Usage

**Interactive** (recommended – password input is not echoed):

```bash
node scripts/reset-admin-password.js
```

Output:
```
── Reset admin password ─────────────────────────────────
Database: mongodb://localhost:27017/habit_tracker

Admin account found:
  UUID:     xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  Username: admin

New admin password:
Confirm password:
Admin password has been reset successfully.
```

**Via npm script:**

```bash
npm run admin:reset-password
```

**Non-interactive** (scripts, CI, pipelines):

```bash
# As argument (appears in process list – avoid on shared systems)
node scripts/reset-admin-password.js --password "NewPassword123"

# Via stdin (safer – password not in process list)
echo "NewPassword123" | node scripts/reset-admin-password.js
```

### Password Requirements

- At least **8 characters**
- No further restrictions

### Technical Note

The reset script does **not** use the pepper – `adminSecretHash` is always hashed
with plain bcrypt (as expected by the admin setup and existing admin auth).
Only `passwordHash` (regular users) includes the pepper. The script therefore works
independently of the pepper configuration.

---

## API Endpoints (Auth)

| Method | Path                          | Auth | Description                                              |
|--------|-------------------------------|------|----------------------------------------------------------|
| `GET`  | `/api/auth/me`                | ✓    | Returns the current user object                          |
| `PUT`  | `/api/auth/me`                | ✓    | Updates display name and weight unit                     |
| `PUT`  | `/api/auth/me/username`       | ✓    | Sets username (+ password on first call)                 |
| `PUT`  | `/api/auth/me/password`       | ✓    | Changes password (requires current password)             |
| `PUT`  | `/api/auth/me/password/forced`| ✓    | Forced password change (no current password needed; only when `mustChangePassword` is true) |

### `PUT /api/auth/me/username`

On the first call (no `passwordHash` present): sets both username **and** password.
On subsequent calls: changes only the username.

**Body:**
```json
{
  "username": "max_example",
  "password": "MyPassword123"
}
```

Username validation: `^[a-z0-9_.\-]+$`, 3–30 characters, unique (stored lowercase).

### `PUT /api/auth/me/password`

Regular users only (not admin – admins use `/api/admin/password`).

**Body:**
```json
{
  "currentPassword": "OldPassword",
  "newPassword": "NewPassword123"
}
```

After a successful change the client must update the `localStorage` token to
`username:newPassword` (the `AuthContext` handles this automatically via
`changePassword()`).

### `PUT /api/auth/me/password/forced`

Only callable when `user.mustChangePassword === true`. Does not require the current
password – the user is already authenticated via their session token.

**Body:**
```json
{
  "newPassword": "NewPassword123"
}
```

Clears `mustChangePassword` on success. The `AuthContext`'s `forceChangePassword()`
helper calls this endpoint and updates the `localStorage` token automatically.
