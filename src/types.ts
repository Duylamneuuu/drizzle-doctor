export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
}

export interface LocalMigration {
  idx: number;
  when: number;
  tag: string;
  breakpoints: boolean;
  sqlPath: string;
  hash: string;
}

export interface RepoInspection {
  migrationsDir: string;
  journalPath: string;
  migrations: LocalMigration[];
  orphanSqlFiles: string[];
  findings: Finding[];
}

export interface DatabaseMigration {
  id: number;
  hash: string;
  createdAt: number;
}

export interface DatabaseSnapshot {
  schema: string;
  table: string;
  tableExists: boolean;
  rows: DatabaseMigration[];
}

export interface StatusSummary {
  local: number;
  database: number;
  applied: number;
  pending: number;
  skippedHazards: number;
  hashMismatches: number;
  databaseOnly: number;
}

export interface DatabaseAnalysis {
  findings: Finding[];
  summary: StatusSummary;
  maxCreatedAt: number | null;
}

/** Why a replay run was blocked before applying anything. */
export type ReplayBlockedReason = 'TARGET_NOT_EMPTY';

/**
 * The first migration that failed to apply during replay.
 *
 * `statement` is the 1-based index of the failing Drizzle breakpoint chunk
 * among the executed chunks (matching the execution granularity of the
 * upstream PostgreSQL migrator), and `statementCount` is the total number of
 * executed chunks in that migration. `code` is the PostgreSQL SQLSTATE when
 * the driver provided one.
 */
export interface ReplayFailure {
  tag: string;
  statement: number;
  statementCount: number;
  code?: string;
  /** Sanitized database error message (credential-safe, invariant D11). */
  message: string;
}

export interface ReplayResult {
  schema: string;
  table: string;
  total: number;
  applied: number;
  /** Present when the run was blocked before applying anything. */
  blocked?: ReplayBlockedReason;
  /** Migration rows already present in the target that blocked the run. */
  blockedRowCount?: number;
  /** Present when a migration failed; the run stops at the first failure. */
  firstFailure?: ReplayFailure;
}

export interface DoctorReport {
  /** Shape version of the machine-readable report; see docs/OUTPUT_CONTRACT.md. */
  formatVersion: number;
  command: 'repo' | 'status' | 'replay';
  ok: boolean;
  generatedAt: string;
  repository: {
    migrationsDir: string;
    journalPath: string;
    migrationCount: number;
    orphanSqlFiles: string[];
  };
  database?: {
    schema: string;
    table: string;
    tableExists: boolean;
    rowCount: number;
    maxCreatedAt: number | null;
  };
  summary?: StatusSummary;
  replay?: ReplayResult;
  findings: Finding[];
}

/**
 * Single source of truth for every machine-readable finding code the tool can
 * emit (P1.11). Keep this list, `docs/FINDINGS.md`, and the per-call-site
 * severities in sync: any new finding must add its code here and in
 * `docs/FINDINGS.md` in the same change.
 *
 * The expected severity is recorded alongside each code and pinned by
 * `tests/findings-registry.test.ts` so a severity change is always a
 * deliberate, reviewed decision (finding codes and severities are
 * user-facing API per D7). `'TARGET_NOT_EMPTY'` is not a finding code — it is
 * the internal blocked-reason enum stored on `ReplayResult.blocked` — and is
 * therefore intentionally absent from this list.
 */
export const FINDING_CODES = [
  'REPO_JOURNAL_MISSING',
  'REPO_JOURNAL_UNREADABLE',
  'REPO_JOURNAL_INVALID_JSON',
  'REPO_JOURNAL_INVALID_SHAPE',
  'JOURNAL_ENTRY_INVALID',
  'JOURNAL_DUPLICATE_INDEX',
  'JOURNAL_DUPLICATE_TIMESTAMP',
  'JOURNAL_DUPLICATE_TAG',
  'JOURNAL_INDEX_SEQUENCE',
  'JOURNAL_TIMESTAMP_ORDER',
  'MIGRATION_SQL_MISSING',
  'MIGRATION_SQL_UNREADABLE',
  'MIGRATIONS_DIR_UNREADABLE',
  'ORPHAN_SQL_FILE',
  'DATABASE_MIGRATIONS_TABLE_MISSING',
  'DATABASE_DUPLICATE_TIMESTAMP',
  'DATABASE_TIMESTAMP_MISMATCH',
  'DATABASE_MIGRATION_NOT_IN_REPO',
  'MIGRATION_HASH_MISMATCH',
  'WOULD_BE_SKIPPED_BY_DRIZZLE',
  'REPLAY_MIGRATION_FAILED',
  'REPLAY_TARGET_NOT_EMPTY',
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

/** The default severity each finding code is emitted with. */
export const FINDING_SEVERITIES: Record<FindingCode, Finding['severity']> = {
  REPO_JOURNAL_MISSING: 'error',
  REPO_JOURNAL_UNREADABLE: 'error',
  REPO_JOURNAL_INVALID_JSON: 'error',
  REPO_JOURNAL_INVALID_SHAPE: 'error',
  JOURNAL_ENTRY_INVALID: 'error',
  JOURNAL_DUPLICATE_INDEX: 'error',
  JOURNAL_DUPLICATE_TIMESTAMP: 'error',
  JOURNAL_DUPLICATE_TAG: 'error',
  JOURNAL_INDEX_SEQUENCE: 'warning',
  JOURNAL_TIMESTAMP_ORDER: 'error',
  MIGRATION_SQL_MISSING: 'error',
  MIGRATION_SQL_UNREADABLE: 'error',
  MIGRATIONS_DIR_UNREADABLE: 'error',
  ORPHAN_SQL_FILE: 'warning',
  DATABASE_MIGRATIONS_TABLE_MISSING: 'info',
  DATABASE_DUPLICATE_TIMESTAMP: 'error',
  DATABASE_TIMESTAMP_MISMATCH: 'error',
  DATABASE_MIGRATION_NOT_IN_REPO: 'error',
  MIGRATION_HASH_MISMATCH: 'error',
  WOULD_BE_SKIPPED_BY_DRIZZLE: 'error',
  REPLAY_MIGRATION_FAILED: 'error',
  REPLAY_TARGET_NOT_EMPTY: 'error',
};

export function hasErrors(findings: Finding[]): boolean {
  return findings.some((finding) => finding.severity === 'error');
}
