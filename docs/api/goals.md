# Goals — `/api/goals`

All endpoints require authentication. All data is scoped to the authenticated user.

Goals track whether a user meets a measurable target over a time interval or a long-term period.

---

## Goal types

| `type` value | Description |
|---|---|
| `periodic-activity` | Repeating interval (daily/weekly/monthly), tracking an activity |
| `periodic-habit` | Repeating interval, tracking a habit |
| `periodic-strava` | Repeating interval, counting synced Strava activities that match the goal's criteria (see [Strava goals](#strava-goals)) |
| `long-term-activity` | Fixed start/end date with optional milestones, tracking an activity |
| `long-term-habit` | Fixed start/end date with optional milestones, tracking a habit |

---

## Metrics

| `metric` | Applies to | Description |
|---|---|---|
| `count` | activity, habit | Number of activity entries / habit log days |
| `duration` | activity | Sum/max of duration in minutes |
| `distance` | activity | Sum/max of distance in km |
| `value` | habit | Sum/average of logged values |
| `custom_<key>` | activity | Sum/max of a numeric custom field |
| `select_<key>:<option>` | activity | Count of entries where a select field equals an option |

---

## `GET /api/goals`

Returns all active goals for the current user, enriched with the target's display name and custom field definitions.

**Response `200`** — `Goal[]`

```json
[
  {
    "_id": "64e...",
    "name": "Öfter Laufen",
    "type": "periodic-activity",
    "targetRef": "64c...",
    "targetRefModel": "ActivityType",
    "targetName": "Joggen",
    "customFields": [],
    "intervalValue": 1,
    "intervalUnit": "week",
    "conditionOperator": "AND",
    "conditions": [
      {
        "metric": "count",
        "condition": "min",
        "targetValue": 3,
        "unitSymbol": "Mal",
        "valueScope": "total",
        "aggregation": "sum",
        "activityFilters": []
      }
    ],
    "isActive": true,
    "metricWarnings": []
  }
]
```

| Field | Description |
|---|---|
| `targetName` | Resolved display name of the referenced ActivityType or HabitDefinition |
| `customFields` | Current custom field definitions of the referenced ActivityType |
| `metricWarnings` | Non-empty if a condition's metric references a field that no longer exists |

---

## `GET /api/goals/:id/progress`

Calculates and returns the current progress for a goal.

**Response `200`**
```json
{
  "conditions": [
    {
      "metric": "count",
      "condition": "min",
      "targetValue": 3,
      "unitSymbol": "Mal",
      "currentValue": 2,
      "met": false
    }
  ],
  "conditionOperator": "AND",
  "met": false,
  "weeklyData": [
    { "weekStart": "2024-05-20T00:00:00.000Z", "value": 4 }
  ],
  "stepResults": []
}
```

| Field | Description |
|---|---|
| `conditions` | Per-condition current value and whether it is met |
| `met` | Overall goal status considering `conditionOperator` (`AND`/`OR`) |
| `weeklyData` | For long-term goals: weekly aggregated values (first metric only) |
| `stepResults` | For long-term goals: milestone achievement status |

**Interval calculation:** For periodic goals the current interval starts at the beginning of the current week/month and covers `intervalValue` × `intervalUnit` back from now.

---

## `POST /api/goals`

Creates a new goal.

**Request body**
```json
{
  "name": "Öfter Laufen",
  "description": "Mindestens 3x pro Woche laufen",
  "type": "periodic-activity",
  "targetRef": "64c...",
  "targetRefModel": "ActivityType",
  "intervalValue": 1,
  "intervalUnit": "week",
  "conditionOperator": "AND",
  "conditions": [
    {
      "metric": "count",
      "condition": "min",
      "targetValue": 3,
      "unitSymbol": "Mal",
      "valueScope": "total",
      "aggregation": "sum",
      "activityFilters": []
    }
  ],
  "startDate": null,
  "endDate": null,
  "intermediateSteps": []
}
```

**Condition object**

| Field | Type | Description |
|---|---|---|
| `metric` | string | See metrics table above |
| `condition` | `"min"` \| `"max"` \| `"exact"` | How to compare `currentValue` with `targetValue` |
| `targetValue` | number | The threshold |
| `unitSymbol` | string | Display unit (e.g. `"Mal"`, `"km"`, `"min"`) |
| `valueScope` | `"total"` \| `"perActivity"` | Sum or average across activities |
| `aggregation` | `"sum"` \| `"max"` | Aggregate function (max = personal best) |
| `activityFilters` | ActivityFilter[] | Additional filters for "personal best" conditions |

**ActivityFilter object**

```json
{
  "fieldKey": "workoutPlan",
  "fieldType": "select",
  "operator": "anyOf",
  "values": ["Push", "Pull"],
  "numOperator": "min",
  "numValue": null
}
```

**Response `201`** — created Goal object (enriched)

---

## `PUT /api/goals/:id`

Updates an existing goal.

**Request body** — any subset of the POST fields.

**Response `200`** — updated Goal object (enriched)  
**Error `404`** — not found or belongs to another user

---

## `DELETE /api/goals/:id`

Deletes a goal.

**Response `200`** `{ "success": true }`

---

## Strava goals

Goals with `targetRefModel: "StravaActivity"` (type `periodic-strava`) count
synced Strava activities instead of manual logs. `targetRef` holds the fixed
string `"strava"` — the matching set is defined by the `stravaCriteria` rule
tree, which is validated by the criteria engine on create/update (`400
Ungültige Strava-Kriterien: …` on invalid trees). `stravaCriteria: null`
means every synced activity counts.

Supported metrics: `count`, `duration` (sum of moving time in minutes),
`distance` (sum in km) — each over the set of matching activities.

Full rule reference and examples: [strava.md](strava.md#strava-goals).
