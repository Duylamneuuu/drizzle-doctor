# Drizzle Compatibility Notes

This file records which upstream Drizzle behavior was verified, when, and how
each `drizzle-doctor` finding relates to that behavior. It exists because the
tool models Drizzle migration semantics that can change upstream.

## Verified upstream version

- Package: `drizzle-orm@0.45.2` (pinned as an exact devDependency for the
  compatibility tests in `tests/upstream-semantics.test.ts`)
- Verified: 2026-09-02, against the npm-published build
- Source references (at verification time):
  - `readMigrationFiles`, migration file reading/hash logic:
    https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/migrator.ts
  - PostgreSQL migrator, high-watermark logic and migration table DDL:
    https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/dialect.ts

## Verified semantics

### Journal layout (`readMigrationFiles`)

- The journal lives at `<migrationsFolder>/meta/_journal.json` and must parse
  as JSON with an `entries` array.
- Each entry contributes one migration with:
  - `folderMillis` from `entry.when`
  - `bps` from `entry.breakpoints`
  - `tag` used as the SQL file name (`<tag>.sql`)
- Extra journal fields (`version`, `dialect`, ...) are ignored by Drizzle.
  `drizzle-doctor` follows suit.

### Hashing

- The SQL file is read as text (`readFileSync(...).toString()`) and hashed as
  `sha256(fileContents).digest('hex')` over the whole file, including
  statement-breakpoint markers and trailing newline.
- `drizzle-doctor` reproduces this exactly (`src/repository.ts`); the
  equivalence is asserted in `tests/upstream-semantics.test.ts`.

### Statement breakpoints

- Drizzle splits migration SQL on the literal `--> statement-breakpoint`
  separator before execution. Breakpoints affect execution (used by the
  future replay feature), not status comparison; `repo`/`status` hash the
  unsplit file, matching Drizzle's own hash input.

### PostgreSQL migration table

- Defaults: schema `drizzle`, table `__drizzle_migrations`.
- DDL (created by the migrator if missing):

  ```sql
  create table if not exists "schema"."table" (
    id serial primary key,
    hash text not null,
    created_at bigint
  );
  ```

- Rows are written as `(hash, created_at)` with `created_at = folderMillis`.

### High-watermark apply decision

- The migrator reads `select id, hash, created_at from ... order by created_at desc limit 1`
  (the single latest row by `created_at`).
- A local migration is applied only when
  `Number(latest.created_at) < folderMillis`. Everything at or behind the
  latest recorded `created_at` is skipped, including migrations that were
  never applied.
- Matching against `hash` happens only at insert time; existing rows are not
  consulted by content.

## Finding-to-upstream mapping

| Finding | Upstream behavior it models |
| --- | --- |
| `WOULD_BE_SKIPPED_BY_DRIZZLE` | Direct model of the apply condition: missing local migration with `when <= max(created_at)` |
| `MIGRATION_HASH_MISMATCH` | A row at the same `created_at` with a different hash; Drizzle will not re-apply it |
| `DATABASE_TIMESTAMP_MISMATCH` | A row whose hash matches a local file but whose `created_at` differs; means the journal timestamp was rewritten after apply |
| `DATABASE_MIGRATION_NOT_IN_REPO` | Row content not present locally; Drizzle cannot associate it |
| `DATABASE_DUPLICATE_TIMESTAMP` | Multiple rows with the same `created_at`; the `limit 1` select returns one of them, so the high-watermark becomes ambiguous |
| `DATABASE_MIGRATIONS_TABLE_MISSING` | First deploy state; Drizzle would create the table and apply everything |
| Journal findings (`JOURNAL_*`, `MIGRATION_SQL_MISSING`) | Structural preconditions `readMigrationFiles` relies on; Drizzle itself fails loudly only where it throws |

## False-positive review (M1.4)

For every error-level finding: can a legitimate workflow produce it, and does
it deserve error severity?

| Finding | Legitimate workflow? | Severity verdict |
| --- | --- | --- |
| `WOULD_BE_SKIPPED_BY_DRIZZLE` | Yes: a migration accidentally generated with an old timestamp, or merged out of order. Drizzle genuinely skips it. | Keep error — the state silently diverges on next deploy |
| `MIGRATION_HASH_MISMATCH` | Yes: editing an applied migration "in place". Drizzle never re-applies it, so DB and repo disagree forever. | Keep error |
| `DATABASE_TIMESTAMP_MISMATCH` | Yes: restoring a backup or hand-fixing a row. Ambiguous history. | Keep error — hint points at journal rewrite as the likely cause |
| `DATABASE_MIGRATION_NOT_IN_REPO` | Yes: deleted local history or a divergent restore. Requires conscious handling. | Keep error — invisible divergence otherwise |
| `DATABASE_DUPLICATE_TIMESTAMP` | No clean way to produce it with a real migrator; manual/restore artifacts. | Keep error |
| `JOURNAL_DUPLICATE_*` / `JOURNAL_TIMESTAMP_ORDER` | Manual journal edits only. | Keep error — they break the high-watermark contract |
| `MIGRATION_SQL_MISSING` | Broken checkout/folder. | Keep error — deploy would fail at `readMigrationFiles` |
| `JOURNAL_INDEX_SEQUENCE` | Warning, not error: Drizzle ignores `idx`; non-contiguous indices do not change behavior | warning is correct |

