# Health Connect integration

Deltis reads activity, weight and vitals data from Android's **Health Connect**
via the companion app (`deltis-android-companion`), alongside the existing
Strava integration. This document describes the data flow and — most
importantly — how duplicates between the two sources are prevented.

## Why duplicates are the central problem

Health Connect is an *aggregator*, not a source. Strava itself writes its
activities into Health Connect, and so do Garmin, Samsung Health, Fitbit and
the phone's own step counter. A single morning run can therefore exist as:

1. a `StravaActivity` — pulled server-side from the Strava API,
2. a Health Connect `ExerciseSession` written by the Strava app,
3. another `ExerciseSession` written by the watch vendor's app.

Counted naively that run fulfils a habit three times, contributes 3× its
distance to a goal and fills the planner with three entries. Deduplication is
therefore not a nice-to-have — it is the core of this integration.

The defence is layered: prevent what can be prevented at the source, make
ingestion idempotent, and reconcile whatever still gets through on the server.

## Layer 1 — origin filtering on the device

Health Connect records carry `metadata.dataOrigin.packageName`: the app that
wrote them. `GET /api/health/config` tells the companion app which sources the
server already ingests directly:

```json
{ "excludedOrigins": ["com.strava"], "backfillDays": 30, "enabledTypes": [...] }
```

The app drops those records before upload. A workout Deltis already pulls from
the Strava API never leaves the phone a second time. This is the cheapest and
most reliable layer, because origin is known exactly — no heuristics involved.

It is not sufficient on its own: a watch vendor's app writes the same session
under its own package name, and users can revoke the Strava connection while
keeping its Health Connect history.

## Layer 2 — idempotent ingestion

Every Health Connect record has a stable `metadata.id` (a UUID that survives
edits) plus `lastModifiedTime`. `HealthActivity` stores it as `healthId` under

```
{ userId: 1, healthId: 1 } unique
```

Ingestion is an upsert on that key, so:

- re-uploading the same record **updates** it, never inserts a second copy,
- a retried request after a flaky mobile connection is harmless,
- the configurable backfill window (minimum 7 days, see below) can be widened
  and replayed at any time without creating duplicates,
- an edited record (corrected distance) overwrites the stored one, because
  `lastModifiedTime` moves forward while `metadata.id` stays put.

This makes the upload endpoint safely repeatable, which is what lets the app
re-read a window whenever it is unsure — a replay can never duplicate.

## Incremental sync

The companion does **not** re-send its whole window on every run. Health Connect
keeps a change stream per set of record types; the app holds a token into it and
each sync uploads only what was added, edited or deleted since the last one.

Re-sending everything was affordable while a metric was one daily aggregate, but
interval readings (see below) turned a single sync into thousands of records.

A full window read still happens in three cases, all of them idempotent:

- the **first** sync, over the user's chosen backfill window,
- whenever the set of synced data types **changes** — a token only covers the
  types it was issued for, so the new type needs a backfill,
- once a **day**, over the last few days, as a safety net.

The token is always taken *before* the read it accompanies, so a record written
while the read runs lands in the next incremental batch instead of the gap
between the two.

### Deletions

An incremental sync never re-sends a record it already sent, so a reading the
user deletes on their phone would otherwise count on the server forever. The app
therefore posts the removed record ids as `deletions[]`, and `/health/sync`
drops what was imported from them.

Some readings carry a **derived** source id — one sleep session fans out into
`<sessionId>-sleepDeep`, `<sessionId>-sleepRem`, … and one nutrition record into
one id per nutrient. A deletion matches the id itself *or* anything prefixed with
`<id>-`, so deleting the source record removes everything it produced.

Deletions are applied after the upserts of the same batch, matching the order of
the change stream. Hand-entered readings are never touched — only rows with
`source: 'health'` and a matching `sourceId` are removed.

### Interval readings

