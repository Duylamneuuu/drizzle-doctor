# Security Policy

## Supported versions

`drizzle-doctor` is currently pre-alpha. Security fixes are applied to the latest development line until the first stable release policy is published.

## Reporting a vulnerability

Do not post credentials, connection strings, private database metadata, or exploit details in a public issue.

If GitHub private vulnerability reporting is available for this repository, use it. If it is not available, open a minimal public issue asking the maintainer to establish a private reporting channel; do not include sensitive details in that issue.

## Security model

The core product is intentionally read-only:

- repository checks read migration files and metadata
- PostgreSQL checks run `SELECT` queries against migration metadata
- the default `repo`/`status` commands do not apply migrations or repair
  production databases
- the separate `replay` command executes migration SQL only after an explicit
  URL and `--confirm-destructive`; it must target a disposable database and
  refuses a non-empty Drizzle migration table
- database URLs are never included in reports

A report may still reveal schema/table names and migration metadata. Treat generated reports according to the sensitivity of the repository/database being inspected.

## Out of scope

Reports about intentionally malformed local fixtures that require the user to
execute arbitrary untrusted SQL are not security vulnerabilities by themselves.
The shipped clean-replay command is covered by [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)
and must run only against an isolated disposable database.
