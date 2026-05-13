# Auth — `/api/auth`

All endpoints except `POST /login` and `POST /logout` require the session cookie to be present.  
The cookie is set automatically by `POST /login` and cleared by `POST /logout`.

---

## `POST /api/auth/login`

Verifies credentials once and issues a **30-day httpOnly JWT cookie** (`auth_token`).

**Auth required:** no

**Request body**
```json
{
  "identifier": "jannis",
  "password": "mysecretpassword"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `identifier` | string | yes | Username or UUID (UUID only works in legacy migration mode) |
| `password` | string | conditional | Required if the user has a password set |

**Identifier resolution order:**
1. Lookup by `username` (standard)
2. Lookup by `uuid` (legacy — only allowed if the user has no `username` yet)

**Cookie set on success**

| Attribute | Value |
|---|---|
| Name | `auth_token` |
| `HttpOnly` | ✓ — inaccessible to JavaScript |
| `Secure` | ✓ in production, ✗ in development |
| `SameSite` | `Lax` |
| `MaxAge` | 30 days |

**Response `200`** — user object (same shape as `GET /me`)

**Error responses**

| HTTP | `code` | Condition |
|---|---|---|
| `401` | `UUID_BLOCKED` | Login via UUID after username was already set |
| `401` | `PASSWORD_REQUIRED` | User has a password but none was provided |
| `401` | — | Wrong password |
| `401` | — | Unknown identifier |

---

## `POST /api/auth/logout`

Clears the `auth_token` cookie.

**Auth required:** no

**Response `200`**
```json
{ "ok": true }
```

---

## `GET /api/auth/me`

Returns the currently authenticated user. Used to restore a session on page load.

**Auth required:** yes (cookie)

**Response `200`**
```json
{
  "_id": "64a1b2c3d4e5f6a7b8c9d0e1",
  "name": "Jannis",
  "username": "jannis",
  "isAdmin": false,
  "mustChangePassword": false,
  "weightUnit": "kg",
  "createdAt": "2024-01-15T10:00:00.000Z",
  "hasPassword": true
}
```

| Field | Description |
|---|---|
| `hasPassword` | Derived — `true` if user has a `passwordHash` or `adminSecretHash` |
| `mustChangePassword` | `true` when admin created the account with a temporary password |

---

## `PUT /api/auth/me`

Updates the current user's display name and weight unit preference.

**Auth required:** yes

**Request body**
```json
{
  "name": "Jannis",
  "weightUnit": "kg"
}
```

**Response `200`** — updated user object

---

## `PUT /api/auth/me/username`

Sets or changes the username. Password is required only during **first-time setup** (when the user has no credentials yet).

**Auth required:** yes

**Request body**
```json
{
  "username": "jannis",
  "password": "mysecretpassword"
}
```

| Field | Constraint |
|---|---|
| `username` | 3–30 chars, lowercase `a-z 0-9 _ . -` |
| `password` | Required only if user has no credentials yet. Min 8 chars. |

**Response `200`** — updated user object  
**Error `409`** — username already taken

> The JWT cookie stays valid after a username change — the token is tied to `userId`, not the identifier.

---

## `PUT /api/auth/me/password`

Changes the current user's password. Requires the correct current password.

**Auth required:** yes

**Request body**
```json
{
  "currentPassword": "oldpassword",
  "newPassword": "newpassword123"
}
```

**Response `200`** `{ "ok": true }`  
**Error `401`** — current password is wrong

> The JWT cookie stays valid after a password change.

---

## `PUT /api/auth/me/password/forced`

Changes the password without providing the current password. Only allowed when `mustChangePassword === true`.

**Auth required:** yes

**Request body**
```json
{
  "newPassword": "newpassword123"
}
```

**Response `200`** `{ "ok": true }`  
**Error `400`** — no forced password change is pending
