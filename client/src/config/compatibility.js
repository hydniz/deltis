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
// v15 (backend only): Health Connect integration (/api/health endpoints,
//      `health` entry in the training-criteria integration registry,
//      source/sourceId on weight log entries). The web client consumes NONE
//      of this yet — it is used by the Android companion app — so per the
//      bump rules in CLAUDE.md this stays at 14. Raising it would show every
//      user the amber incompatibility banner for a feature the web UI cannot
//      use. Bump it when the web settings screen actually calls /api/health.
export const REQUIRED_API_VERSION = 14;
