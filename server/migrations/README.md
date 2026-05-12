# Database Migrations

Schema and data migrations run automatically on application startup via
[runner.js](runner.js). The runner is wired into [server/index.js](../index.js)
and executes before the Express server starts accepting traffic.

## How it works

1. The runner discovers all files in this directory matching `NNN-*.js`
   (three-digit prefix), sorted numerically.
2. Each applied migration is recorded as a row in the `migrations` collection.
3. Pending migrations (files not yet recorded) trigger a full database backup
   under `backups/pre-migration/` before any of them run.
4. Migrations apply in numeric order, sequentially.
5. If any migration throws, the runner restores the database from the backup
   and exits with code `1`. If the restore itself fails, the runner exits with
   code `2` and the backup path is logged for manual recovery.

A `migrationlocks` collection (TTL 30 min) prevents concurrent runs.

## Adding a new migration

1. Pick the next free three-digit prefix (look at existing files).
2. Create `NNN-short-description.js`:

   ```javascript
   module.exports = {
     name: 'NNN-short-description',  // MUST match the filename without .js
     async up() {
       // ... your changes; use Mongoose models or mongoose.connection.collection(...)
     },
   };
   ```

3. **Make it idempotent.** Use `$exists`, `findOneAndUpdate(..., { upsert: true })`,
   etc. — re-running against already-migrated data must be a no-op. This is the
   only safe way to handle the case where an operator runs a migration manually
   before the new runner is deployed.

4. Add a test case in [../tests/migrations.test.js](../tests/migrations.test.js)
   that asserts the migration's effect on relevant fixtures.

5. Test locally with a populated database, then commit.

## Manual rollback

Pre-migration backups stay on disk (last 5 retained) and can be restored via:

```bash
npm run migrate:rollback                       # list available backups
npm run migrate:rollback backups/pre-migration/<file>
```

This works entirely in Node — no Docker required.

## Status / diagnostics

```bash
npm run migrate:status
```

Lists applied and pending migrations.

## What backups do (and don't) include

The backup format is gzipped Extended-JSON of every user collection's
documents. **Indexes are not captured.** Mongoose recreates schema-declared
indexes on connection, so this is a non-issue as long as migrations only
change data — not custom indexes. If a migration needs to manage indexes,
declare them on the Mongoose model instead so they are re-applied automatically
after a rollback.
