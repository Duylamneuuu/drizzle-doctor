# drizzle-doctor

[![CI](https://github.com/Duylamneuuu/drizzle-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/Duylamneuuu/drizzle-doctor/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Duylamneuuu/drizzle-doctor/actions/workflows/codeql.yml/badge.svg)](https://github.com/Duylamneuuu/drizzle-doctor/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Never let Drizzle silently skip a migration again.

`drizzle-doctor` is a read-only CLI for auditing Drizzle migration history before deployment. It checks the migration journal on disk, compares it with PostgreSQL's Drizzle migration table, and flags states that Drizzle's timestamp high-watermark migration logic can skip.

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

## Safety

Database inspection is **read-only**. `drizzle-doctor` does not create schemas, apply migrations, rewrite journal files, or modify production data.

## Development quick start

```bash
npm install
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

## Planned roadmap

- **v0.1:** repository audit + PostgreSQL migration-state audit
- **v0.2:** clean replay check against ephemeral PostgreSQL
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
