# Machine-readable output contract

This document defines the machine-readable (`--json`) output of the `repo`,
`status`, and `replay` commands. It is the contract that CI and other
automation should rely on, so it is pinned by tests
(`tests/output-contract.test.ts`, `tests/cli.test.ts`).

The human-readable text report is intentionally not part of this contract;
only the JSON shape, exit codes, and finding codes are stable machine
surfaces.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The command completed and found **no error-level findings** (`ok: true`). |
| `1` | The command completed and found **at least one error-level finding** (`ok: false`). |
| `2` | The command **could not complete**: invalid arguments, unreadable input, missing database URL, connection failure, or another operational error. No report is emitted on stdout. |

Relationship to `ok`:

- exit `0` ⇔ report `ok: true`
- exit `1` ⇔ report `ok: false` (error-level finding present)
- exit `2` ⇔ no report at all (stderr carries a sanitized message)

Warning- and info-level findings do not affect `ok` or the exit code.

## Report shape

The JSON report is a single object on stdout. Top-level fields:

| Field | Present in | Type | Meaning |
| --- | --- | --- | --- |
| `formatVersion` | all | `number` | Shape version of this report (currently `1`). See [Evolution policy](#evolution-policy). |
| `command` | all | `"repo" \| "status" \| "replay"` | Command identity. |
| `ok` | all | `boolean` | `true` when there are no error-level findings. |
| `generatedAt` | all | `string` (ISO-8601) | Time the report was generated. Not deterministic. |
| `repository` | all | `object` | Local repository audit summary. |
| `database` | `status` only | `object` | Database migration-table snapshot. |
| `summary` | `status` only | `object` | Local-vs-database comparison counters. |
| `replay` | `replay` only | `object` | Clean-replay outcome. |
| `findings` | all | `array` | Ordered list of finding objects. |

### `repository`

| Field | Type | Meaning |
| --- | --- | --- |
| `migrationsDir` | `string` | Resolved migrations directory. |
| `journalPath` | `string` | Resolved `meta/_journal.json` path. |
| `migrationCount` | `number` | Number of valid local migrations read from the journal. |
| `orphanSqlFiles` | `string[]` | Root `.sql` files not referenced by the journal. |

### `database` (status only)

| Field | Type | Meaning |
| --- | --- | --- |
| `schema` | `string` | Configured migration schema. |
| `table` | `string` | Configured migration table. |
| `tableExists` | `boolean` | Whether the migration table was found. |
| `rowCount` | `number` | Number of migration rows read. |
| `maxCreatedAt` | `number \| null` | Database migration high-watermark; `null` when the table is missing or empty. |

### `summary` (status only)

| Field | Type | Meaning |
| --- | --- | --- |
| `local` | `number` | Local migrations read. |
| `database` | `number` | Database migration rows read. |
| `applied` | `number` | Local migrations matched by timestamp and hash. |
| `pending` | `number` | Local migrations newer than the database high-watermark. |
| `skippedHazards` | `number` | Local migrations missing in the DB at/below the high-watermark. |
| `hashMismatches` | `number` | Local migrations whose hash differs from the row at the same timestamp. |
| `databaseOnly` | `number` | Database rows with no matching local migration. |

### `replay` (replay only)

| Field | Type | Meaning |
| --- | --- | --- |
| `schema` | `string` | Configured migration schema. |
| `table` | `string` | Configured migration table. |
| `total` | `number` | Local migrations the replay attempted to apply. |
| `applied` | `number` | Migrations successfully applied before the run stopped. |
| `blocked` | `string` (optional) | `"TARGET_NOT_EMPTY"` when the target already had migration rows and nothing was applied. |
| `blockedRowCount` | `number` (optional) | Migration rows already present when the run was blocked. |
| `firstFailure` | `object` (optional) | The first failing migration; present only on failure. |

### `firstFailure` (replay only, optional)

| Field | Type | Meaning |
| --- | --- | --- |
| `tag` | `string` | Tag of the failing migration. |
| `statement` | `number` | 1-based index of the failing Drizzle breakpoint chunk. |
| `statementCount` | `number` | Total executed breakpoint chunks in the failing migration. |
| `code` | `string` (optional) | PostgreSQL SQLSTATE when the driver provided one. |
| `message` | `string` | Sanitized database error message (credential-safe). |

### `findings`

Each finding object has exactly these fields; optional fields are **omitted**
(never emitted as `null`) when absent:

| Field | Type | Meaning |
| --- | --- | --- |
| `code` | `string` | Stable machine identifier (see `docs/FINDINGS.md`). |
| `severity` | `"error" \| "warning" \| "info"` | Severity level. |
| `message` | `string` | What was observed. |
| `hint` | `string` (optional) | What to inspect next. |
| `details` | `object` (optional) | Structured context (ids, timestamps, hashes, tags). |

## Optional fields

- `database` and `summary` appear only in `status` reports.
- `replay` appears only in `replay` reports.
- `blocked`, `blockedRowCount`, and `firstFailure` appear only when the replay
  outcome needs them; a successful replay omits all three.
- `hint` and `details` appear only when a finding has them.
- `maxCreatedAt` is `null` when there is no database high-watermark.

## Field stability

Stable (treat as API once released):

- exit codes and their meaning
- `formatVersion` and the evolution policy below
- `command`, `ok`
- finding `code`, `severity`, and the semantics of `message`
- the presence/absence rules for optional sections

Provisional (may change additively before/after release):

- `generatedAt` timing
- exact `hint`/`details` contents
- `firstFailure.code` (SQLSTATE) presence
- any future additive fields

## Evolution policy

- Additive changes (new optional fields, new finding codes) keep the current
  `formatVersion`.
- Breaking shape changes (renaming/removing fields, changing types, changing
  the meaning of `ok` or an exit code) bump `formatVersion` and require
  migration notes in the changelog.
- `formatVersion` identifies the report shape, not the tool version. Consumers
  should reject reports whose `formatVersion` they do not understand.
- Finding codes are a separate API surface governed by `docs/FINDINGS.md`.

## Example

Healthy `repo` report:

```json
{
  "formatVersion": 1,
  "command": "repo",
  "ok": true,
  "generatedAt": "2026-09-04T02:00:00.000Z",
  "repository": {
    "migrationsDir": "/tmp/drizzle",
    "journalPath": "/tmp/drizzle/meta/_journal.json",
    "migrationCount": 1,
    "orphanSqlFiles": []
  },
  "findings": []
}
```
