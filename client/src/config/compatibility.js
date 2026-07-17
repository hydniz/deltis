// Bump this when the frontend requires a new backend API contract.
// Must stay in sync with the bump rules documented in CLAUDE.md.
// v4: habit weekday schedules (scheduleDays in /habits/definitions + settings)
// v5: planner copy-week endpoint (POST /planner/copy-week)
// v6: Strava integration (/strava endpoints, periodic-strava goals)
// v7: meta goals + goal items, training types (/training-types, /planner/trainings)
// v8: training plan names + manual completion + disjoint matches, trainings in
//     copy-week, goal heatmaps (/goals/:id/heatmap)
export const REQUIRED_API_VERSION = 8;
