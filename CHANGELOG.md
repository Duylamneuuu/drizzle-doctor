# Changelog

All notable changes to this project will be documented here.

The project intends to follow Semantic Versioning once packages are published.

## [0.1.0-alpha.1] - 2026-09-04

First npm prerelease. Prepared by the weekly maintainer/release review
(package name `drizzle-doctor` is available on the npm registry, packed
tarball verified). Publication itself requires maintainer authorization
(`docs/DECISIONS.md` D14, `AGENTS.md`) and was not performed by automation.

### Added

- initial TypeScript CLI skeleton
- local Drizzle journal and SQL integrity audit
- read-only PostgreSQL migration table adapter
- detection for migration hash mismatches, database-only history, and high-watermark skip hazards
- JSON and text reports with stable exit semantics
- unit and PostgreSQL integration tests
- CI, Dependabot, contribution and security documentation
- M1 validation suite: finding-by-finding fixture matrix for every modeled repository and database state
- upstream semantics verification against the pinned `drizzle-orm@0.45.2` package with hash/timestamp equivalence tests
- compatibility notes documenting verified Drizzle behavior, finding mapping, and an upgrade checklist (`docs/COMPATIBILITY.md`)
- custom migration table coverage in PostgreSQL integration tests

### Changed

- invalid CLI invocations (unknown command/option) now exit with code `2` instead of `1`, matching the documented error-level contract
- running `drizzle-doctor` without a subcommand now shows help with exit code `2` instead of implicitly running `repo`; top-level `-m/--json` options moved to the `repo` command
- `--version` derives from `package.json` instead of a hard-coded copy
- pinned `drizzle-orm@0.45.2` as an exact devDependency for compatibility tests; `package-lock.json` committed
- database connection errors are sanitized before display: the connection string, its password, and `password=` fragments are redacted from stderr output, so driver errors can never echo credentials (invariant D11); `--database-url` help text now points users at `DATABASE_URL` to keep credentials out of shell history and process listings
- JSON reports now include `formatVersion: 1` identifying the report shape, and the machine-readable output contract (exit codes, field shapes, stable vs provisional fields, evolution policy) is documented in `docs/OUTPUT_CONTRACT.md` and pinned by `tests/output-contract.test.ts`

## Unreleased

### Added

- `replay` command (M3): applies the full local migration history from zero on
  an explicitly disposable PostgreSQL database. Requires an explicit
  `--database-url` (never reads `DATABASE_URL`) and `--confirm-destructive`,
  refuses targets whose migration table already has rows, replays in journal
  order with Drizzle breakpoint splitting, and stops at the first failing
  migration with the tag, statement index, SQLSTATE, and a sanitized error.
  New findings: `REPLAY_MIGRATION_FAILED`, `REPLAY_TARGET_NOT_EMPTY`. The
  `replay` report section and findings are pinned by
  `tests/output-contract.test.ts`, unit/integration coverage in
  `tests/replay.test.ts` and `tests/replay.integration.test.ts`, and CLI
  safety guards in `tests/cli.test.ts`.
