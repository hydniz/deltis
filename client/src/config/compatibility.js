// Bump this when the frontend requires a new backend API contract.
// Must stay in sync with the bump rules documented in CLAUDE.md.
// v4: habit weekday schedules (scheduleDays in /habits/definitions + settings)
// v5: planner copy-week endpoint (POST /planner/copy-week)
// v6: Strava integration (/strava endpoints, periodic-strava goals)
// v7: meta goals + goal items, training types (/training-types, /planner/trainings)
// v8: training plan names + manual completion + disjoint matches, trainings in
//     copy-week, goal heatmaps (/goals/:id/heatmap)
// v9: personal habit library (soft delete/trash, /habits/catalog, inline
//     settings on create), meta goal child previews
// v10: due-habit engine (/habits/due, interval + event-trigger schedules),
//      planner provenance (plan source field)
// v11: due entries carry a target-aware `fulfilled` flag, goal heatmaps
//      return interval tiles for periodic goals
// v12: weight goal on the profile (weightGoal on PUT/GET /auth/me), /weight
//      limit returns the newest entries
// v13: daily check-in times on the profile (checkinTimes on /auth/me)
// v14: plugin/add-on platform reverted — /api/plugins, /api/plugin-host/v1
//      and the pluginHostApiVersion field on GET /api/ are gone again;
//      Strava sync is built into core again (no plugin required)
// v15: Health Connect integration (/api/health endpoints, `health` entry in
//      the training-criteria integration registry, source/sourceId on weight
//      log entries).
// v16: generic user-defined measurements (/api/metrics + MetricDefinition/
//      MetricLog): any scalar from Health Connect or hand entry (body fat,
//      resting HR, sleep, blood pressure, hydration, mood, …). Health Connect
//      now advertises all metric types and /health/sync accepts `metrics[]`.
//
// This MUST equal the backend `apiVersion` shipped in the same release: the
// compatibility check in App.jsx is a strict equality (`backendV ===
// REQUIRED_API_VERSION`), not a `>=`, so any drift — in either direction —
// raises the amber version-conflict banner for every user of that build.
// Frontend and backend ship together, so bump this in lockstep with
// `apiVersion` in the root package.json.
export const REQUIRED_API_VERSION = 16;
