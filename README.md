# drizzle-doctor

[![CI](https://github.com/Duylamneuuu/drizzle-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/Duylamneuuu/drizzle-doctor/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Duylamneuuu/drizzle-doctor/actions/workflows/codeql.yml/badge.svg)](https://github.com/Duylamneuuu/drizzle-doctor/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Never let Drizzle silently skip a migration again.

`drizzle-doctor` is a CLI for auditing Drizzle migration history before deployment. It checks the migration journal on disk, compares it with PostgreSQL's Drizzle migration table, and flags states that Drizzle's timestamp high-watermark migration logic can skip. An opt-in `replay` command additionally proves that the full history applies cleanly from zero on an explicitly disposable PostgreSQL database.

> **Status:** pre-alpha. A GitHub Pre-release exists at [`v0.1.0-alpha.2`](https://github.com/Duylamneuuu/drizzle-doctor/releases/tag/v0.1.0-alpha.2). No npm package has been published yet — local use is from source, and the composite Action is consumed from that tag (see [`docs/ACTION.md`](docs/ACTION.md)).

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

## Copy-paste recipes

There is no npm package yet. Local recipes assume a clone of this repository
(or the `v0.1.0-alpha.2` source tag). GitHub Action recipes pin that same
immutable tag — a moving `@v1` tag does not exist yet.

### Local repo audit

```bash
npm ci
npm run build
node dist/cli.js repo --migrations ./drizzle
```

### Local PostgreSQL status audit

Prefer `DATABASE_URL` over `--database-url` so the credential is not stored
in shell history or the process listing.

```bash
npm ci
npm run build
DATABASE_URL='postgres://...' node dist/cli.js status --migrations ./drizzle
```

JSON for CI/automation:

```bash
DATABASE_URL='postgres://...' node dist/cli.js status --migrations ./drizzle --json
```

Custom Drizzle migration metadata location:

```bash
DATABASE_URL='postgres://...' node dist/cli.js status \
  --migrations ./drizzle \
  --migrations-schema drizzle \
  --migrations-table __drizzle_migrations
```

### GitHub Actions — repo-only audit (no secrets)

```yaml
name: drizzle-doctor
on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: Duylamneuuu/drizzle-doctor@v0.1.0-alpha.2
        with:
          mode: repo
          migrations: ./drizzle
```

### GitHub Actions — status audit (read-only PostgreSQL)

```yaml
name: drizzle-doctor
on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  audit-status:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: Duylamneuuu/drizzle-doctor@v0.1.0-alpha.2
        with:
          mode: status
          migrations: ./drizzle
          database-url: ${{ secrets.DRIZZLE_DOCTOR_DATABASE_URL }}
```

Least-privilege `GRANT` recipe, trusted-event guidance, and credential
handling: [`docs/ACTION.md`](docs/ACTION.md). Replay is **not** part of the
Action; it remains a local opt-in command against an explicitly disposable
database (see [Clean replay](#clean-replay-opt-in-destructive) above).

## Development quick start

The repository ships a committed `package-lock.json`; use `npm ci` to install
reproducibly (this is what CI runs). Then follow the [local recipes](#copy-paste-recipes) above.

## Exit codes

- `0` — audit completed with no error-level findings
- `1` — at least one error-level finding was detected
- `2` — the command could not complete (invalid arguments, unreadable input, connection failure, etc.)

## Machine-readable output

Add `--json` to `repo`, `status`, or `replay` for deterministic JSON on stdout. The full
contract — exit codes, report/finding/summary field shapes, stable vs
provisional fields, and the evolution policy — is defined in
[`docs/OUTPUT_CONTRACT.md`](docs/OUTPUT_CONTRACT.md) and pinned by tests.

| Field | Present in | Meaning |
| --- | --- | --- |
| `formatVersion` | all | report shape version (currently `1`) |
| `command` | all | `"repo"`, `"status"`, or `"replay"` |
| `ok` | all | `true` when there are no error-level findings (`false` correlates with exit code `1`; exit code `2` means the command did not produce a report) |
| `generatedAt` | all | ISO-8601 timestamp |
| `metadata` | all | `{ toolVersion, backend, migrationsSchema?, migrationsTable? (status/replay only), reportFormatVersion }` — compatibility metadata, no hosts/URLs/credentials |
| `repository` | all | `{ migrationsDir, journalPath, migrationCount, orphanSqlFiles }` |
| `database` | `status` only | `{ schema, table, tableExists, rowCount, maxCreatedAt }` |
| `summary` | `status` only | `{ local, database, applied, pending, skippedHazards, hashMismatches, databaseOnly }` |
| `replay` | `replay` only | `{ schema, table, total, applied, blocked?, blockedRowCount?, firstFailure? }` |
| `findings` | all | array of `{ code, severity, message, hint?, details? }` |

Finding codes and severities are documented in [`docs/FINDINGS.md`](docs/FINDINGS.md). The project is pre-release: the field set may grow additively, and finding codes and severities are treated as user-facing API once released.

## Planned roadmap

- **v0.1:** repository audit + PostgreSQL migration-state audit (in the GitHub Pre-release; npm not published)
- **v0.2:** clean replay check against a disposable PostgreSQL database (implemented; included in the GitHub Pre-release; npm not published)
- **v0.3:** GitHub Action + PR summary annotations (Action source + tag `v0.1.0-alpha.2`; pin that tag — no moving `@v1` yet)
- **v0.4:** stronger divergent-history detection and policy configuration
- **v0.5+:** SQLite/D1, MySQL, Neon/Supabase/Turso-oriented adapters where they add real value

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the high-level roadmap.

## Known limitations

- Compatibility is verified for journal-based PostgreSQL migrations from
  `drizzle-orm@0.45.2` / `drizzle-kit@0.31.10`; the moving Drizzle v1
  release-candidate folder/table format is not supported yet.
- `status` verifies migration metadata consistency, not application-schema or
  SQL correctness. A PASS is not a full database health guarantee.
- `replay` must use a disposable PostgreSQL database and deliberately commits
  per migration for diagnostics; upstream Drizzle wraps the whole batch in one
  transaction. See [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md).
- The GitHub Action exposes read-only `repo`/`status` modes only. npm remains
  unpublished, and the programmatic library export is still pre-release.

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
