# Changelog

All notable changes to this project will be documented here.

The project intends to follow Semantic Versioning once packages are published.

## Unreleased

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
