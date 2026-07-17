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

---

## Meta goals (Gesamtziele)

Goals with `type: "meta"` bundle other goals: met when at least `targetValue`
of their child goals are met (e.g. "Trainingswoche = 3 von 4 Zielen").

- Create/update with `childGoalIds: [goalId, …]` — the server manages the
  `parentGoalId` pointer on the children (a child has at most **one** parent;
  a parent may have many children; meta goals cannot be children).
- `targetRef`/`targetRefModel` are server-owned (`"meta"` / `"Goal"`).
- Enrichment: meta goals carry `childGoals: [{_id, name}]`; children carry
  `parentGoal: {_id, name}`.
- `GET /:id/progress` returns a synthetic `subgoals` condition plus
  `childResults: [{_id, name, met}]`.
- Deleting a meta goal frees its children (`parentGoalId: null`).

## `GET /api/goals/:id/items`

The entries contributing to the goal's **current interval** — explains the
progress value ("which Strava activities / logs / sub-goals count?").

**Response `200`** — `{ "kind": "strava"|"activity"|"habit"|"meta", "start", "end", "entries": [...] }`

Entry shapes: strava → normalized integration matches (name, sportType, date,
movingTime, distance); activity → activity logs; habit → habit logs
(date, value); meta → child results (name, met).

## Training types on goals

Strava goals may reference a saved training type instead of their own
criteria tree: `trainingTypeId` (own types only, `404` otherwise). The type's
per-integration criteria map then defines what counts; `targetName` becomes
the type name. See [training-types.md](training-types.md).
