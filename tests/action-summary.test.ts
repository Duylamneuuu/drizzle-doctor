// Unit tests for the GitHub Action summary post-processor (M4).
//
// The composite action runs an inlined Node script with identical rendering
// semantics; these tests pin the internal helpers in `src/action-summary.ts`
// (built to `dist/action-summary.js` and imported by path from the action
// checkout) so local and runner behavior cannot drift apart.
import { describe, expect, it } from 'vitest';

import {
  actionAnnotationFor,
  escapeActionAnnotation,
  renderActionSummary,
} from '../src/action-summary.js';
import type { DoctorReport } from '../src/types.js';

function report(overrides: Partial<DoctorReport> = {}): DoctorReport {
  return {
    formatVersion: 1,
    command: 'repo',
    ok: true,
    generatedAt: '2026-09-09T00:00:00.000Z',
    repository: {
      migrationsDir: '/tmp/drizzle',
      journalPath: '/tmp/drizzle/meta/_journal.json',
      migrationCount: 1,
      orphanSqlFiles: [],
    },
    findings: [],
    ...overrides,
  };
}

describe('action summary helpers (M4)', () => {
  it('renders a passing repo summary with no findings', () => {
    const summary = renderActionSummary(report());
    expect(summary).toContain('## drizzle-doctor — pass ✅');
    expect(summary).toContain('command: `repo`');
    expect(summary).toContain('No findings.');
  });

  it('renders a status summary with counters and a findings table', () => {
    const summary = renderActionSummary(
      report({
        command: 'status',
        ok: false,
        repository: {
          migrationsDir: '/tmp/drizzle',
          journalPath: '/tmp/drizzle/meta/_journal.json',
          migrationCount: 2,
          orphanSqlFiles: [],
        },
        summary: {
          local: 2,
          database: 1,
          applied: 1,
          pending: 1,
          skippedHazards: 1,
          hashMismatches: 0,
          databaseOnly: 0,
        },
        findings: [
          {
            code: 'WOULD_BE_SKIPPED_BY_DRIZZLE',
            severity: 'error',
            message: 'Local migration 0002_late would be skipped.',
          },
        ],
      }),
    );
    expect(summary).toContain('findings ❌');
    expect(summary).toContain('skip hazards: 1');
    expect(summary).toContain('| Severity | Code | Message |');
    expect(summary).toContain('`WOULD_BE_SKIPPED_BY_DRIZZLE`');
  });

  it('escapes newlines and percents in annotations', () => {
    const line = actionAnnotationFor({
      code: 'MIGRATION_SQL_MISSING',
      severity: 'error',
      message: 'Line one\nline two % done',
    });
    expect(line.startsWith('::error title=drizzle-doctor [MIGRATION_SQL_MISSING]::')).toBe(true);
    expect(line).toContain('Line one%0Aline two %25 done');
    expect(escapeActionAnnotation('a\rb')).toBe('a%0Db');
  });

  it('never echoes a database URL through the renderer', () => {
    const url = 'postgres://auditor:s3cret-pw@db.internal:5432/app';
    const summary = renderActionSummary(
      report({ findings: [{ code: 'WOULD_BE_SKIPPED_BY_DRIZZLE', severity: 'error', message: 'Skipped.' }] }),
    );
    expect(summary).not.toContain(url);
    expect(actionAnnotationFor({ code: 'X', severity: 'error', message: 'ok' })).not.toContain(url);
  });
});
