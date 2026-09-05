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

export function hasErrors(findings: Finding[]): boolean {
  return findings.some((finding) => finding.severity === 'error');
}
