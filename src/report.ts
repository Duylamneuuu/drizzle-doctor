import type {
  DatabaseAnalysis,
  DatabaseSnapshot,
  DoctorReport,
  Finding,
  RepoInspection,
} from './types.js';
import { hasErrors } from './types.js';

export function createRepoReport(
  inspection: RepoInspection,
  command: DoctorReport['command'] = 'repo',
): DoctorReport {
  return {
    command,
    ok: !hasErrors(inspection.findings),
    generatedAt: new Date().toISOString(),
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
    command: 'status',
    ok: !hasErrors(findings),
    generatedAt: new Date().toISOString(),
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
