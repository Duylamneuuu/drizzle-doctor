// Unit tests for the GitHub Action summary post-processor (M4).
//
// The composite action runs an inlined Node script with identical rendering
// semantics; these tests pin the internal helpers in `src/action-summary.ts`
// (built to `dist/action-summary.js` and imported by path from the action
// checkout) so local and runner behavior cannot drift apart.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { inspectMigrationRepository } from '../src/repository.js';
import { createRepoReport } from '../src/report.js';

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
    metadata: {
      toolVersion: '0.1.0-alpha.1',
      backend: 'postgres',
      reportFormatVersion: 1,
    },
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

  it('renders untrusted Markdown, HTML and table delimiters as literal text', () => {
    const message = '![approve](https://example.invalid) <img src=x> &#124; **PASS** `code` \\| ~~hidden~~\r\nnext';
    const finding = { code: 'MIGRATION_SQL_MISSING', severity: 'error' as const, message };
    const input = report({ ok: false, findings: [finding] });
    const summary = renderActionSummary(input);
    expect(summary).toContain(
      '| error | `MIGRATION_SQL_MISSING` | ' +
      '&#33;&#91;approve&#93;&#40;https&#58;&#47;&#47;example&#46;invalid&#41; ' +
      '&#60;img src&#61;x&#62; &#38;&#35;124&#59; &#42;&#42;PASS&#42;&#42; ' +
      '&#96;code&#96; &#92;&#124; &#126;&#126;hidden&#126;&#126;  next |',
    );
    // Only the Markdown presentation changes, not the report or annotations.
    expect(input.findings[0]?.message).toBe(message);
    expect(actionAnnotationFor(finding)).toContain('![approve](https://example.invalid)');
  });

  it('does not turn entity-encoded punctuation into Markdown or table syntax', () => {
    const summary = renderActionSummary(report({
      findings: [{ code: 'ORPHAN_SQL_FILE', severity: 'warning', message: '&#91;x&#93;&#40;url&#41; &vert; &lt;b&gt;' }],
    }));
    expect(summary).toContain('&#38;&#35;91&#59;x&#38;&#35;93&#59;');
    expect(summary).toContain('&#38;vert&#59; &#38;lt&#59;b&#38;gt&#59;');
  });

  it('keeps Markdown in a valid journal tag literal in a real repository report', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doctor-summary-'));
    try {
      await mkdir(join(dir, 'meta'));
      const tag = '0000_![approve](https:example.invalid)';
      await writeFile(join(dir, 'meta/_journal.json'), JSON.stringify({
        entries: [{ idx: 0, when: 1000, tag, breakpoints: true }],
      }));
      const input = createRepoReport(await inspectMigrationRepository(dir));
      expect(input.findings.map((finding) => finding.code)).toEqual(['MIGRATION_SQL_MISSING']);
      expect(input.findings[0]?.message).toContain(tag);
      const summary = renderActionSummary(input);
      expect(summary).not.toContain(tag);
      expect(summary).toContain('0000&#95;&#33;&#91;approve&#93;&#40;https&#58;example&#46;invalid&#41;');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
