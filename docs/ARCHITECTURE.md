# Architecture

## Goal

`drizzle-doctor` answers two questions without modifying the target database:

1. Is the local Drizzle migration repository internally coherent?
2. Does the database migration history agree with that repository, including states that Drizzle's high-watermark logic can skip?

## Upstream behavior we model

At the time this project was created, Drizzle ORM's PostgreSQL migrator:

- stores `hash` and `created_at` in a migration table
- reads the latest database `created_at`
- applies a local migration only when its local `folderMillis` is newer than that high-watermark
- computes the local migration hash as SHA-256 of the SQL file contents

That behavior is why a missing local migration whose timestamp is older than/equal to the latest applied timestamp is dangerous: the migrator can regard it as already behind the frontier and skip it.

Upstream source references:

- PostgreSQL migrator: https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/dialect.ts
- migration file reader/hash logic: https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/migrator.ts

Upstream behavior can change. When it does, tests and documentation in this project must be reviewed before claiming compatibility.

## Modules

### `src/repository.ts`

Reads `meta/_journal.json` and referenced SQL files. Produces normalized local migrations plus deterministic findings.

This module owns repository invariants such as:

- valid journal shape
- unique indices/tags/timestamps
- timestamp ordering
- referenced/missing/orphan SQL files
- SHA-256 hashing

### `src/postgres.ts`

Thin read-only adapter for PostgreSQL. It knows where the Drizzle migration table lives and returns normalized rows.

It does **not** decide whether a state is safe.

### `src/analyze.ts`

Pure comparison logic. Given local migrations plus normalized database rows, it calculates applied/pending/divergent states and emits findings.

This is the reusable core that future adapters should target.

### `src/report.ts`

Converts normalized results into stable text/JSON output. Finding codes are considered user-facing API once released.

### `src/cli.ts`

Argument parsing, environment resolution, exit codes, and orchestration only.

## Core invariants

1. Database inspection is read-only.
2. A database URL is never printed in reports.
3. Local SQL hashing matches Drizzle's SHA-256-over-file-content behavior.
4. Database/framework-specific adapters do not duplicate comparison policy.
5. Error findings cause exit code `1`; inability to complete the command causes exit code `2`.
6. A migration missing from the DB with `when <= databaseHighWatermark` is an error-level skip hazard.

## Extension model

Future database/runtime support should normalize into:

```ts
interface DatabaseSnapshot {
  schema: string;
  table: string;
  tableExists: boolean;
  rows: Array<{ id: number; hash: string; createdAt: number }>;
}
```

If another Drizzle backend uses fundamentally different migration semantics, add a backend-specific analyzer rather than forcing it into PostgreSQL assumptions.

## Replay checks

Clean replay is intentionally outside the initial read-only adapter. When implemented, replay must:

- require an explicitly disposable target or create its own ephemeral database
- never run against the same URL used for read-only status checks by accident
- capture which migration failed and why
- remain optional; `repo` and `status` must stay useful without Docker or a hosted service
