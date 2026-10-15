# Threat model

`drizzle-doctor` reads source-controlled migration files and, in `status` mode, migration metadata from a PostgreSQL database. The project deliberately keeps this boundary small.

## Assets to protect

- database credentials
- production data
- private repository contents
- migration metadata that may reveal internal schema evolution
- CI integrity

## Trust boundaries

### Local migration repository

Migration SQL and journal files are treated as input data for `repo` and `status` checks. The current commands do not execute migration SQL.

### PostgreSQL status connection

`status` uses the supplied connection only to discover/read the configured Drizzle migration table. It must not apply migrations or modify application data.

For production use, prefer a database role that can read the migration metadata but cannot modify schema/data.

### Reports and logs

Reports may contain:

- migration tags/timestamps
- hashes
- schema/table names
- sanitized database errors

They must not contain the database URL or credentials.

## Threats and controls

### Accidental production mutation

Control: the status adapter runs both metadata queries in an explicit PostgreSQL
`READ ONLY` transaction. A `SELECT` alone is not sufficient: a configured view or
row-security policy can invoke a function that writes data. PostgreSQL rejects
such ordinary database writes in the read-only transaction; inspection fails
rather than silently allowing the side effect. The dedicated connection is
always closed, ending the transaction on success and failure.

Keep using least-privilege credentials as defense in depth. PostgreSQL's
[read-only access mode](https://www.postgresql.org/docs/16/sql-set-transaction.html)
is not a sandbox for an untrusted server or extensions with external side
effects. Mutation belongs outside the status product contract; explicit
disposable replay remains separate.

### Credential leakage

Control: connection strings are accepted through arguments/environment but never copied into structured/text reports. Driver errors are sanitized before display (`src/sanitize.ts`): the connection string, its `user:password@` prefix, percent-encoded password forms, and `password=` fragments are redacted, and the original error is never printed. Tests assert the invariant end-to-end (`tests/sanitize.test.ts`, `tests/cli.test.ts`). Tests and bug templates warn against posting real credentials. Documented guidance prefers `DATABASE_URL` over `--database-url` to keep credentials out of shell history and process listings.

### Malicious SQL in a repository

Current `repo`/`status` modes hash/read SQL; they do not execute it. The
separate `replay` command changes this threat boundary and therefore must use
an isolated disposable database.

Journal tags are accepted only as root-level file names (no POSIX or Windows
path separators). This prevents malformed repository metadata from making an
audit read, hash, or replay a file outside the configured migrations directory.

### SQL identifier injection

Custom migration schema/table names are identifier-quoted before query construction. Values used for metadata lookups are parameterized.

### Compromised dependencies / CI

Controls include Dependabot, CodeQL, least-privilege workflow permissions, and normal review/CI gates. Published GitHub Action/release workflows should pin third-party action revisions according to the project's release security policy before stable distribution.

Composite Action inputs are mapped through environment variables and quoted as
Bash array values. Caller-supplied paths/schema/table names are never
interpolated into shell source.

### False reassurance

A PASS means only that implemented checks found no error-level findings. It is not proof that application schema or migration SQL is logically correct. Documentation and output should avoid presenting the tool as a full database verifier.

## Replay requirements

The `replay` command (milestone M3, `src/replay.ts`) ships and satisfies all
of these:

- execution target is explicitly supplied by the user and must be confirmed
  with `--confirm-destructive`; replay never creates or manages infrastructure
- replay never defaults to `DATABASE_URL` used for `status` — it requires an
  explicit `--database-url` and never reads the environment variable
- clear destructive warning/CLI semantics: the command is visibly distinct
  from `repo`/`status`, and the target must have an empty Drizzle migration
  table or the run is refused
- credentials are not logged: connection failures and migration errors are
  sanitized before they reach stderr or the JSON report (invariant D11)
- failing migration/statement is reported without dumping sensitive data
  unnecessarily (tag, breakpoint-chunk index, SQLSTATE, sanitized message)
- test suite includes a guard against accidental use of a production-style
  status URL (`tests/cli.test.ts` asserts replay never reads `DATABASE_URL`)

## Security changes

Any change that adds write queries, telemetry, remote execution, automatic repair, or required hosted services changes this threat model and must update this document in the same PR.
