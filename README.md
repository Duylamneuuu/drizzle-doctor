# drizzle-doctor

[![CI](https://github.com/Duylamneuuu/drizzle-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/Duylamneuuu/drizzle-doctor/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Duylamneuuu/drizzle-doctor/actions/workflows/codeql.yml/badge.svg)](https://github.com/Duylamneuuu/drizzle-doctor/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Never let Drizzle silently skip a migration again.

`drizzle-doctor` is a CLI for auditing Drizzle migration history before deployment. It checks the migration journal on disk, compares it with PostgreSQL's Drizzle migration table, and flags states that Drizzle's timestamp high-watermark migration logic can skip. An opt-in `replay` command additionally proves that the full history applies cleanly from zero on an explicitly disposable PostgreSQL database.

> **Status:** pre-alpha. The repository is being built in public; no npm release has been published yet.

## Why

Drizzle's PostgreSQL migrator records a migration `hash` and `created_at`, then uses the latest database `created_at` as a high-watermark. A local migration with an older/equal timestamp that is missing from the database can therefore be skipped instead of applied.

`drizzle-doctor` makes that class of problem visible before deploy.

## What it checks

### Repository audit

- `meta/_journal.json` exists and parses
- migration indices/tags/timestamps are unique
- journal indices are contiguous and ordered
- migration timestamps are strictly increasing
- every journal entry has its referenced `.sql` file
- orphan `.sql` files are reported
- SHA-256 hashes are computed exactly from the SQL file contents

### PostgreSQL status

- reads the Drizzle migration table without mutating it
- matches local migrations to database rows by `created_at`
- detects rewritten migration files through hash mismatches
- detects database migrations that no longer exist locally
- distinguishes normal pending migrations from migrations that would be skipped by the current high-watermark state

### Clean replay (opt-in, destructive)

`replay` applies the full local migration history from zero on an explicitly disposable PostgreSQL database, mirroring Drizzle's execution semantics (breakpoint splitting, `hash`/`created_at` bookkeeping rows). It stops at the first failing migration and reports the migration tag and statement that failed.

```bash
node dist/cli.js replay \
  --migrations ./drizzle \
  --database-url 'postgres://...' \
  --confirm-destructive
```

Safety rules:

- `replay` never reads `DATABASE_URL`; it requires an explicit `--database-url`
- it refuses to start without `--confirm-destructive`
- it refuses targets whose Drizzle migration table already has rows (a clean replay is only meaningful from an empty table)
- every database error is sanitized; credentials never appear in output

## Safety

Database inspection (`repo`, `status`) is **read-only**. `drizzle-doctor` does not create schemas, apply migrations, rewrite journal files, or modify production data. `replay` is destructive by definition and is therefore isolated behind an explicit database URL plus `--confirm-destructive`; it must only ever target a disposable database.

## Development quick start

The repository ships a committed `package-lock.json`; use `npm ci` to install
reproducibly (this is what CI runs).

```bash
npm ci
npm run build
node dist/cli.js repo --migrations ./drizzle
```

To compare against PostgreSQL:

```bash
DATABASE_URL='postgres://...' node dist/cli.js status --migrations ./drizzle
```

JSON output for CI/automation:

```bash
node dist/cli.js status --migrations ./drizzle --json
```

Custom Drizzle migration metadata location:

```bash
node dist/cli.js status \
  --migrations ./drizzle \
  --migrations-schema drizzle \
  --migrations-table __drizzle_migrations
```

## Exit codes

- `0` — audit completed with no error-level findings
- `1` — at least one error-level finding was detected
- `2` — the command could not complete (invalid arguments, unreadable input, connection failure, etc.)

## Machine-readable output

Add `--json` to `repo` or `status` for deterministic JSON on stdout. The full
contract — exit codes, report/finding/summary field shapes, stable vs
provisional fields, and the evolution policy — is defined in
[`docs/OUTPUT_CONTRACT.md`](docs/OUTPUT_CONTRACT.md) and pinned by tests.

| Field | Present in | Meaning |
| --- | --- | --- |
| `formatVersion` | both | report shape version (currently `1`) |
| `command` | both | `"repo"` or `"status"` |
| `ok` | both | `true` when there are no error-level findings (`false` correlates with exit code `1`; exit code `2` means the command did not produce a report) |
| `generatedAt` | both | ISO-8601 timestamp |
| `repository` | both | `{ migrationsDir, journalPath, migrationCount, orphanSqlFiles }` |
| `database` | `status` only | `{ schema, table, tableExists, rowCount, maxCreatedAt }` |
| `summary` | `status` only | `{ local, database, applied, pending, skippedHazards, hashMismatches, databaseOnly }` |
| `findings` | both | array of `{ code, severity, message, hint?, details? }` |

Finding codes and severities are documented in [`docs/FINDINGS.md`](docs/FINDINGS.md). The project is pre-release: the field set may grow additively, and finding codes and severities are treated as user-facing API once released.

## Planned roadmap

- **v0.1:** repository audit + PostgreSQL migration-state audit
- **v0.2:** clean replay check against a disposable PostgreSQL database (implemented; pending prerelease)
- **v0.3:** GitHub Action + PR summary annotations
- **v0.4:** stronger divergent-history detection and policy configuration
- **v0.5+:** SQLite/D1, MySQL, Neon/Supabase/Turso-oriented adapters where they add real value

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the high-level roadmap.

For the detailed engineering plan, see:

- [`docs/AI_HANDOFF.md`](docs/AI_HANDOFF.md) — canonical start point for coding agents
- [`docs/MILESTONES.md`](docs/MILESTONES.md) — milestone sequence and acceptance gates
- [`docs/IMPROVEMENTS.md`](docs/IMPROVEMENTS.md) — prioritized technical/quality backlog
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — locked decisions and open research questions

## Project principles

1. **Read-only by default.** A doctor diagnoses; it does not silently repair production state.
2. **Deterministic.** Core checks do not require an AI model or external SaaS.
3. **CI-friendly.** Stable exit codes and machine-readable output are first-class features.
4. **Explain the failure.** Findings should say what happened, why it matters, and what the developer should inspect next.
5. **Small core, adapter edges.** Database/framework-specific support should be easy for external contributors to add.

## Contributing

Contributions are welcome. Human contributors can start with [`CONTRIBUTING.md`](CONTRIBUTING.md). Coding agents should start with [`docs/AI_HANDOFF.md`](docs/AI_HANDOFF.md) and follow [`AGENTS.md`](AGENTS.md).

## License

MIT — see [`LICENSE`](LICENSE).