## Replay semantics (M3)

The `replay` command (`src/replay.ts`) models the upstream PostgreSQL migrator
for execution, with two deliberate diagnostic deviations. Verified against the
same pinned `drizzle-orm@0.45.2` sources listed above.

### Matches upstream

- creates the migration schema and table if missing, using the same DDL as
  `PgDialect.migrate` (`CREATE SCHEMA IF NOT EXISTS`, `CREATE TABLE IF NOT
  EXISTS ... (id serial primary key, hash text not null, created_at bigint)`)
- splits each migration's SQL on the literal `--> statement-breakpoint`
  separator, exactly like `readMigrationFiles`
- executes chunks verbatim with the session's default `search_path` — the
  migrator does not set `search_path`, so unqualified objects land wherever
  the session points (typically `public`); replay does the same
- inserts a `(hash, created_at)` row after each applied migration, matching
  the migrator's bookkeeping
- skips nothing on a clean target: every local migration is replayed

### Deliberate deviations (diagnostic, safe because the target is disposable)

1. **Per-migration transactions.** The upstream migrator wraps the whole batch
   in one transaction and rolls everything back on failure. replay instead
   commits each migration individually so the first failing migration is
   precisely identified and the disposable database retains applied state up
   to the failure. Per-statement results are identical for ordinary DDL/DML
   histories; exotic session/temp-state dependencies across migrations are
   the only place behavior could differ.
2. **Strict-clean target.** replay refuses to start when the migration table
   already contains rows. A clean replay from zero is only meaningful on a
   fresh table; skipping already-applied migrations could silently validate a
   history that never applied end-to-end. Reset the disposable target and
   re-run to continue after a failure.

### Replay finding mapping

| Finding | Meaning |
| --- | --- |
| `REPLAY_MIGRATION_FAILED` | A migration failed to apply; the run stopped at the first failure (tag, breakpoint-chunk index, SQLSTATE, sanitized message). |
| `REPLAY_TARGET_NOT_EMPTY` | The target's migration table already has rows; nothing was applied. |

## Raising the pinned upstream version

When a Drizzle release changes migration behavior:

1. bump the exact `drizzle-orm` devDependency and update this document's
   version/date/URLs in the same change
2. run `npm test` — `tests/upstream-semantics.test.ts` compares hashes and
   timestamps against the real package
3. re-read the migrator sources listed above and update the "Verified
   semantics" section and the finding mapping if anything moved
4. update `docs/ARCHITECTURE.md` if the modeled behavior changed
5. treat any behavioral delta as a deliberate, documented product decision

## Upstream watch (2026-09-04)

Re-checked against the npm registry and `drizzle-orm` sources on 2026-09-04.

### Stable line — unchanged — no action needed

- `drizzle-orm@0.45.2` is still the latest **stable** release (`dist-tag
  latest`, published 2026-03-27); `drizzle-kit@0.31.10` is the latest stable
  kit and still generates the journal-based folder format this tool models.
- `readMigrationFiles` on `drizzle-orm` `main` (checked 2026-09-04) is
  unchanged: `meta/_journal.json`, `entry.when` → `folderMillis`,
  `entry.breakpoints` → `bps`, whole-file SHA-256. All "Verified semantics"
  above remain accurate for the stable line; no code or test change was
  needed this week.

### v1 release-candidate line — a separate compatibility track

`drizzle-orm@1.0.0-rc.4` / `drizzle-kit@1.0.0-rc.4` (checked 2026-09-04)
changes several modeled assumptions. Do not extend `status`/`repo` semantics
to v1 tables or folders until a deliberate v1 compatibility decision is made
(research queue item R2 tracks this):

- Journal-based `readMigrationFiles` still exists in rc.4, but `drizzle-kit
  up` migrates v1 projects to a new folder layout (per-migration folders,
  no `journal.json`): https://orm.drizzle.team/docs/upgrade-v1
- The PostgreSQL migration table is versioned. A new database gets
  `id serial primary key, hash text NOT NULL, created_at bigint, name text,
  applied_at timestamp with time zone DEFAULT now()`; existing v0 tables are
  upgraded (`upgradeIfNeeded`, `drizzle-orm/src/up-migrations/pg.ts`).
  `created_at` is still the journal millis at insert time.
- The apply decision moved out of the single-row high-watermark select. The
  rc.4 async PostgreSQL path reads all rows and filters local migrations in
  `getMigrationsToRun` (`drizzle-orm/src/migrator.utils.ts`) by `name` set
  membership (with `folderMillis`→name fallback formatting via
  `formatToMillis`); there is no `order by created_at desc limit 1` watermark
  in that path.
- Upstream issue https://github.com/drizzle-team/drizzle-orm/issues/5769
  (open, updated 2026-08-26) still reports silent skips caused by
  high-watermark behavior in the v1 line; the rc.4 source inspected here
  differs from that report, so the v1 line is still moving — re-verify
  before modeling it.
