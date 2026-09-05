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

Control: core database status adapter uses read queries only. Mutation belongs outside the product contract.

### Credential leakage

Control: connection strings are accepted through arguments/environment but never copied into structured/text reports. Driver errors are sanitized before display (`src/sanitize.ts`): the connection string, its `user:password@` prefix, percent-encoded password forms, and `password=` fragments are redacted, and the original error is never printed. Tests assert the invariant end-to-end (`tests/sanitize.test.ts`, `tests/cli.test.ts`). Tests and bug templates warn against posting real credentials. Documented guidance prefers `DATABASE_URL` over `--database-url` to keep credentials out of shell history and process listings.

### Malicious SQL in a repository

Current `repo`/`status` modes hash/read SQL; they do not execute it. A future `replay` command changes this threat boundary and therefore must use an isolated disposable database.

### SQL identifier injection

Custom migration schema/table names are identifier-quoted before query construction. Values used for metadata lookups are parameterized.

### Compromised dependencies / CI

Controls include Dependabot, CodeQL, least-privilege workflow permissions, and normal review/CI gates. Published GitHub Action/release workflows should pin third-party action revisions according to the project's release security policy before stable distribution.

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
