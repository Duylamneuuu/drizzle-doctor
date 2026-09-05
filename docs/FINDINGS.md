# Finding codes

Finding codes are intended to become stable machine-readable identifiers once the first package is published.

## Repository findings

| Code | Severity | Meaning |
| --- | --- | --- |
| `REPO_JOURNAL_MISSING` | error | `meta/_journal.json` was not found. |
| `REPO_JOURNAL_INVALID_JSON` | error | The journal could not be parsed as JSON. |
| `REPO_JOURNAL_INVALID_SHAPE` | error | The journal does not contain the expected `entries` array. |
| `JOURNAL_ENTRY_INVALID` | error | An entry is missing required Drizzle metadata. |
| `JOURNAL_DUPLICATE_INDEX` | error | Two journal entries use the same `idx`. |
| `JOURNAL_DUPLICATE_TIMESTAMP` | error | Two journal entries use the same `when` timestamp. |
| `JOURNAL_DUPLICATE_TAG` | error | A migration tag appears more than once. |
| `JOURNAL_INDEX_SEQUENCE` | warning | Journal position and `idx` are not the normal contiguous sequence. |
| `JOURNAL_TIMESTAMP_ORDER` | error | A later journal entry has a non-increasing timestamp. |
| `MIGRATION_SQL_MISSING` | error | A journal entry references a missing SQL file. |
| `MIGRATIONS_DIR_UNREADABLE` | error | The migration directory could not be listed. |
| `ORPHAN_SQL_FILE` | warning | A root migration SQL file is not referenced by the journal. |

## PostgreSQL/state findings

| Code | Severity | Meaning |
| --- | --- | --- |
| `DATABASE_MIGRATIONS_TABLE_MISSING` | info | The configured Drizzle migration table does not exist yet. |
| `DATABASE_DUPLICATE_TIMESTAMP` | error | More than one database migration row has the same `created_at`. |
| `DATABASE_TIMESTAMP_MISMATCH` | error | A database row matches a local hash but not its local timestamp. |
| `DATABASE_MIGRATION_NOT_IN_REPO` | error | The database contains migration history absent from the local repository. |
| `MIGRATION_HASH_MISMATCH` | error | A local SQL file differs from the migration recorded at the same timestamp. |
| `WOULD_BE_SKIPPED_BY_DRIZZLE` | error | A local migration is missing in the database and sits at/below the current database high-watermark. |

## Replay findings

| Code | Severity | Meaning |
| --- | --- | --- |
| `REPLAY_MIGRATION_FAILED` | error | A migration failed to apply during replay; the run stopped at the first failure. |
| `REPLAY_TARGET_NOT_EMPTY` | error | The replay target's Drizzle migration table already contains rows; clean replay requires an empty table. |

## Compatibility policy

- New codes may be added in minor releases.
- Existing codes should not change meaning silently.
- Removing/renaming a published code is a breaking change unless an alias/deprecation period is provided.
- Severity may eventually be policy-configurable; the default severity above represents the project's safety judgment.
