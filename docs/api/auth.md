# Auth — `/api/auth`

All endpoints except the public admin setup routes require a valid `Authorization: Bearer` header.  
See [README.md](README.md) for the token format.

---

## `GET /api/auth/me`

Returns the currently authenticated user.

**Auth required:** yes

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

| Field | Type | Description |
|---|---|---|
| `hasPassword` | boolean | Derived — true if user has a passwordHash or adminSecretHash |
| `mustChangePassword` | boolean | Admin-set flag; frontend shows forced password change modal when true |

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

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | no | Display name |
| `weightUnit` | `"kg"` \| `"lbs"` | no | Preferred weight unit |

**Response `200`** — updated user object (same shape as `GET /me`)

---

## `PUT /api/auth/me/username`

Sets or changes the username. Also sets the password during **first-time setup** (when the user has no credentials yet).

**Auth required:** yes

**Request body**
```json
{
  "username": "jannis",
  "password": "mysecretpassword"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `username` | string | yes | 3–30 chars, lowercase `a-z 0-9 _ . -` |
| `password` | string | conditional | Required only if user has no credentials yet (first-time setup). Min 8 chars. |

**Validation errors**

| HTTP | Condition |
|---|---|
| `400` | Username too short/long or invalid characters |
| `409` | Username already taken by another user |

**Response `200`** — updated user object

**Side effect:** The frontend must update `auth_token` in localStorage to `newUsername:password` after a successful username change.

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

| Field | Type | Required |
|---|---|---|
| `currentPassword` | string | yes |
| `newPassword` | string | yes, min 8 chars |

**Response `200`**
```json
{ "ok": true }
```

**Error `401`** — current password is wrong

---

## `PUT /api/auth/me/password/forced`

Changes the password without requiring the current password. Only allowed when `mustChangePassword` is `true` on the user record (set by admin).

**Auth required:** yes  
**Condition:** `req.user.mustChangePassword === true`

**Request body**
```json
{
  "newPassword": "newpassword123"
}
```

**Response `200`**
```json
{ "ok": true }
```

**Error `400`** — no forced password change is pending for this user
