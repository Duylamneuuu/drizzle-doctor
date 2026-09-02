import { describe, expect, it } from 'vitest';

import { analyzeDatabaseState } from '../src/analyze.js';
import type { DatabaseSnapshot, LocalMigration } from '../src/types.js';

function local(idx: number, when: number, tag: string, hash: string): LocalMigration {
  return {
    idx,
    when,
    tag,
    breakpoints: true,
    sqlPath: `/tmp/${tag}.sql`,
    hash,
  };
}

function database(rows: DatabaseSnapshot['rows']): DatabaseSnapshot {
  return {
    schema: 'drizzle',
    table: '__drizzle_migrations',
    tableExists: true,
    rows,
  };
}

describe('analyzeDatabaseState', () => {
  it('detects a migration that Drizzle would skip behind the current high-watermark', () => {
    const migrations = [
      local(0, 1000, '0000_first', 'hash-a'),
      local(1, 2000, '0001_second', 'hash-b'),
      local(2, 1500, '0002_late_old_timestamp', 'hash-c'),
    ];

    const result = analyzeDatabaseState(
      migrations,
      database([
        { id: 1, createdAt: 1000, hash: 'hash-a' },
        { id: 2, createdAt: 2000, hash: 'hash-b' },
      ]),
    );

    expect(result.summary.applied).toBe(2);
    expect(result.summary.skippedHazards).toBe(1);
    expect(result.findings.some((item) => item.code === 'WOULD_BE_SKIPPED_BY_DRIZZLE')).toBe(true);
  });

  it('treats migrations newer than the database high-watermark as normal pending work', () => {
    const result = analyzeDatabaseState(
      [local(0, 1000, '0000_first', 'hash-a'), local(1, 2000, '0001_second', 'hash-b')],
      database([{ id: 1, createdAt: 1000, hash: 'hash-a' }]),
    );

    expect(result.summary.applied).toBe(1);
    expect(result.summary.pending).toBe(1);
    expect(result.summary.skippedHazards).toBe(0);
  });

  it('detects a changed migration file by hash', () => {
    const result = analyzeDatabaseState(
      [local(0, 1000, '0000_first', 'new-hash')],
      database([{ id: 1, createdAt: 1000, hash: 'original-hash' }]),
    );

    expect(result.summary.hashMismatches).toBe(1);
    expect(result.findings.some((item) => item.code === 'MIGRATION_HASH_MISMATCH')).toBe(true);
  });

  it('detects database history that is not represented locally', () => {
    const result = analyzeDatabaseState(
      [local(0, 1000, '0000_first', 'hash-a')],
      database([
        { id: 1, createdAt: 1000, hash: 'hash-a' },
        { id: 2, createdAt: 1500, hash: 'unknown-hash' },
      ]),
    );

    expect(result.summary.databaseOnly).toBe(1);
    expect(result.findings.some((item) => item.code === 'DATABASE_MIGRATION_NOT_IN_REPO')).toBe(true);
  });

  it('treats a missing migration table as a first-deploy state', () => {
    const result = analyzeDatabaseState(
      [local(0, 1000, '0000_first', 'hash-a')],
      { schema: 'drizzle', table: '__drizzle_migrations', tableExists: false, rows: [] },
    );

    expect(result.summary.pending).toBe(1);
    expect(result.findings[0]?.code).toBe('DATABASE_MIGRATIONS_TABLE_MISSING');
  });
});
