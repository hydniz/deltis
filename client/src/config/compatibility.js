// Bump this when the frontend requires a new backend API contract.
// Must stay in sync with the bump rules documented in CLAUDE.md.
// v4: habit weekday schedules (scheduleDays in /habits/definitions + settings)
// v5: planner copy-week endpoint (POST /planner/copy-week)
// v6: Strava integration (/strava endpoints, periodic-strava goals)
export const REQUIRED_API_VERSION = 6;
