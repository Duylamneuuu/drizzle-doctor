# Architecture

## Goal

`drizzle-doctor` answers two questions without modifying the target database:

1. Is the local Drizzle migration repository internally coherent?
2. Does the database migration history agree with that repository, including states that Drizzle's high-watermark logic can skip?

## Upstream behavior we model

Verified against the npm-published `drizzle-orm@0.45.2` build (2026-09-02); see `docs/COMPATIBILITY.md` for exact source references, the finding-to-upstream mapping, and the upgrade checklist. Summary of the modeled behavior:

- Drizzle's PostgreSQL migrator stores `hash` and `created_at` in a migration table
- reads the latest database `created_at` (`order by created_at desc limit 1`)
- applies a local migration only when its local `folderMillis` is strictly newer than that high-watermark
- computes the local migration hash as SHA-256 of the SQL file contents
- `tests/upstream-semantics.test.ts` asserts hash/timestamp equivalence against the pinned real package

That behavior is why a missing local migration whose timestamp is older than/equal to the latest applied timestamp is dangerous: the migrator can regard it as already behind the frontier and skip it.

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

### `src/replay.ts`

Clean-replay engine (M3): applies the full local migration history from zero
on an explicitly disposable PostgreSQL target. It models the upstream
PostgreSQL migrator: creates the migration schema/table with Drizzle's DDL,
splits SQL on the literal `--> statement-breakpoint` marker, executes chunks
verbatim, and inserts `(hash, created_at)` rows. See
`docs/COMPATIBILITY.md` for the two deliberate diagnostic deviations
(per-migration transactions, strict-clean target).

Replay is destructive and reachable only through the CLI's explicit
`replay --database-url <url> --confirm-destructive` invocation; the engine
itself never reads `DATABASE_URL`.

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

Clean replay ships as the `replay` command (`src/replay.ts`, milestone M3):

- requires an explicitly supplied disposable target: `replay` never reads
  `DATABASE_URL` and refuses to start without `--confirm-destructive`
- requires the target's Drizzle migration table to be empty (a clean replay
  from zero is only meaningful on a fresh table)
- replays migrations in journal order, respecting Drizzle statement
  breakpoints, and stops at the first failing migration
- reports which migration and breakpoint chunk failed, with sanitized errors
- remains optional: `repo` and `status` stay useful without replay
  infrastructure
