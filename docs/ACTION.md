# drizzle-doctor GitHub Action (M4)

This is the operator guide for the composite GitHub Action defined in
[`action.yml`](../action.yml). The Action wraps the `drizzle-doctor` CLI so a
repository gets the audit without a custom CI script.

> Status: the Action source exists on this branch but **no Action
> release/tag has been published** — publishing a release/tag is
> maintainer-gated (see [`docs/AUTOMATION.md`](AUTOMATION.md) and issue #3)
> and must not be done by automation.

## Modes

- `repo` (default) — audits the local migration journal/SQL. Needs **no
  secrets**.
- `status` — additionally compares against PostgreSQL using read-only
  credentials supplied via the `database-url` input.
- Replay is intentionally **not** part of the Action surface (M4 Mode 3 is
  explicitly "later"). Keep the Action read-only.

## Usage

```yaml
permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: Audit migrations (no secrets)
        uses: Duylamneuuu/drizzle-doctor@v1 # maintainer-published moving tag (not yet created)
        with:
          mode: repo
          migrations: ./drizzle
```

```yaml
permissions:
  contents: read

jobs:
  audit-status:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: Audit migrations against PostgreSQL (read-only)
        uses: Duylamneuuu/drizzle-doctor@v1 # maintainer-published moving tag (not yet created)
        with:
          mode: status
          migrations: ./drizzle
          database-url: ${{ secrets.DRIZZLE_DOCTOR_DATABASE_URL }}
```

Run the Action only on trusted events (`push`, `pull_request` from the same
repository, `schedule`, `workflow_dispatch`). Do **not** pass secrets to the
Action from untrusted `pull_request_target` runs or other contexts where
forked-repo code could observe them.

## Behavior

- The Action checks out its own source (`github.action_path`), runs
  `npm ci && npm run build` there, then runs `dist/cli.js <mode> --json`
  and renders the report into the job summary.
- Job summary: `pass ✅` / `findings ❌` heading, command, migration count,
  findings count, `status`-only counters, and a findings table (capped at 50
  rows; the full report is echoed per-finding into the log).
- Error-level findings also become `::error` annotations (capped at 10).
- Output `ok` is `'true'` when the audit completed with no error-level
  findings, `'false'` otherwise (including when the audit could not
  complete). The step still re-exits with the CLI's exit code (0/1/2) so the
  job fails correctly.
- Rendering semantics live in `src/action-summary.ts` (built to
  `dist/action-summary.js` inside the action checkout) and are pinned by
  `tests/action-summary.test.ts`. That module is **internal** to the Action
  checkout — imported by file path, not through the published library entry
  (`src/index.ts`) — so it does not expand the supported public API before
  the P1.9 decision.

## Credential safety (D11)

- The `database-url` input travels only through the step environment
  (`DATABASE_URL`); it is never interpolated into script text, never passed
  as a CLI flag (which would expose it in process listings), and never
  printed. The step adds `::add-mask::` for it.
- Driver errors are sanitized by the CLI before they reach logs, and the
  JSON report never contains the URL. The summary renderer never reads
  secrets.
- Prefer a least-privilege credential for `status` (next section) over a
  superuser URL.

## Least-privilege PostgreSQL credential (P1.13)

`status` only needs to check that the migration table exists and read its
rows. The adapter issues exactly two read statements (see
`src/postgres.ts`):

1. `select exists (select 1 from information_schema.tables where
   table_schema = $1 and table_name = $2)` — needs `CONNECT` on the database
   (implicit `USAGE` on `information_schema` for the visibility check).
2. `select id, hash, created_at from <schema>.<table> order by created_at
   asc, id asc` — needs `USAGE` on the migration schema plus `SELECT` on the
   migration table.

Verified 2026-09-09 against PostgreSQL 16 with a dedicated login role: with
only these grants, both adapter queries succeed, a real `status` run returns
its finding (exit 1 on a hash mismatch, as expected), and an `INSERT` attempt
fails with `permission denied` — confirming the credential is read-only for
the audited objects:

```sql
CREATE ROLE auditor LOGIN PASSWORD '<secret>';
GRANT CONNECT ON DATABASE app TO auditor;
GRANT USAGE ON SCHEMA drizzle TO auditor;
GRANT SELECT ON drizzle.__drizzle_migrations TO auditor;
```

Substitute your database, schema, and table names as needed. Do not grant
`CREATE`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, or ownership — `status`
never writes. (Replay is a separate destructive command and is not part of
this Action.)

## Dependency pinning (P1.12)

Third-party Actions used by `action.yml` are pinned to immutable commit SHAs
with the release tag kept as a trailing comment (e.g.
`actions/setup-node@<sha> # v7`). To update a pin:

1. Resolve the new tag to its commit SHA (e.g.
   `git ls-remote https://github.com/actions/setup-node.git refs/tags/v7`
   — for annotated tags, dereference once more to the commit).
2. Replace the SHA, keep the `# <tag>` comment accurate.
3. Re-run the smoke workflow (`.github/workflows/action-smoke.yml`) and the
   full suite before merging.

Currently pinned:

- `actions/setup-node@v7` → `820762786026740c76f36085b0efc47a31fe5020`
- Node runtime `22` (see `.node-version`) is passed as `node-version` to
  `actions/setup-node`, not via `node-version-file`: `github.action_path`
  does not resolve inside that input in composite actions. When bumping the
  Node version, update `.node-version` and the `node-version` input together
  and re-run the smoke workflow.

Resolved 2026-09-09 for future use (example workflows, release tooling):

- `actions/checkout@v7` → `3d3c42e5aac5ba805825da76410c181273ba90b1`
- `actions/upload-artifact@v4` → `ea165f8d65b6e75b540449e92b4886f43607fa02`
- `github/codeql-action@v4` → `fddeee1a7ece751b577e409a89057319e3172939`

## Versioning / release strategy

No Action release exists yet. The recommended strategy (for the maintainer,
not automation):

- Publish immutable Git tags per release (e.g. `v1.0.0`) pointing at SHAs
  whose internal third-party pins are already immutable.
- Maintain a moving major tag (e.g. `v1`) that the maintainer advances to
  each compatible release, so consumers can pin to `@v1` while the Action's
  own dependencies stay SHA-pinned internally.
- Do not create or move release tags from automation; see issue #3
  ("Agent constraints").

## Testing

- Unit: `tests/action-summary.test.ts` pins the summary/annotation rendering
  (pass/fail headings, counters, table, annotation escaping, no-URL leak).
- CI smoke: `.github/workflows/action-smoke.yml` exercises the composite
  action in-repo (`uses: ./`) in both `repo` mode (no secrets) and `status`
  mode (service-container PostgreSQL), and asserts the `ok` output.
