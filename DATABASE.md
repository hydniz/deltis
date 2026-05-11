# Database Documentation – Habit Tracker

MongoDB database: `habit_tracker`
ODM: Mongoose 8

---

## Relationship Overview

```
User ──────────────────────────────────────────────────────────┐
 │                                                             │
 ├──< ActivityType          (userId → User)                    │
 │       │ (version + nameHistory)                             │
 │       └──< ActivityLog   (activityTypeRef + version → AT)  │
 │       └──< ActivityPlan  (activityTypeRef + version → AT)  │
 │                                                             │
 ├──< HabitDefinition       (userId → User, nullable)         │
 │       │ (version + nameHistory)                             │
 │       └──< HabitLog      (habitId + habitVersion → HD)     │
 │                                                             │
 ├──< WeightLog             (userId → User)                    │
 │                                                             │
 ├──< Goal                  (userId → User)                    │
 │       └── targetRef ──→  ActivityType  (polymorphic ref)   │
 │                    ──→  HabitDefinition (polymorphic ref)   │
 │                                                             │
 └── selectedHabitIds[] ──→ HabitDefinition[]                 │
```

---

## Versioned References (Name History)

ActivityType and HabitDefinition support name changes without data loss.
When a name is changed, the old version is archived in `nameHistory` and
`version` is incremented. Logs and plans store the version at the time of entry.

### Concept

```
ActivityType { label: "Running", version: 2, nameHistory: [{ name: "Jogging", version: 1, ... }] }
ActivityLog  { activityTypeRef: <id>, activityTypeVersion: 1 }
              → historicalLabel: "Jogging"  (because version 1 ≠ current version 2)
```

The backend automatically computes `historicalLabel` when reading a log entry whose
stored version differs from the current name. The frontend then displays:
**Running (Jogging)** – current name with the historical name in parentheses.

---

## Models

### User
Represents a user. Login is via username + password (after migration).

| Field             | Type       | Description                                                                        |
|-------------------|------------|------------------------------------------------------------------------------------|
| `_id`             | ObjectId   | Primary key                                                                        |
| `uuid`            | String     | Original access code (from `.env` VALID_UUIDS); blocked as login after migration  |
| `username`        | String     | Login username (≥3 chars, unique, lowercase); set during migration                 |
| `passwordHash`    | String     | bcrypt hash of the user's password (+ pepper); `select: false`, never in API responses |
| `mustChangePassword` | Boolean | When `true`, user is forced to choose a new password on next login               |
| `name`            | String     | Display name                                                                       |
| `isAdmin`         | Boolean    | Admin flag                                                                         |
| `adminSecretHash` | String     | bcrypt hash of the admin secret; `select: false`                                   |
| `weightUnit`      | String     | Preferred weight unit (`kg` or `lbs`)                                              |
| `selectedHabitIds`| ObjectId[] | **→ HabitDefinition[]** actively selected habits                                  |
| `createdAt`       | Date       | Creation timestamp                                                                 |

**Auth token format** (Bearer header):

| State                              | Token format                    |
|------------------------------------|---------------------------------|
| Migration (no username yet)        | `<uuid>`                        |
| Normal login                       | `<username>:<password>`         |
| Admin login                        | `<username>:<admin-secret>`     |

UUID login is permanently rejected (`UUID_BLOCKED`) once `username` is set.

---

### ActivityType
User-defined activity types (e.g. "Gym", "5k Run"). Pre-populated with defaults on
first access per user. Supports name changes with version history.

| Field          | Type       | Description                                                                |
|----------------|------------|----------------------------------------------------------------------------|
| `_id`          | ObjectId   | Primary key                                                                |
| `userId`       | ObjectId   | **→ User** owner (required)                                               |
| `label`        | String     | Current display name                                                       |
| `version`      | Number     | Current version number (starts at 1, increments on rename)                |
| `nameHistory`  | Array      | Archive of past names (see below)                                         |
| `showDistance` | Boolean    | Show distance field in the entry form                                     |
| `showDuration` | Boolean    | Show duration field in the entry form                                     |
| `customFields` | Array      | Custom fields (objects with `key`, `label`, `type`, `unit`, `options`)    |
| `createdAt`    | Date       | —                                                                          |

**`nameHistory[]` entries**:

| Field       | Type   | Description                                     |
|-------------|--------|-------------------------------------------------|
| `name`      | String | Historical name                                 |
| `version`   | Number | Version number this name was valid for          |
| `validFrom` | Date   | Start of validity                               |
| `validUntil`| Date   | End of validity (moment of rename)              |

**`customFields[].type`**: `'number'` (numeric input with unit) or `'select'` (dropdown)

---

### ActivityLog
Records a completed activity.

