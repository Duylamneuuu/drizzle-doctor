// M2.4 output-contract assertions. The machine-readable report shape is
// documented in docs/OUTPUT_CONTRACT.md; these tests pin the documented
// fields so the JSON contract cannot drift silently. The CLI-level
// exit-code/`ok` relationship is asserted in tests/cli.test.ts.
import { describe, expect, it } from 'vitest';

import { analyzeDatabaseState } from '../src/analyze.js';
import { createRepoReport, createStatusReport, REPORT_FORMAT_VERSION } from '../src/report.js';
import type { DatabaseSnapshot, Finding, LocalMigration, RepoInspection } from '../src/types.js';

function local(idx: number, when: number, tag: string, hash: string): LocalMigration {
  return { idx, when, tag, breakpoints: true, sqlPath: `/tmp/${tag}.sql`, hash };
}

function inspection(migrations: LocalMigration[] = [], findings: Finding[] = []): RepoInspection {
  return {
    migrationsDir: '/tmp/drizzle',
    journalPath: '/tmp/drizzle/meta/_journal.json',
    migrations,
    orphanSqlFiles: [],
    findings,
  };
}

function database(rows: DatabaseSnapshot['rows']): DatabaseSnapshot {
  return { schema: 'drizzle', table: '__drizzle_migrations', tableExists: true, rows };
}

describe('machine-readable report shape (M2.4)', () => {
  it('repo reports carry exactly the documented top-level fields', () => {
    const report = createRepoReport(inspection([local(0, 1000, '0000_first', 'hash-a')]));

    expect(Object.keys(report).sort()).toEqual([
      'command',
      'findings',
      'formatVersion',
      'generatedAt',
      'ok',
      'repository',
    ]);
    expect(report.formatVersion).toBe(REPORT_FORMAT_VERSION);
    expect(report.command).toBe('repo');
    expect(report.ok).toBe(true);
    expect(report.database).toBeUndefined();
    expect(report.summary).toBeUndefined();
    expect(report.repository).toEqual({
      migrationsDir: '/tmp/drizzle',
      journalPath: '/tmp/drizzle/meta/_journal.json',
      migrationCount: 1,
      orphanSqlFiles: [],
    });
  });

  it('status reports add database and summary sections', () => {
    const snapshot = database([{ id: 1, createdAt: 1000, hash: 'hash-a' }]);
    const analysis = analyzeDatabaseState([local(0, 1000, '0000_first', 'hash-a')], snapshot);
    const report = createStatusReport(inspection([local(0, 1000, '0000_first', 'hash-a')]), snapshot, analysis);

    expect(Object.keys(report).sort()).toEqual([
      'command',
      'database',
      'findings',
      'formatVersion',
      'generatedAt',
      'ok',
      'repository',
      'summary',
    ]);
    expect(report.command).toBe('status');
    expect(report.database).toEqual({
      schema: 'drizzle',
      table: '__drizzle_migrations',
      tableExists: true,
      rowCount: 1,
      maxCreatedAt: 1000,
    });
    expect(report.summary).toEqual({
      local: 1,
      database: 1,
      applied: 1,
      pending: 0,
      skippedHazards: 0,
      hashMismatches: 0,
      databaseOnly: 0,
    });
  });

  it('finding objects expose only the documented fields', () => {
    const snapshot = database([
      { id: 1, createdAt: 1000, hash: 'hash-a' },
      { id: 2, createdAt: 1000, hash: 'hash-b' },
    ]);
    const analysis = analyzeDatabaseState([local(0, 1000, '0000_first', 'hash-a')], snapshot);

    const withDetails = analysis.findings.find((item) => item.code === 'DATABASE_DUPLICATE_TIMESTAMP');
    expect(withDetails).toBeDefined();
    expect(Object.keys(withDetails!).sort()).toEqual(['code', 'details', 'hint', 'message', 'severity']);
    expect(withDetails!.severity).toBe('error');
    expect(typeof withDetails!.message).toBe('string');
    expect(typeof withDetails!.hint).toBe('string');

    // Optional keys are omitted, not emitted as null: a finding without a
    // hint or details carries only the three required fields.
    const plain: Finding = { code: 'JOURNAL_DUPLICATE_TAG', severity: 'error', message: 'tag twice' };
    expect(Object.keys(plain).sort()).toEqual(['code', 'message', 'severity']);
  });

  it('ok is false exactly when an error-level finding exists', () => {
    const clean = createRepoReport(inspection([local(0, 1000, '0000_first', 'hash-a')]));
    expect(clean.ok).toBe(true);

    const broken = createRepoReport(inspection([], [
      { code: 'REPO_JOURNAL_MISSING', severity: 'error', message: 'journal missing' },
    ]));
    expect(broken.ok).toBe(false);

    const warningOnly = createRepoReport(inspection([], [
      { code: 'ORPHAN_SQL_FILE', severity: 'warning', message: 'orphan' },
    ]));
    expect(warningOnly.ok).toBe(true);
  });
});
