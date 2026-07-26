# `/api/metrics` — user-defined measurements

The generic tracking layer: any scalar a user wants to follow over time — body
fat, resting heart rate, sleep, blood pressure, blood glucose, VO₂max,
hydration, mood — beyond the single-purpose weight log. A `MetricDefinition` is
a metric; a `MetricLog` is one reading. Values arrive by hand or from Health
Connect (see [`health.md`](./health.md)).

Introduced in **apiVersion 16**. All routes require the session cookie and are
scoped to the caller.

## Concepts

A metric carries two aggregation modes, so "resting HR: the day's minimum,
averaged over the week" is expressible:

- `dayAggregation` — collapses several readings within one calendar day
  (`last` | `avg` | `sum` | `min` | `max`),
- `aggregation` — combines those daily values across a longer period.

`direction` (`up`|`down`|`none`) drives trend colour and the natural sense of a
goal. `min`/`max` bound valid input. Metrics that share a `groupKey` (blood
pressure systolic + diastolic) render together.

## Definitions

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/metrics` | Live metrics, each enriched with `latest`, `todayValue`, `count`. `?includeDeleted=true` for the trash. |
| `POST` | `/api/metrics` | Create. `{ name, unit?, valueType?, dayAggregation?, aggregation?, direction?, min?, max?, … }`. Slug auto-derived from the name (umlauts transliterated), made unique. |
| `PUT` | `/api/metrics/:id` | Update. A changed name/unit is a **versioned rename** — the old label is pushed to `nameHistory` so historical logs stay attributable. |
| `DELETE` | `/api/metrics/:id` | Soft delete; readings are kept. |
| `POST` | `/api/metrics/:id/restore` | Un-delete (409 if the key was re-taken). |

## Catalog

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/metrics/catalog` | One-tap templates (health-backed + manual), each flagged `importable` and `added`. |
| `POST` | `/api/metrics/catalog/:key` | Add a template; idempotent. Health-backed keys get their `healthType` set so Health Connect fills them. |

## Readings

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/metrics/:id/series` | **One value per day** → `{ series: [{ date: 'YYYY-MM-DD', value }], truncated }`. `?days=N` (0 = everything, max 3650). Source policy + overlap dedup applied, then the metric's `dayAggregation`. This is what charts, sparklines and statistics read — an interval-backed metric stores hundreds of readings per day, so raw readings are the wrong granularity. `truncated: true` means the range hit the row cap and its oldest (partial) day was dropped. |
| `GET` | `/api/metrics/:id/logs` | Raw readings. `?startDate&endDate&limit` (max 1000), returned chronologically. Bounded by row count, so for an interval-backed metric prefer `/series`. |
| `POST` | `/api/metrics/:id/logs` | `{ value, date?, note? }`. Bounds enforced; date defaults to now. |
| `PUT` | `/api/metrics/logs/:logId` | Edit `value`/`date`/`note`. |
| `DELETE` | `/api/metrics/logs/:logId` | Remove a reading. |

## Dashboard

`GET /api/metrics/summary` → one row per metric with its current value — the
newest **day**'s aggregate, not the newest raw reading (a step count is a day
total, not the last interval bucket). `?dashboard=true` limits to metrics
flagged `showOnDashboard`.

## Health Connect routing

When the user enables a Health-Connect-backed type in the companion app, the
server auto-creates the matching metric (from `services/metricCatalog.js`) and
`POST /api/health/sync` routes `metrics: [{ type, id, time, value }]` records to
it, upserting idempotently on `(userId, metricId, source, sourceId)`. `GET
/api/health/config` returns `metricTargets` so the app knows which types to read
and in which unit. Manual entries always win their day for `last`-style metrics;
`sum`-style metrics (steps, hydration) accumulate.