| Field                 | Type     | Description                                                         |
|-----------------------|----------|---------------------------------------------------------------------|
| `_id`                 | ObjectId | Primary key                                                         |
| `userId`              | ObjectId | **→ User** owner (required)                                        |
| `activityType`        | String   | Activity label as string (backwards compatibility)                 |
| `activityTypeRef`     | ObjectId | **→ ActivityType** direct reference                                |
| `activityTypeVersion` | Number   | ActivityType version at the time of logging                        |
| `date`                | Date     | Date of the activity                                               |
| `duration`            | Number   | Duration in minutes (optional)                                     |
| `distance`            | Number   | Distance in kilometres (optional)                                  |
| `notes`               | String   | Free-text notes (optional)                                         |
| `customValues`        | Mixed    | Key-value map for the ActivityType's custom fields                 |
| `createdAt`           | Date     | —                                                                   |

**Indexes**: `{ userId, date }` · `{ userId, activityTypeRef, date }`

The backend computes `historicalLabel` when reading a log if `activityTypeVersion`
differs from the current `ActivityType.version`.

---

### ActivityPlan
A planned (not yet completed) activity.

| Field                 | Type     | Description                                              |
|-----------------------|----------|----------------------------------------------------------|
| `_id`                 | ObjectId | Primary key                                              |
| `userId`              | ObjectId | **→ User** owner (required)                             |
| `activityType`        | String   | Activity label as string (backwards compatibility)      |
| `activityTypeRef`     | ObjectId | **→ ActivityType** direct reference                    |
| `activityTypeVersion` | Number   | ActivityType version at the time of planning            |
| `scheduledDate`       | Date     | Planned date                                            |
| `duration`            | Number   | Planned duration in minutes (optional)                  |
| `distance`            | Number   | Planned distance in kilometres (optional)               |
| `completed`           | Boolean  | Has the plan been checked off?                          |
| `notes`               | String   | Notes (optional)                                        |
| `createdAt`           | Date     | —                                                        |

**Index**: `{ userId, scheduledDate }`

---

### HabitDefinition
Definition of a habit – either predefined (`userId = null`) or user-created.
Supports name changes with version history (same as ActivityType).

| Field          | Type     | Description                                                              |
|----------------|----------|--------------------------------------------------------------------------|
| `_id`          | ObjectId | Primary key                                                              |
| `userId`       | ObjectId | **→ User** (nullable – `null` for predefined habits)                    |
| `name`         | String   | Current display name                                                     |
| `version`      | Number   | Current version number (starts at 1)                                    |
| `nameHistory`  | Array    | Archive of past names (same structure as ActivityType)                  |
| `unitSymbol`   | String   | Unit label (e.g. `g`, `h`, `ml`, `pcs`)                                |
| `type`         | String   | `'amount'` (quantity), `'duration'` (time) or `'boolean'`              |
| `isPredefined` | Boolean  | `true` for system-defined habits                                         |
| `createdAt`    | Date     | —                                                                         |

**Predefined habits** (userId = null, read-only):
Screen Time, Creatine, Cigarettes, Water, Sleep, Meditation, Caffeine, Alcohol

Custom habits can be renamed via `PUT /api/habits/definitions/:id`.

---

### HabitLog
Daily value for a habit. Only one entry per user and habit per day (upsert).

| Field          | Type     | Description                                         |
|----------------|----------|-----------------------------------------------------|
| `_id`          | ObjectId | Primary key                                         |
| `userId`       | ObjectId | **→ User** owner (required)                        |
| `habitId`      | ObjectId | **→ HabitDefinition** (required, populated)        |
| `habitVersion` | Number   | HabitDefinition version at the time of logging     |
| `date`         | Date     | Entry date (normalised to start of day)            |
| `value`        | Number   | Logged value in the habit's unit                   |
| `createdAt`    | Date     | —                                                   |

**Index**: `{ userId, habitId, date }`

---

### WeightLog
A user's weight entry.

| Field      | Type     | Description                        |
|------------|----------|------------------------------------|
| `_id`      | ObjectId | Primary key                        |
| `userId`   | ObjectId | **→ User** owner (required)       |
| `date`     | Date     | Date of the measurement            |
| `weight`   | Number   | Weight value                       |
| `unit`     | String   | `'kg'` or `'lbs'`                 |
| `createdAt`| Date     | —                                   |

**Index**: `{ userId, date }`

---

### Goal
A user goal – periodic or long-term, for activities or habits.

| Field               | Type     | Description                                                                           |
|---------------------|----------|---------------------------------------------------------------------------------------|
| `_id`               | ObjectId | Primary key                                                                           |
| `userId`            | ObjectId | **→ User** owner (required)                                                          |
| `name`              | String   | Goal label                                                                            |
| `description`       | String   | Optional description                                                                  |
| `type`              | String   | `'periodic-activity'` · `'periodic-habit'` · `'weekly-activity'` · etc.             |
| `targetRef`         | Mixed    | **→ ActivityType or HabitDefinition** (polymorphic reference, ObjectId)             |
| `targetRefModel`    | String   | Identifies the target model: `'ActivityType'` or `'HabitDefinition'`                |
| `condition`         | String   | `'min'` · `'max'` · `'exact'`                                                        |
| `targetValue`       | Number   | Target value                                                                          |
| `unitSymbol`        | String   | Unit (e.g. `times`, `g`, `h`)                                                       |
| `conditions`        | Array    | Multi-conditions with `conditionOperator` (`AND`/`OR`)                               |
| `startDate`         | Date     | Start date (long-term goals only)                                                    |
| `endDate`           | Date     | End date (long-term goals only)                                                      |
| `startValue`        | Number   | Baseline value at start (optional)                                                   |
| `intermediateSteps` | Array    | Manual milestones `[{ date, targetValue, description }]`                             |
| `isActive`          | Boolean  | Active flag (soft delete via `isActive: false`)                                      |
| `createdAt`         | Date     | —                                                                                     |