Steps, distance, calories, hydration and nutrition are stored at the raw
granularity Health Connect records them in — one row per time bucket, carrying
`endTime` and the writing app — rather than as one total per day. That is what
lets several platforms be merged without double-counting the minutes they both
covered (`services/metricSources.resolveLogs`).

The consequence for every read path: a day is **many rows**, not one. Anything
that loads readings must bound them by **date**, never by row count, or it will
silently report a fraction of a day. `GET /api/metrics/:id/series` exists for
exactly this reason — it returns one aggregated value per day, which is what
charts and cards actually want.

## Layer 3 — cross-source reconciliation on the server

Two *different* sources describing the same real-world workout still slip
through layers 1 and 2, because they legitimately have different ids. The
server therefore decides which record is **canonical**.

Two activities are considered the same workout when **all** of:

- they belong to the same user,
- their normalized sport families match (`run`, `ride`, `swim`, `walk`,
  `strength`, `other` — mapped from both Strava `sport_type` and Health Connect
  `ExerciseType`), and
- their time intervals overlap by **≥ 60 % of the shorter** activity.

Overlap-of-the-shorter (rather than absolute seconds or start-time proximity)
is what makes this robust: a watch that records 5 minutes of warm-up around the
same run still overlaps almost fully, while two genuinely separate sessions in
one evening do not.

### Precedence

When a match is found the richer source wins:

```
strava  >  health
```

Strava payloads carry streams, heart-rate zones, power and suffer score, which
the criteria engine can evaluate; a Health Connect session carries far less.
Within Health Connect, a configurable origin priority decides, falling back to
whichever record has more populated metrics.

### Nothing is deleted

The losing record is kept and marked instead:

```js
{ canonical: false,
  superseded: { by: 'strava', ref: '<id>', reason: 'overlap', at: Date } }
```

Only `canonical: true` records are visible to the criteria engine, goals, the
planner and the activity list — so every workout counts exactly once — but no
data is thrown away. This matters because the decision is reversible: if the
user later disconnects Strava, its activities stop being ingested and the
previously superseded Health records are re-reconciled and promoted back to
canonical. A destructive dedup would have lost that history permanently.

Reconciliation runs **in both directions**: on health upload (a new session is
checked against existing Strava activities) and after a Strava sync (a newly
pulled activity supersedes health sessions it duplicates).

## Weight merging

Weight is a scalar per day, not an interval, so it uses a different rule.
`WeightLog` gains `source` (`manual` | `health`) and `sourceId`, with

```
{ userId: 1, source: 1, sourceId: 1 } unique sparse
```

giving imported measurements the same idempotency as activities. The merge
rule is deliberately conservative:

- **a manual entry always wins for its day.** If the user typed a weight, an
  imported one never overwrites or shadows it — explicit input beats an
  automatic reading from a scale that may have weighed someone else.
- otherwise the health measurement fills the day,
- multiple health readings on one day collapse to the latest measurement.

So connecting a scale backfills the gaps in the weight chart without ever
rewriting what the user entered by hand.

## Backfill window

When the user connects Health Connect they choose how far back to read.
The window is stored server-side (`HealthConnection.backfillDays`) so the web UI
and the app agree, and it is clamped to a **minimum of 7 days** — below that the
habit and planner automation has too little history to be useful. Widening the
window later is safe: layer 2 makes the replay idempotent.

## What the data is used for

Health activities register as a `health` entry in the `trainingCriteria`
integration registry, which is the existing extension point:

> *"Adding an integration = adding one INTEGRATIONS entry; models, goals and
> planner pass the map through untouched."*

That means criteria maps can already express "Zone 2 in Strava **or** Health
Connect", and everything built on them works without further change:

- **habit fulfilment** — a habit tied to a training type is satisfied by a
  matching health session,
- **planner auto-fill** — a planned session is completed by the matching
  activity,
- **goals** — health activities contribute to distance/duration progress.

Because only canonical records are returned by `findMatches`, none of this can
double-count.
