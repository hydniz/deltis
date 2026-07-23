# `/api/health` — Health Connect

Endpoints used by the Android companion app (`deltis-android-companion`) to
push Android Health Connect data into Deltis. All routes require the session
cookie. The deduplication rules behind them are described in
[`docs/HEALTH.md`](../HEALTH.md).

Introduced in **apiVersion 15**.

---

## `GET /api/health/config`

What the app needs before reading anything from Health Connect.

**200 — connected**

```json
{
  "connected": true,
  "deviceId": "…",
  "deviceName": "Pixel 8",
  "enabledTypes": ["exercise", "weight"],
  "backfillDays": 30,
  "excludedOrigins": ["com.strava"],
  "lastSyncAt": "2026-07-23T20:00:00.000Z",
  "lastSyncCounts": { "activities": 12, "weights": { "imported": 3 } },
  "supportedTypes": ["exercise", "weight", "steps", "heartRate", "sleep", "activeCalories", "distance"],
  "minBackfillDays": 7,
  "maxBackfillDays": 365
}
```

**200 — not connected** — same shape with `connected: false` and the defaults.

`excludedOrigins` lists package names the app **must skip** while reading: those
sources are already ingested server-side (Strava), so uploading them would
duplicate every workout.

---

## `POST /api/health/connect`

Registers the device and stores the user's consent.

```json
{
  "deviceId": "install-uuid",
  "deviceName": "Pixel 8",
  "platform": "android",
  "appVersion": "0.1.0",
  "enabledTypes": ["exercise", "weight"],
  "backfillDays": 30
}
```

- `deviceId` is required → `400` otherwise.
- `backfillDays` is clamped to **7 … 365**; a non-numeric value falls back to 30.
- Unknown entries in `enabledTypes` are dropped; if nothing valid remains the
  default `["exercise", "weight"]` is kept.
- Calling it again updates the existing connection (one per user).

**201** → the `GET /config` payload.

---

## `PUT /api/health/config`

Changes `enabledTypes` and/or `backfillDays` with the same clamping.
Omitted fields keep their stored value. **404** when not connected.

---

## `POST /api/health/sync`

The upload. **Idempotent** — safe to replay any window.

```json
{
  "activities": [
    {
      "id": "health-connect-record-uuid",
      "exerciseType": "EXERCISE_TYPE_RUNNING",
      "title": "Morgenlauf",
      "startTime": "2026-05-01T08:00:00.000Z",
      "endTime": "2026-05-01T09:00:00.000Z",
      "startTimeLocal": "2026-05-01T10:00:00.000Z",
      "zoneOffset": "+02:00",
      "dataOrigin": "com.garmin.android.apps.connectmobile",
      "lastModifiedTime": "2026-05-01T09:05:00.000Z",
      "distanceMeters": 10000,
      "activeDurationSeconds": 3500,
      "elevationGainMeters": 120,
      "totalEnergyKcal": 700,
      "activeEnergyKcal": 640,
      "steps": 9000,
      "avgHeartRate": 150,
      "maxHeartRate": 172,
      "heartRateSamples": [{ "time": "2026-05-01T08:00:00.000Z", "bpm": 120 }]
    }
  ],
  "weights": [
    { "id": "weight-record-uuid", "time": "2026-05-01T06:00:00.000Z", "weightKg": 78.4 }
  ]
}
```

Only `id`, `startTime` and `endTime` are required per activity; `endTime` must
not precede `startTime`. Invalid records are skipped silently.

**200**

```json
{
  "success": true,
  "activities": 1,
  "rejectedOrigins": 0,
  "weights": { "imported": 1, "skipped": 0, "collapsed": 0 },
  "merge": { "checked": 1, "superseded": 0, "promoted": 0 }
}
```

- `rejectedOrigins` — records dropped because their `dataOrigin` is excluded.
- `weights.skipped` — days left untouched because a **manual** entry exists.
- `weights.collapsed` — same-day health readings reduced to the latest.
- `merge.superseded` — sessions flagged as duplicates of a Strava activity or
  a better health record.

**Errors** — `404` not connected, `413` more than 500 records in one request
(page through longer backfills), `400` on storage failure.

---

## `GET /api/health/activities`

Query: `startDate`, `endDate`, `limit` (default 100, max 500),
`includeSuperseded=true`.

Returns synced sessions newest first, without `raw` and `streams`. Superseded
duplicates are hidden unless requested — which is how a settings screen can
show what was deduplicated.

---

## `DELETE /api/health/connect`

Removes the connection. Imported sessions are **kept** unless `?purge=true`,
which deletes them and reports `{ "removed": n }`. The weight log is never
purged automatically.

---

## Effect on the rest of the API

Health sessions register as a `health` entry in the training-criteria
integration registry, so criteria maps accept

```json
{ "health": { "operator": "AND", "rules": [{ "kind": "sportType", "values": ["run"] }] } }
```

alongside `strava`, with the rule kinds `sportType`, `metricRange`,
`hrPercentInRange` and `group`. Habits, goals and the planner consume this
automatically — and only **canonical** (non-duplicate) sessions are matched, so
nothing is ever counted twice.

`GET /api/weight` entries additionally carry `source` (`manual` | `health`) and
`sourceId`.
