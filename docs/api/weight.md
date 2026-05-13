# Weight — `/api/weight`

All endpoints require authentication. All data is scoped to the authenticated user.

---

## `GET /api/weight`

Returns weight log entries, sorted ascending by date.

**Query parameters**

| Param | Type | Description |
|---|---|---|
| `startDate` | ISO 8601 | Filter: entries on or after this date |
| `endDate` | ISO 8601 | Filter: entries on or before this date |
| `limit` | integer | Max results (default `200`) |

**Response `200`** — `WeightLog[]`

```json
[
  {
    "_id": "651...",
    "userId": "64b...",
    "date": "2024-06-01T00:00:00.000Z",
    "weight": 78.5,
    "unit": "kg"
  }
]
```

---

## `POST /api/weight`

Creates a new weight log entry.

**Request body**
```json
{
  "date": "2024-06-01T12:00:00.000Z",
  "weight": 78.5,
  "unit": "kg"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `date` | ISO 8601 | yes | Date of the measurement |
| `weight` | number | yes | Weight value |
| `unit` | `"kg"` \| `"lbs"` | no | Defaults to the user's `weightUnit` preference |

**Response `201`** — created WeightLog object

---

## `DELETE /api/weight/:id`

Deletes a weight entry.

**Response `200`** `{ "success": true }`
