# Training Types — `/api/training-types`

User-defined, reusable criteria bundles ("Zone 2", "Langer Lauf", …) usable
in goals (`trainingTypeId`) and the weekly planner (planned trainings).
All endpoints require authentication; data is scoped to the user.

A training type carries **criteria per integration** — an activity fulfils
the type when it matches the criteria of any integration it came from:

```json
{
  "name": "Zone 2",
  "description": "Ruhiges Ausdauertraining",
  "criteria": {
    "strava": {
      "operator": "AND",
      "rules": [
        { "kind": "sportType", "values": ["Run", "Ride", "Swim"] },
        { "kind": "hrPercentInRange", "minHr": 120, "maxHr": 145, "minPercent": 85 }
      ]
    }
  }
}
```

Adding a future integration (e.g. Garmin) adds a new key to the map — the
registry in `server/services/trainingCriteria.js` validates and evaluates
each integration's tree (Strava trees: see [strava.md](strava.md#rule-kinds)).

| Endpoint | Description |
|---|---|
| `GET /api/training-types` | List the user's types (sorted by name) |
| `POST /api/training-types` | Create — `400` invalid criteria/name, `409` duplicate name |
| `PUT /api/training-types/:id` | Update |
| `DELETE /api/training-types/:id` | Delete — `409` while goals or planned trainings still reference it |

## Planned trainings — `/api/planner/trainings`

"Montag Zone-2-Training": a planned training references a saved type
(`trainingTypeId`) **or** carries an ad-hoc `criteria` map. Fulfilment is
computed at read time — a plan is `completed` when a synced activity of the
same **local** calendar day matches; `fulfilledBy` carries that activity.

| Endpoint | Description |
|---|---|
| `GET /api/planner/trainings?startDate&endDate` | Plans incl. computed `completed`, `fulfilledBy`, `trainingTypeName` |
| `POST /api/planner/trainings` | `{ scheduledDate, trainingTypeId \| criteria, notes? }` |
| `PUT /api/planner/trainings/:id` | Move/edit |
| `DELETE /api/planner/trainings/:id` | Remove |
