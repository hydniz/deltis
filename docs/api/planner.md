# Planner — `/api/planner`

All endpoints require authentication. All data is scoped to the authenticated user.

The planner has two sub-resources: **activity plans** (scheduled workouts) and **habit plans** (scheduled daily habits).

---

## Activity Plans

### `GET /api/planner`

Returns scheduled activity entries within an optional date range.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `startDate` | ISO 8601 | Filter: entries on or after this date |
| `endDate` | ISO 8601 | Filter: entries on or before this date (inclusive, extended to 23:59:59) |

**Response `200`** — `ActivityPlan[]`

```json
[
  {
    "_id": "64f...",
    "userId": "64b...",
    "activityType": "Gym",
    "activityTypeRef": {
      "_id": "64c...",
      "label": "Gym",
      "showDuration": true,
      "showDistance": false,
      "customFields": []
    },
    "scheduledDate": "2024-06-03T00:00:00.000Z",
    "duration": 60,
    "distance": null,
    "notes": "",
    "completed": false,
    "customValues": {},
    "historicalLabel": null
  }
]
```

---

### `POST /api/planner`

Schedules a new activity.

**Request body**
```json
{
  "activityType": "Gym",
  "activityTypeRef": "64c...",
  "scheduledDate": "2024-06-03T00:00:00.000Z",
  "duration": 60,
  "distance": null,
  "notes": "",
  "customValues": {}
}
```

**Response `201`** — created ActivityPlan object

---

### `PUT /api/planner/:id`

Updates a scheduled activity (e.g. mark as completed, change date).

**Request body** — any subset of the POST fields.

**Response `200`** — updated ActivityPlan object  
**Error `404`** — not found or belongs to another user

---

### `DELETE /api/planner/:id`

Deletes a scheduled activity.

**Response `200`** `{ "success": true }`

---

## Habit Plans

### `GET /api/planner/habits`

Returns scheduled habit entries within an optional date range.

**Query parameters** — same as `GET /api/planner`

**Response `200`** — `HabitPlan[]`

```json
[
  {
    "_id": "650...",
    "userId": "64b...",
    "habitId": {
      "_id": "64a...",
      "name": "Meditation",
      "unitSymbol": "min",
      "type": "duration"
    },
    "habitName": "Meditation",
    "unitSymbol": "min",
    "habitType": "duration",
    "scheduledDate": "2024-06-03T00:00:00.000Z",
    "notes": "",
    "completed": false,
    "loggedValue": null
  }
]
```

---

### `POST /api/planner/habits`

Schedules a habit for a specific date.

**Request body**
```json
{
  "habitId": "64a...",
  "scheduledDate": "2024-06-03T00:00:00.000Z",
  "notes": ""
}
```

**Response `201`** — created HabitPlan object

---

### `POST /api/planner/habits/:id/complete`

Marks a scheduled habit as completed and optionally creates a HabitLog entry.

**Request body**
```json
{
  "value": 20,
  "date": "2024-06-03T12:00:00.000Z"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `value` | number | no | Logged amount. Defaults to `1`. |
| `date` | ISO 8601 | no | Date for the log entry. Defaults to `scheduledDate`. |

**Side effect:** Creates a `HabitLog` entry for the given habit and date.

**Response `200`** — updated HabitPlan object (with `completed: true`, `loggedValue` set)

---

### `PUT /api/planner/habits/:id`

Updates a scheduled habit plan entry.

**Request body** — any subset of the POST fields.

**Response `200`** — updated HabitPlan object  
**Error `404`** — not found or belongs to another user

---

### `DELETE /api/planner/habits/:id`

Deletes a scheduled habit plan entry.

**Response `200`** `{ "success": true }`
