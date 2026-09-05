// M3 unit coverage for the replay engine's pure pieces: Drizzle-compatible
// breakpoint splitting and the replay report shape. End-to-end replay against
// a real PostgreSQL database lives in tests/replay.integration.test.ts.
import { describe, expect, it } from 'vitest';

import { createReplayReport } from '../src/report.js';
import { splitChunks } from '../src/replay.js';
import type { Finding, LocalMigration, ReplayResult, RepoInspection } from '../src/types.js';

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

describe('splitChunks (M3)', () => {
  it('splits on the literal Drizzle breakpoint marker', () => {
    const sql = 'create table a(id int);--> statement-breakpoint\ninsert into a values (1);';
    expect(splitChunks(sql)).toEqual(['create table a(id int);', 'insert into a values (1);']);
  });

  it('keeps a single chunk when there is no breakpoint', () => {
    expect(splitChunks('select 1;')).toEqual(['select 1;']);
  });

  it('drops empty and whitespace-only chunks (trailing breakpoint)', () => {
    expect(splitChunks('select 1;--> statement-breakpoint')).toEqual(['select 1;']);
    expect(splitChunks('select 1;--> statement-breakpoint\n  \n')).toEqual(['select 1;']);
  });

  it('keeps comment-only chunks as executable statements', () => {
    expect(splitChunks('-- just a comment')).toEqual(['-- just a comment']);
  });
});

describe('createReplayReport (M3)', () => {
  it('successful replay emits a clean replay report', () => {
    const result: ReplayResult = {
      schema: 'drizzle',
      table: '__drizzle_migrations',
      total: 2,
      applied: 2,
    };
    const report = createReplayReport(inspection([local(0, 1000, '0000_first', 'h1'), local(1, 2000, '0001_second', 'h2')]), result);

    expect(Object.keys(report).sort()).toEqual([
      'command',
      'findings',
      'formatVersion',
      'generatedAt',
      'ok',
      'replay',
      'repository',
    ]);
    expect(report.command).toBe('replay');
    expect(report.ok).toBe(true);
    expect(report.replay).toEqual(result);
    expect(report.findings).toEqual([]);
  });

  it('a failed migration produces REPLAY_MIGRATION_FAILED with the failing location', () => {
    const result: ReplayResult = {
      schema: 'drizzle',
      table: '__drizzle_migrations',
      total: 3,
      applied: 1,
      firstFailure: {
        tag: '0001_second',
        statement: 2,
        statementCount: 3,
        code: '42P01',
        message: 'relation "nope" does not exist',
      },
    };
    const report = createReplayReport(inspection([local(0, 1000, '0000_first', 'h1'), local(1, 2000, '0001_second', 'h2'), local(2, 3000, '0002_third', 'h3')]), result);

    expect(report.ok).toBe(false);
    expect(report.replay?.firstFailure?.tag).toBe('0001_second');
    const finding = report.findings.find((item) => item.code === 'REPLAY_MIGRATION_FAILED');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('error');
    expect(finding!.details).toMatchObject({ tag: '0001_second', statement: 2, statementCount: 3, code: '42P01' });
  });

  it('a non-empty target produces REPLAY_TARGET_NOT_EMPTY and applies nothing', () => {
    const result: ReplayResult = {
      schema: 'drizzle',
      table: '__drizzle_migrations',
      total: 2,
      applied: 0,
      blocked: 'TARGET_NOT_EMPTY',
      blockedRowCount: 4,
    };
    const report = createReplayReport(inspection([local(0, 1000, '0000_first', 'h1'), local(1, 2000, '0001_second', 'h2')]), result);

    expect(report.ok).toBe(false);
    expect(report.replay?.applied).toBe(0);
    const finding = report.findings.find((item) => item.code === 'REPLAY_TARGET_NOT_EMPTY');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('error');
    expect(finding!.details).toMatchObject({ schema: 'drizzle', table: '__drizzle_migrations', rowCount: 4 });
  });

  it('propagates repository findings into the replay report', () => {
    const result: ReplayResult = { schema: 'drizzle', table: '__drizzle_migrations', total: 1, applied: 1 };
    const repoFinding: Finding = { code: 'ORPHAN_SQL_FILE', severity: 'warning', message: 'orphan file' };
    const report = createReplayReport(inspection([local(0, 1000, '0000_first', 'h1')], [repoFinding]), result);

    expect(report.findings).toEqual([repoFinding]);
    expect(report.ok).toBe(true);
  });
});
