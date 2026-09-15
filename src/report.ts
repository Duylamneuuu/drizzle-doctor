import { createRequire } from 'node:module';

import type {
  DatabaseAnalysis,
  DatabaseSnapshot,
  DoctorReport,
  Finding,
  ReplayResult,
  RepoInspection,
  ReportMetadata,
} from './types.js';
import { hasErrors } from './types.js';

/**
 * Version of the machine-readable report shape (see docs/OUTPUT_CONTRACT.md).
 * Additive field additions keep the same version; breaking shape changes bump
 * it and require migration notes.
 */
export const REPORT_FORMAT_VERSION = 1;

/**
 * Version of the drizzle-doctor tool embedded in report metadata (P1.5).
 *
 * Read from `package.json` at runtime (like `cli.ts --version`) so the
 * metadata can never drift from the published package version. `src/report.ts`
 * must not import `src/cli.ts` (that would pull commander into the library
 * entry), so the lookup lives here.
 */
const TOOL_VERSION: string = (() => {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
})();

function baseMetadata(extra: Partial<ReportMetadata> = {}): ReportMetadata {
  return {
    toolVersion: TOOL_VERSION,
    backend: 'postgres',
    reportFormatVersion: REPORT_FORMAT_VERSION,
    ...extra,
  };
}

export function createRepoReport(
  inspection: RepoInspection,
  command: DoctorReport['command'] = 'repo',
): DoctorReport {
  return {
    formatVersion: REPORT_FORMAT_VERSION,
    command,
    ok: !hasErrors(inspection.findings),
    generatedAt: new Date().toISOString(),
    // `repo` never connects, so it reports no concrete migration location:
    // emitting the defaults here would imply the tool chose them.
    metadata: baseMetadata(),
    repository: {
      migrationsDir: inspection.migrationsDir,
      journalPath: inspection.journalPath,
      migrationCount: inspection.migrations.length,
      orphanSqlFiles: inspection.orphanSqlFiles,
    },
    findings: inspection.findings,
  };
}

export function createStatusReport(
  inspection: RepoInspection,
  database: DatabaseSnapshot,
  analysis: DatabaseAnalysis,
): DoctorReport {
  const findings: Finding[] = [...inspection.findings, ...analysis.findings];
  return {
    formatVersion: REPORT_FORMAT_VERSION,
    command: 'status',
    ok: !hasErrors(findings),
    generatedAt: new Date().toISOString(),
    // The schema/table come from the resolved database snapshot (user flags
    // or CLI defaults), never from the connection string (D11).
    metadata: baseMetadata({ migrationsSchema: database.schema, migrationsTable: database.table }),
    repository: {
      migrationsDir: inspection.migrationsDir,
      journalPath: inspection.journalPath,
      migrationCount: inspection.migrations.length,
      orphanSqlFiles: inspection.orphanSqlFiles,
    },
    database: {
      schema: database.schema,
      table: database.table,
      tableExists: database.tableExists,
      rowCount: database.rows.length,
      maxCreatedAt: analysis.maxCreatedAt,
    },
    summary: analysis.summary,
    findings,
  };
}

export function createReplayReport(
  inspection: RepoInspection,
  result: ReplayResult,
): DoctorReport {
  const findings: Finding[] = [...inspection.findings];
  if (result.firstFailure) {
    findings.push({
      code: 'REPLAY_MIGRATION_FAILED',
      severity: 'error',
      message: `Migration ${result.firstFailure.tag} failed to apply at statement ${result.firstFailure.statement} of ${result.firstFailure.statementCount}.`,
      hint: 'Inspect the failing statement in the disposable replay database; the migration history is not cleanly replayable from zero.',
      details: {
        tag: result.firstFailure.tag,
        statement: result.firstFailure.statement,
        statementCount: result.firstFailure.statementCount,
        ...(result.firstFailure.code ? { code: result.firstFailure.code } : {}),
      },
    });
  } else if (result.blocked === 'TARGET_NOT_EMPTY') {
    findings.push({
      code: 'REPLAY_TARGET_NOT_EMPTY',
      severity: 'error',
      message: `Replay target ${result.schema}.${result.table} already contains ${result.blockedRowCount ?? 0} migration row(s).`,
      hint: 'Clean replay requires an empty migration table. Point --database-url at a fresh disposable database, or reset the target, then re-run.',
      details: {
        schema: result.schema,
        table: result.table,
        rowCount: result.blockedRowCount ?? 0,
      },
    });
  }
  return {
    formatVersion: REPORT_FORMAT_VERSION,
    command: 'replay',
    ok: !hasErrors(findings),
    generatedAt: new Date().toISOString(),
    // The schema/table come from the resolved replay target (user flags or
    // CLI defaults), never from the connection string (D11).
    metadata: baseMetadata({ migrationsSchema: result.schema, migrationsTable: result.table }),
    repository: {
      migrationsDir: inspection.migrationsDir,
      journalPath: inspection.journalPath,
      migrationCount: inspection.migrations.length,
      orphanSqlFiles: inspection.orphanSqlFiles,
    },
    replay: result,
    findings,
  };
}

function formatFinding(finding: Finding): string[] {
  const lines = [`${finding.severity.toUpperCase()} [${finding.code}] ${finding.message}`];
  if (finding.hint) lines.push(`  Hint: ${finding.hint}`);
  return lines;
}

export function formatTextReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`drizzle-doctor ${report.command}`);
  lines.push('');
  lines.push(`Repository: ${report.repository.migrationsDir}`);
  lines.push(`Migrations: ${report.repository.migrationCount}`);

  if (report.database) {
    lines.push(
      `Database: ${report.database.schema}.${report.database.table} (${report.database.tableExists ? `${report.database.rowCount} rows` : 'table missing'})`,
    );
  }

  if (report.replay) {
    const { replay } = report;
    const target = `${replay.schema}.${replay.table}`;
    if (replay.blocked === 'TARGET_NOT_EMPTY') {
      lines.push(`Replay target: ${target} (not empty; blocked)`);
    } else if (replay.firstFailure) {
      lines.push(
        `Replay: ${target} (${replay.applied}/${replay.total} applied, failed at ${replay.firstFailure.tag} statement ${replay.firstFailure.statement}/${replay.firstFailure.statementCount})`,
      );
    } else {
      lines.push(`Replay: ${target} (${replay.applied}/${replay.total} applied)`);
    }
  }

  if (report.summary) {
    lines.push('');
    lines.push('Summary');
    lines.push(`  Applied: ${report.summary.applied}`);
    lines.push(`  Pending: ${report.summary.pending}`);
    lines.push(`  Skip hazards: ${report.summary.skippedHazards}`);
    lines.push(`  Hash mismatches: ${report.summary.hashMismatches}`);
    lines.push(`  Database-only rows: ${report.summary.databaseOnly}`);
  }

  lines.push('');
  lines.push('Findings');
  if (report.findings.length === 0) {
    lines.push('  None.');
  } else {
    for (const item of report.findings) {
      for (const line of formatFinding(item)) lines.push(`  ${line}`);
    }
  }

  lines.push('');
  lines.push(`Result: ${report.ok ? 'PASS' : 'FAIL'}`);
  return lines.join('\n');
}

export function formatJsonReport(report: DoctorReport): string {
  return JSON.stringify(report, null, 2);
}
