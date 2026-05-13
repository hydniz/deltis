# Data Export & Import — `/api/data`

All endpoints require authentication. All data is scoped to the authenticated user.

---

## `GET /api/data/export`

Exports all user data as a ZIP archive containing CSV and JSON files.

**Response `200`** — `application/zip` binary stream

**Content-Disposition:** `attachment; filename="habit-tracker-export-YYYY-MM-DD.zip"`

### ZIP contents

| File | Format | Contents |
|---|---|---|
| `weight.csv` | CSV | All weight entries (`date, weight, unit`) |
| `habits.csv` | CSV | All habit log entries (`date, habit_name, unit, value`) |
| `activities.csv` | CSV | All activity log entries (`date, activity_type, duration, distance, notes, custom_values`) |
| `settings.json` | JSON | User preferences and active habit selection |
| `activity_plans.json` | JSON | All scheduled activities |
| `habit_plans.json` | JSON | All scheduled habits |
| `goals.json` | JSON | All goals (ObjectId references resolved to human-readable names) |

### `settings.json` structure

```json
{
  "weightUnit": "kg",
  "selectedHabits": ["Wasser", "Schlaf"],
  "habitSettings": {
    "Wasser": { "missingDayMode": "default", "defaultValue": 0 }
  }
}
```

### `goals.json` structure

Goals are exported with `targetRefName` (human-readable name) instead of `targetRef` (ObjectId) to make the export portable.

---

## `POST /api/data/import`

Imports data from a ZIP archive previously created by the export endpoint. Uses upsert logic — existing entries for the same day/name are overwritten, nothing is deleted.

**Request body** — `multipart/form-data` with a single `file` field containing the `.zip` file.

**Constraints:**
- File must be a valid `.zip`
- Maximum file size: **10 MB**
- Only `.zip` extension is accepted

**Response `200`**
```json
{
  "weight": 45,
  "habits": 120,
  "activities": 87,
  "plans": 14,
  "goals": 3,
  "settings": true,
  "errors": [
    "activity (2024-01-15/Gym): duplicate key error"
  ]
}
```

| Field | Description |
|---|---|
| `weight` | Number of weight entries imported |
| `habits` | Number of habit log entries imported |
| `activities` | Number of activity log entries imported |
| `plans` | Total activity + habit plan entries imported |
| `goals` | Number of goals imported |
| `settings` | `true` if settings/preferences were restored |
| `errors` | Array of per-row error messages (non-fatal — processing continues) |

### Import behaviour per file

- **`weight.csv`** — Upserts by `userId + date` (day boundary)
- **`habits.csv`** — Resolves or creates HabitDefinition by name; upserts log by `userId + habitId + date`
- **`activities.csv`** — Resolves or creates ActivityType by label; upserts by `userId + type + date + duration + distance`
- **`settings.json`** — Restores `weightUnit`, selected habits, and habit settings; resolves habit names to ObjectIds
- **`activity_plans.json`** — Upserts by `userId + activityType + scheduledDate`
- **`habit_plans.json`** — Upserts by `userId + habitId + scheduledDate`
- **`goals.json`** — Upserts by `userId + name`; resolves `targetRefName` back to an ObjectId
