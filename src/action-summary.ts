/**
 * Shared rendering helpers for the drizzle-doctor GitHub Action (M4).
 *
 * The composite `action.yml` inlines the summary/annotations shell step; the
 * pure helpers here define that step's exact semantics and are pinned by
 * `tests/action-summary.test.ts` so local and runner behavior cannot drift.
 *
 * This module is intentionally internal: it is built to
 * `dist/action-summary.js` from the action's source checkout and imported by
 * file path, not through the published library entry (`src/index.ts`), so it
 * does not expand the supported public API before the P1.9 decision.
 *
 * Credential safety (D11): the JSON report never contains the database URL,
 * and these helpers never read `DATABASE_URL` or any secret input.
 */

import type { DoctorReport, Finding } from './types.js';

/** At most this many error-level findings become `::error` annotations. */
export const ACTION_MAX_ANNOTATIONS = 10;

/** At most this many findings appear as rows in the job summary table. */
export const ACTION_MAX_SUMMARY_ROWS = 50;

/** Escape a message for a GitHub workflow command (e.g. `::error`). */
export function escapeActionAnnotation(message: string): string {
  return message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

/** Format one error-level finding as a `::error` workflow command. */
export function actionAnnotationFor(finding: Finding): string {
  return `::error title=drizzle-doctor [${finding.code}]::${escapeActionAnnotation(`${finding.code}: ${finding.message}`)}`;
}

function actionTableCell(message: string): string {
  return message.replaceAll('|', '\\|').replaceAll('\r', ' ').replaceAll('\n', ' ');
}

/** Render the markdown job summary for a parsed report. */
export function renderActionSummary(report: DoctorReport): string {
  const lines: string[] = [];
  const errors = report.findings.filter((finding) => finding.severity === 'error').length;
  lines.push(`## drizzle-doctor — ${report.ok ? 'pass ✅' : 'findings ❌'}`, '');
  lines.push(`- command: \`${report.command}\``);
  lines.push(`- migrations: ${report.repository.migrationCount}`);
  lines.push(`- findings: ${report.findings.length} (${errors} error)`);
  if (report.summary) {
    const summary = report.summary;
    lines.push(
      `- applied: ${summary.applied}, pending: ${summary.pending}, ` +
        `skip hazards: ${summary.skippedHazards}, hash mismatches: ${summary.hashMismatches}, ` +
        `database-only: ${summary.databaseOnly}`,
    );
  }
  if (report.findings.length > 0) {
    lines.push('', '| Severity | Code | Message |', '| --- | --- | --- |');
    for (const finding of report.findings.slice(0, ACTION_MAX_SUMMARY_ROWS)) {
      lines.push(`| ${finding.severity} | \`${finding.code}\` | ${actionTableCell(finding.message)} |`);
    }
    if (report.findings.length > ACTION_MAX_SUMMARY_ROWS) {
      lines.push(`| … | … | _${report.findings.length - ACTION_MAX_SUMMARY_ROWS} more findings in the JSON artifact_ |`);
    }
  } else {
    lines.push('', 'No findings. The audited history is clean.');
  }
  return `${lines.join('\n')}\n`;
}
