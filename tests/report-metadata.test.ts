// P1.5 compatibility metadata: every report carries tool version, backend,
// migration-schema/table location (status/replay only), and the report shape
// version. This pins the documented `metadata` section in
// docs/OUTPUT_CONTRACT.md so consumers can correlate reports over time.
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { analyzeDatabaseState } from '../src/analyze.js';
import { createRepoReport, createReplayReport, createStatusReport, REPORT_FORMAT_VERSION } from '../src/report.js';
import type { DatabaseSnapshot, Finding, LocalMigration, ReplayResult, RepoInspection } from '../src/types.js';

const require = createRequire(import.meta.url);
const packageJson = JSON.parse(require('fs').readFileSync(path.resolve('package.json'), 'utf8')) as {
  version: string;
};

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

function snapshot(): DatabaseSnapshot {
  return { schema: 'app_history', table: 'drizzle_log', tableExists: true, rows: [{ id: 1, createdAt: 1000, hash: 'hash-a' }] };
}

describe('report compatibility metadata (P1.5)', () => {
  it('repo reports carry tool version, backend, and shape version without a migration location', () => {
    const report = createRepoReport(inspection([local(0, 1000, '0000_first', 'hash-a')]));

    expect(report.metadata).toEqual({
      toolVersion: packageJson.version,
      backend: 'postgres',
      reportFormatVersion: REPORT_FORMAT_VERSION,
    });
    expect(report.metadata.reportFormatVersion).toBe(report.formatVersion);
    // `repo` never connects: no migrationsSchema/Table keys, not even nulls.
    expect('migrationsSchema' in report.metadata).toBe(false);
    expect('migrationsTable' in report.metadata).toBe(false);
  });

  it('repo reports keep the location keys absent even for another command identity', () => {
    const report = createRepoReport(inspection(), 'status');
    expect('migrationsSchema' in report.metadata).toBe(false);
    expect('migrationsTable' in report.metadata).toBe(false);
  });

  it('status reports carry the resolved migration schema/table from the database snapshot', () => {
    const db = snapshot();
    const analysis = analyzeDatabaseState([local(0, 1000, '0000_first', 'hash-a')], db);
    const report = createStatusReport(inspection([local(0, 1000, '0000_first', 'hash-a')]), db, analysis);

    expect(report.metadata).toMatchObject({
      toolVersion: packageJson.version,
      backend: 'postgres',
      migrationsSchema: 'app_history',
      migrationsTable: 'drizzle_log',
      reportFormatVersion: REPORT_FORMAT_VERSION,
    });
  });

  it('replay reports carry the resolved migration schema/table from the replay target', () => {
    const result: ReplayResult = { schema: 'custom_schema', table: 'custom_table', total: 1, applied: 1 };
    const report = createReplayReport(inspection([local(0, 1000, '0000_first', 'hash-a')]), result);

    expect(report.metadata).toMatchObject({
      toolVersion: packageJson.version,
      backend: 'postgres',
      migrationsSchema: 'custom_schema',
      migrationsTable: 'custom_table',
      reportFormatVersion: REPORT_FORMAT_VERSION,
    });
  });

  it('metadata carries no host, URL, or credential material (D11)', () => {
    const db = snapshot();
    const analysis = analyzeDatabaseState([local(0, 1000, '0000_first', 'hash-a')], db);
    for (const report of [
      createRepoReport(inspection()),
      createStatusReport(inspection(), db, analysis),
      createReplayReport(inspection(), { schema: 'drizzle', table: '__drizzle_migrations', total: 0, applied: 0 }),
    ]) {
      const serialized = JSON.stringify(report.metadata);
      expect(serialized).not.toMatch(/postgres:\/\//i);
      expect(serialized).not.toMatch(/host/i);
      expect(serialized).not.toMatch(/password/i);
      expect(serialized).not.toMatch(/credential/i);
      expect(serialized).not.toMatch(/secret/i);
    }
  });
});
