# Deltis — Backend API Reference

**Base URL:** `/api`  
**Current API version:** `1`  
**Format:** JSON (`Content-Type: application/json`)

---

## Table of Contents

| Resource | File | Base path |
|---|---|---|
| Overview & Auth | this file | — |
| Version & compatibility | this file | `GET /api` |
| User / Auth | [auth.md](auth.md) | `/api/auth` |
| Activities | [activities.md](activities.md) | `/api/activities` |
| Activity Types | [activities.md](activities.md) | `/api/activity-types` |
| Habits | [habits.md](habits.md) | `/api/habits` |
| Goals | [goals.md](goals.md) | `/api/goals` |
| Planner | [planner.md](planner.md) | `/api/planner` |
| Weight | [weight.md](weight.md) | `/api/weight` |
| Data (export/import) | [data.md](data.md) | `/api/data` |
| Admin | [admin.md](admin.md) | `/api/admin` |

---

## Authentication

The API uses **stateless per-request authentication**. There is no login endpoint that returns a session token — instead, credentials are sent with every request.

### Token format

```
Authorization: Bearer <identifier>:<password>
```

| Part | Description |
|---|---|
| `identifier` | Username (lowercase) or UUID (legacy only) |
| `password` | User's current password |

The token is the literal string `identifier:password`, Base64 is **not** used.

**Example:**
```http
GET /api/auth/me
Authorization: Bearer jannis:mysecretpassword
```

### Login flow (frontend)

1. Build token: `identifier + ":" + password`
2. Store in `localStorage` as `auth_token`
3. Verify by calling `GET /api/auth/me` — success means credentials are valid
4. On every subsequent request the axios interceptor reads `auth_token` and attaches it as the `Bearer` header

### Error codes

| HTTP | `code` field | Meaning |
|---|---|---|
| `401` | — | Missing or invalid `Authorization` header |
| `401` | `UUID_BLOCKED` | UUID login attempted after username was set |
| `401` | `PASSWORD_REQUIRED` | Identifier recognised but no password provided |
| `401` | — | Wrong password |
| `403` | — | Authenticated but insufficient permissions (admin-only route) |
| `404` | — | Resource not found or belongs to another user |

### Standard error body

```json
{ "error": "Human-readable message", "code": "OPTIONAL_MACHINE_CODE" }
```

---

## Version endpoint

### `GET /api`

Returns the running versions. No authentication required.

**Response `200`**
```json
{
  "version": "0.3.0",
  "apiVersion": 1
}
```

| Field | Type | Description |
|---|---|---|
| `version` | string | App version string (`semver[-stage][+commit]`) |
| `apiVersion` | integer | API contract version (see compatibility rules below) |

---

## API Compatibility

Frontend and backend version numbers are **independent**. Compatibility is tracked via `apiVersion`.

### Rules

| Situation | Action required |
|---|---|
| Frontend-only change (UI, refactor) | Nothing |
| Non-breaking backend change (new optional field) | Nothing |
| **Breaking** change (removed/renamed endpoint or field shape) | Bump `apiVersion` in root `package.json` **and** `REQUIRED_API_VERSION` in `client/src/config/compatibility.js` |
| Frontend requires a new backend feature | Bump `REQUIRED_API_VERSION` only |

On every page load the frontend compares `res.data.apiVersion` against `REQUIRED_API_VERSION`. A mismatch shows a persistent warning banner and logs `✗ INCOMPATIBLE` to the browser console.

### History

| `apiVersion` | Changes |
|---|---|
| `1` | Initial version |
