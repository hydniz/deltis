# Activities — `/api/activities` & `/api/activity-types`

All endpoints require authentication. All data is scoped to the authenticated user.

---

## Activity Logs — `/api/activities`

### `GET /api/activities`

Returns a paginated list of activity logs.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `startDate` | ISO 8601 | Filter: entries on or after this date |
| `endDate` | ISO 8601 | Filter: entries on or before this date |
| `typeRef` | ObjectId string | Filter by activity type (preferred) |
| `type` | string | Filter by legacy label string |
| `limit` | integer | Max results (default `50`) |
| `skip` | integer | Offset for pagination (default `0`) |

**Response `200`**
```json
{
  "activities": [ /* ActivityLog[] */ ],
  "total": 42
}
```

**ActivityLog object**
```json
{
  "_id": "64a...",
  "userId": "64b...",
  "activityType": "Gym",
  "activityTypeRef": {
    "_id": "64c...",
    "label": "Gym",
    "showDuration": true,
    "showDistance": false,
    "customFields": []
  },
  "date": "2024-06-01T12:00:00.000Z",
  "duration": 60,
  "distance": null,
  "notes": "Good session",
  "customValues": { "workoutPlan": "Push" },
  "historicalLabel": "Old Gym Name",
  "historicalCustomFields": []
}
```

| Field | Description |
|---|---|
| `activityTypeRef` | Populated reference to the current ActivityType definition |
| `historicalLabel` | Present only if the type was renamed after this entry was recorded |
| `historicalCustomFields` | Present only if custom fields were changed after recording |

---

### `POST /api/activities`

Creates a new activity log entry.

**Request body**
```json
{
  "activityType": "Gym",
  "activityTypeRef": "64c...",
  "date": "2024-06-01T12:00:00.000Z",
  "duration": 60,
  "distance": null,
  "notes": "Optional note",
  "customValues": { "workoutPlan": "Push" }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `activityType` | string | yes | Display label (legacy field, still required) |
| `activityTypeRef` | ObjectId | recommended | Reference to the ActivityType document |
| `date` | ISO 8601 | yes | Date/time of the activity |
| `duration` | number | no | Duration in minutes |
| `distance` | number | no | Distance in km |
| `notes` | string | no | Free text |
| `customValues` | object | no | Map of `fieldKey → value` for custom fields |

**Response `201`** — created ActivityLog object

---

### `PUT /api/activities/:id`

Updates an existing activity log. Only the owning user can update.

**Request body** — any subset of the fields above except `activityType` and `activityTypeRef`.

**Response `200`** — updated ActivityLog object  
**Error `404`** — not found or belongs to another user

---

### `DELETE /api/activities/:id`

Deletes an activity log.

**Response `200`**
```json
{ "success": true }
```

---

## Activity Types — `/api/activity-types`

Activity types define the schema for activity logs (which fields appear, custom fields, etc.).

### `GET /api/activity-types`

Returns all activity types for the current user. If none exist yet, a set of defaults is created automatically:

> Gym, Joggen, Radfahren, Schwimmen, Yoga, Wandern, Sonstiges

**Response `200`** — `ActivityType[]`

**ActivityType object**
```json
{
  "_id": "64c...",
  "userId": "64b...",
  "label": "Gym",
  "showDuration": true,
  "showDistance": false,
  "customFields": [
    {
      "key": "workoutPlan",
      "label": "Trainingsplan",
      "type": "select",
      "options": ["Push", "Pull", "Legs"],
      "unit": "",
      "showInPreview": true
    }
  ],
  "version": 2,
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

**CustomField types**

| `type` | Description | Relevant field |
|---|---|---|
| `number` | Numeric input | `unit` — displayed next to input |
| `select` | Single-choice dropdown | `options` — list of choices |
| `multiselect` | Multi-choice checkboxes | `options` — list of choices |

---

### `POST /api/activity-types`

Creates a new activity type.

**Request body**
```json
{
  "label": "Klettern",
  "showDuration": true,
  "showDistance": false,
  "customFields": []
}
```

**Response `201`** — created ActivityType object

---

### `PUT /api/activity-types/:id`

Updates an activity type. If the `label` or `customFields` change, a history entry is created so that older activity logs can still display their original field labels.

**Request body** — same shape as POST, fields are optional.

**Important:** The `key` of existing custom fields is **immutable**. Sending a different key for an existing field position is silently corrected to the original key. New fields get a key auto-derived from their label.

**Response `200`** — updated ActivityType object  
**Error `404`** — not found or belongs to another user

---

### `DELETE /api/activity-types/:id`

Deletes an activity type. Existing activity logs that reference this type are **not** deleted — they retain the type label string.

**Response `200`**
```json
{ "success": true }
```
