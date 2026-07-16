# Strava — `/api/strava`

Integration with the Strava API: per-user OAuth connection, automatic
activity sync (webhook + polling), synced activities and admin-side webhook
subscription management.

All endpoints require authentication unless noted otherwise. `/callback` and
`/webhook` are public by design (OAuth redirect / Strava push events).

Setup guide (credentials, callback domain, capacity limits): see
[docs/STRAVA.md](../STRAVA.md).

---

## `GET /api/strava/status`

Integration state for the current user.

**Response `200`**

```json
{
  "configured": true,
  "connected": true,
  "connection": {
    "athleteId": 4711,
    "athlete": { "id": 4711, "firstname": "…", "lastname": "…" },
    "scope": "read,activity:read_all",
    "initialSyncDone": true,
    "lastSyncAt": "2026-07-15T10:00:00.000Z",
    "lastSyncError": null,
    "createdAt": "2026-07-10T08:00:00.000Z"
  },
  "activityCount": 12
}
```

`configured` — Strava client credentials are set on the server.
Access/refresh tokens are never included in any response.

---

## `GET /api/strava/connect`

Returns the Strava authorization URL. The client redirects the browser there.
The `state` parameter is a signed, short-lived token identifying the user.

**Response `200`** — `{ "url": "https://www.strava.com/oauth/authorize?…" }`
**Response `400`** — integration not configured.

## `GET /api/strava/callback` *(public)*

OAuth redirect target. Exchanges the authorization code, stores the
connection and starts the 7-day initial backfill in the background. Always
redirects to `/settings?strava=<status>` with one of:

`success` · `denied` · `scope` (activity read scope not granted) ·
`athlete-taken` (Strava account already linked to another user) ·
`invalid-state` · `config` · `error`

---

## `POST /api/strava/sync`

Manual "sync now" for the current user's connection. Throttled to once per
minute per user (`429` otherwise).

**Response `200`** — `{ "synced": 3, "failed": 0, "connection": { … } }`
**Response `404`** — no connection.

## `DELETE /api/strava/connection?purge=1`

Disconnects the Strava account (best-effort deauthorization at Strava) and,
with `purge=1`, deletes all synced activities.

**Response `200`** — `{ "success": true, "purged": 12 }`

---

## `GET /api/strava/activities`

Synced activities without the heavy raw payloads.

**Query:** `startDate`, `endDate`, `sportType`, `limit` (max 200), `skip`

**Response `200`** — `{ "activities": [ … ], "total": 42 }`

## `GET /api/strava/activities/:id?streams=1`

One activity including the raw `detail` and `zones` payloads; `streams=1`
additionally includes the stored streams (heart rate, time, velocity, … —
no GPS track).

## `GET /api/strava/sport-types`

Distinct sport types of the user's synced activities (criteria builder).

**Response `200`** — `["Ride", "Run"]`

---

## Webhook *(public)*

### `GET /api/strava/webhook`

Subscription validation: echoes `hub.challenge` when `hub.verify_token`
matches the configured verify token, otherwise `403`.

### `POST /api/strava/webhook`

Event receiver. Always answers `200` immediately (Strava requires a response
within 2 seconds); the event is processed in the background:

| Event | Action |
|---|---|
| `activity` create/update | Fetch detail + zones + streams, upsert |
| `activity` delete | Remove the stored activity |
| `athlete` update with `authorized: "false"` | Remove the user's connection |

---

## Admin — `/api/strava/admin` *(admin only)*

### `GET /api/strava/admin/overview`

Config/usage summary: `configured`, `clientIdSet`, `clientSecretSet`,
`publicBaseUrl`, `callbackDomain` (the value for Strava's *Authorization
Callback Domain* field), `webhookCallbackUrl`, `pollIntervalMinutes`,
`connectedUsers`, `activityCount`.

### `GET /api/strava/admin/subscription`

Lists the application's webhook subscription(s) at Strava.

### `POST /api/strava/admin/subscription`

Creates the webhook subscription. Strava synchronously validates the
callback URL during this call — the instance must be publicly reachable.

### `DELETE /api/strava/admin/subscription/:id`

Deletes the webhook subscription.

---

## Strava goals

Goals with `targetRefModel: "StravaActivity"` (type `periodic-strava`,
`targetRef: "strava"`) count synced Strava activities matching the goal's
`stravaCriteria` rule tree. See [goals.md](goals.md#strava-goals) and the
criteria engine in `server/services/stravaCriteria.js`.

```json
{
  "name": "3× Cardio pro Woche",
  "type": "periodic-strava",
  "targetRef": "strava",
  "targetRefModel": "StravaActivity",
  "condition": "min",
  "targetValue": 3,
  "metric": "count",
  "intervalValue": 1,
  "intervalUnit": "week",
  "stravaCriteria": {
    "operator": "AND",
    "rules": [
      { "kind": "sportType", "values": ["Run", "Swim", "Ride"] },
      {
        "kind": "group",
        "operator": "OR",
        "rules": [
          { "kind": "hrPercentInRange", "minHr": 120, "maxHr": 145, "minPercent": 85 },
          { "kind": "hrZonePercent", "zone": 2, "minPercent": 85 }
        ]
      }
    ]
  }
}
```

### Rule kinds

| `kind` | Parameters | Matches when |
|---|---|---|
| `sportType` | `values: string[]` | `sport_type` or legacy `type` is one of the values (case-insensitive) |
| `metricRange` | `metric`, `min?`, `max?` | Numeric metric within bounds (user-facing units: min/km/km-h/bpm/…) |
| `hrPercentInRange` | `minHr`, `maxHr`, `minPercent` | ≥ `minPercent` % of recorded time with heart rate in `[minHr, maxHr]` (HR stream required) |
| `hrZonePercent` | `zone` (1–5), `minPercent` | ≥ `minPercent` % of time in the Strava heart-rate zone (zones payload required) |
| `group` | `operator`, `rules` | Nested sub-group (max depth 5) |

Metrics for `metricRange`: `movingTime` (min), `elapsedTime` (min),
`distance` (km), `totalElevationGain` (m), `averageSpeed` (km/h),
`averageHeartrate`, `maxHeartrate` (bpm), `averageWatts` (W),
`calories` (kcal), `sufferScore`.

New rule kinds are added in `server/services/stravaCriteria.js`
(`RULE_TYPES` registry) — storage and API pass criteria through untouched.
