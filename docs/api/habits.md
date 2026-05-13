# Habits — `/api/habits`

All endpoints require authentication. All data is scoped to the authenticated user.

Habits have two layers:
- **Definitions** — the habit schema (name, unit, type). Predefined habits have `userId: null` and are shared across users.
- **Logs** — individual daily entries with a numeric value.
- **Selection** — which definitions are "active" for the current user.

---

## Definitions

### `GET /api/habits/definitions`

Returns all habit definitions (predefined + user's custom) with a `selected` flag and per-user settings merged in.

**Response `200`** — `HabitDefinition[]`

```json
[
  {
    "_id": "64a...",
    "name": "Wasser",
    "unitSymbol": "ml",
    "type": "amount",
    "isPredefined": true,
    "version": 1,
    "selected": true,
    "missingDayMode": "none",
    "defaultValue": 0
  }
]
```

| Field | Description |
|---|---|
| `isPredefined` | true for system habits, false for custom user habits |
| `selected` | Derived — whether the user has this habit active |
| `missingDayMode` | `"none"` or `"default"` — how missing days are treated in charts |
| `defaultValue` | Used when `missingDayMode` is `"default"` |

---

### `POST /api/habits/definitions`

Creates a new custom habit definition.

**Request body**
```json
{
  "name": "Meditation",
  "unitSymbol": "min",
  "type": "duration"
}
```

| Field | Type | Required | Values |
|---|---|---|---|
| `name` | string | yes | |
| `unitSymbol` | string | yes | e.g. `"min"`, `"ml"`, `"Stück"` |
| `type` | string | no | `"amount"` (default) or `"duration"` |

**Response `201`** — created HabitDefinition object

---

### `PUT /api/habits/definitions/:id`

Updates a custom habit definition. Only the user's own (non-predefined) definitions can be updated.

If `name` or `unitSymbol` changes, a history entry is recorded so that older logs still display their original label/unit.

**Request body** — any subset of `name`, `unitSymbol`, `type`.

**Response `200`** — updated HabitDefinition object  
**Error `404`** — not found, predefined, or belongs to another user

---

### `DELETE /api/habits/definitions/:id`

Deletes a custom habit definition. Existing logs are **not** deleted.

**Response `200`** `{ "success": true }`  
**Error `404`** — predefined habits cannot be deleted

---

## Selection

### `PUT /api/habits/selection`

Replaces the user's active habit selection.

**Request body**
```json
{
  "selectedIds": ["64a...", "64b..."]
}
```

**Response `200`** `{ "success": true }`

---

## Per-habit settings

### `PUT /api/habits/settings/:id`

Updates per-user chart settings for a specific habit (`:id` = HabitDefinition `_id`).

**Request body**
```json
{
  "missingDayMode": "default",
  "defaultValue": 0
}
```

| Field | Values | Description |
|---|---|---|
| `missingDayMode` | `"none"` \| `"default"` | How to handle days with no log entry in charts |
| `defaultValue` | number | Value to use when `missingDayMode` is `"default"` |

**Response `200`** `{ "success": true }`

---

## Logs

### `GET /api/habits/logs`

Returns habit log entries.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `startDate` | ISO 8601 | Filter: entries on or after this datetime |
| `endDate` | ISO 8601 | Filter: entries on or before this datetime |
| `habitId` | ObjectId | Filter by a specific habit definition |

**Response `200`** — `HabitLog[]`

```json
[
  {
    "_id": "64d...",
    "userId": "64b...",
    "habitId": {
      "_id": "64a...",
      "name": "Wasser",
      "unitSymbol": "ml"
    },
    "date": "2024-06-01T00:00:00.000Z",
    "value": 2000,
    "historicalUnit": "l"
  }
]
```

| Field | Description |
|---|---|
| `historicalUnit` | Present only if the unit was changed after this entry was recorded |

---

### `POST /api/habits/logs`

Creates or updates a log entry for a given habit on a given day (upsert by day boundary).

**Request body**
```json
{
  "habitId": "64a...",
  "date": "2024-06-01T12:00:00.000Z",
  "value": 2000
}
```

The entry is stored at midnight of the provided date; any existing entry for that calendar day is overwritten.

**Response `201`** — created/updated HabitLog object

---

### `DELETE /api/habits/logs/:id`

Deletes a specific log entry.

**Response `200`** `{ "success": true }`
