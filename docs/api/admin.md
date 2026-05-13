# Admin — `/api/admin`

Admin routes are split into **public setup routes** (no auth) and **protected admin-only routes**.  
Protected routes require both authentication (`Authorization: Bearer`) and `user.isAdmin === true`.

---

## Public setup routes

These routes are only useful during the very first deployment when no admin password has been set yet.

### `GET /api/admin/setup-status`

Returns whether the initial admin setup is still pending.

**Auth required:** no

**Response `200`**
```json
{
  "setupNeeded": true,
  "adminUuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

| Field | Description |
|---|---|
| `setupNeeded` | `true` if the admin user exists but has no password set |
| `adminUuid` | The admin UUID — only present when `setupNeeded` is `true` |

---

### `POST /api/admin/setup`

Sets the initial admin password. Can only be called once; fails if setup is already complete.

**Auth required:** no

**Request body**
```json
{
  "password": "mysecretpassword"
}
```

| Field | Constraint |
|---|---|
| `password` | Min 8 characters |

**Response `200`** `{ "ok": true }`  
**Error `400`** — setup already completed

---

## Protected admin routes

All routes below require a valid `auth_token` httpOnly cookie (same as every other protected route — see [README.md](README.md)).  
Attempting to call them as a non-admin user returns `403 Forbidden`.

---

### `GET /api/admin/users`

Returns all users, sorted by creation date.

**Response `200`** — `User[]`

```json
[
  {
    "_id": "64b...",
    "uuid": "xxxxxxxx-...",
    "username": "jannis",
    "name": "Jannis",
    "isAdmin": false,
    "mustChangePassword": false,
    "createdAt": "2024-01-15T10:00:00.000Z"
  }
]
```

---

### `POST /api/admin/users`

Creates a new user with a username and temporary password.

**Request body**
```json
{
  "username": "newuser",
  "password": "temppassword123",
  "name": "New User",
  "isAdmin": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `username` | string | yes | 3–30 chars, `a-z 0-9 _ . -` |
| `password` | string | yes | Min 8 chars — temporary, user must change on first login |
| `name` | string | no | Display name (defaults to username) |
| `isAdmin` | boolean | no | Grants admin privileges |

**Side effect:** The created user has `mustChangePassword: true` — the frontend will show a forced password change modal on their first login.

**Response `201`**
```json
{
  "_id": "652...",
  "username": "newuser",
  "name": "New User",
  "isAdmin": false,
  "mustChangePassword": true,
  "createdAt": "2024-06-01T00:00:00.000Z"
}
```

**Error `409`** — username already taken

---

### `PUT /api/admin/users/:id`

Edits a user's username, name, or password. Cannot edit admin accounts via this endpoint.

**Request body** — any combination of:
```json
{
  "username": "newusername",
  "name": "New Display Name",
  "password": "newpassword123"
}
```

If `password` is provided and non-empty, `mustChangePassword` is automatically set to `true`.

**Response `200`** — updated user object  
**Error `400`** — target user is an admin account  
**Error `404`** — user not found

---

### `DELETE /api/admin/users/:id`

Deletes a user. Admins cannot delete themselves.

**Response `200`** `{ "ok": true }`  
**Error `400`** — attempting to delete own account  
**Error `404`** — user not found
