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

export interface DoctorReport {
  /** Shape version of the machine-readable report; see docs/OUTPUT_CONTRACT.md. */
  formatVersion: number;
  command: 'repo' | 'status';
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
  findings: Finding[];
}

export function hasErrors(findings: Finding[]): boolean {
  return findings.some((finding) => finding.severity === 'error');
}