**Index**: `{ userId, isActive }`

Goals always reference ActivityType/HabitDefinition by ID and display the current name –
no version history for goals.

---

## Populate Overview (Mongoose)

| Route                        | populate()                                                              |
|------------------------------|-------------------------------------------------------------------------|
| `GET /api/activities`        | `activityTypeRef` → label, version, nameHistory, showDistance, customFields |
| `GET /api/planner`           | `activityTypeRef` → label, version, nameHistory, showDistance, customFields |
| `GET /api/habits/logs`       | `habitId` → name, version, nameHistory, unitSymbol, type               |
| `GET /api/goals`             | manually via `enrichGoal()` → `targetName` in response                 |

`nameHistory` is processed server-side and **not** sent to the client.
Instead, a computed `historicalLabel` is returned when applicable.

---

## Indexing Strategy

All queries use `userId` as the first filter term – therefore `userId` is the leading
field in all compound indexes. Time-based sort fields (`date: -1`, `scheduledDate: 1`)
are included as the secondary field to allow index scans without collection scans.

---

## Tools

### Admin password reset – `scripts/reset-admin-password.js`

Resets the admin password directly in the database without requiring the current
password. Useful when the admin secret is lost.

**What it does:**
1. Connects to MongoDB using `MONGODB_URI` from `.env`
2. Finds the admin account (`isAdmin: true`)
3. Displays the found account's UUID and username for confirmation
4. Prompts for the new password twice (no echo in the terminal)
5. Hashes the password with bcrypt (12 rounds) and saves it as `adminSecretHash`

**Usage:**

```bash
# Interactive (recommended) – password input is hidden
node scripts/reset-admin-password.js

# Via npm script
npm run admin:reset-password

# Non-interactive (scripts, pipelines)
node scripts/reset-admin-password.js --password "NewPassword123"

# Via stdin (password does not appear in process list)
echo "NewPassword123" | node scripts/reset-admin-password.js
```

> **Note:** The script does **not** use the pepper – `adminSecretHash` is always hashed
> with plain bcrypt (as expected by admin setup and admin auth). Only `passwordHash`
> (regular users) includes the pepper. The script therefore works independently of
> the pepper configuration.

---

### Backup – `./backup.sh`

Creates a compressed snapshot of the MongoDB database.

**What it does:**
1. Checks whether the MongoDB container (`habit-tracker-mongo`) is running
2. Sets a lock file (`.backup.lock`) that causes the server to reject all write requests with HTTP 503
3. Waits 2 seconds for in-flight requests to complete
4. Runs `mongodump --gzip --archive` inside the container
5. Copies the archive to `./backups/habit_tracker_<TIMESTAMP>.archive.gz`
6. Removes the lock file

**Usage:**
```bash
./backup.sh
```

**Output:** File path and size of the backup, plus a restore hint.

> The backup keeps the app readable – only write access is blocked.

---

### Restore – `./restore.sh`

Restores a database state from a backup.

**What it does:**
1. Without argument: lists all available backups in `./backups/`
2. With argument: restores the specified archive
   - Stops the app (MongoDB stays running)
   - Copies the archive into the container
   - Runs `mongorestore --drop` (overwrites existing data!)
   - Restarts the app

**Usage:**
```bash
./restore.sh                                        # list backups
./restore.sh backups/habit_tracker_XYZ.archive.gz  # restore
```

> **Warning:** `--drop` deletes all current data before restoring.
> Confirmation with `yes` is required.

---

### Migration – `scripts/migrate-versioned-refs.js`

A one-time script that updates existing database entries to the versioned-references
schema.

**When needed:** After the first deployment of the name-history feature, or when
entries without `version`/`activityTypeVersion`/`habitVersion` are present.

**What it does:**
1. Sets `version=1` and `nameHistory=[]` on all ActivityTypes (if missing)
2. Sets `version=1` and `nameHistory=[]` on all HabitDefinitions (if missing)
3. Sets `activityTypeVersion=1` on ActivityLogs that have an `activityTypeRef`
4. Assigns ActivityLogs without `activityTypeRef` to an ActivityType by name match
5. Same for ActivityPlans
6. Sets `habitVersion=1` on all HabitLogs (if missing)

**Usage:**
```bash
# Create a backup first!
./backup.sh

# Then run the migration
node scripts/migrate-versioned-refs.js
```

**Safe to re-run:** The script always checks `$exists: false` before setting a field –
already migrated fields are not overwritten.
