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
  it('keeps the high-watermark null for an existing empty migration table', () => {
    const result = analyzeDatabaseState([local(0, 1000, '0000_first', 'hash-a')], database([]));

    expect(result.maxCreatedAt).toBeNull();
    expect(result.summary.pending).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it('uses the actual maximum when all database timestamps are negative', () => {
    const result = analyzeDatabaseState([], database([
      { id: 1, createdAt: -1, hash: 'hash-a' },
      { id: 2, createdAt: -2, hash: 'hash-b' },
    ]));

    expect(result.maxCreatedAt).toBe(-1);
  });

  it('analyzes a database history larger than the runtime argument limit', () => {
    // Repeated rows keep the fixture small while reproducing a large table.
    // Put its maximum first so the final row cannot stand in for the maximum.
    const rowCount = 250_000;
    const rows = Array.from({ length: rowCount }, (_, index) => ({
      id: index + 1,
      createdAt: index === 0 ? 2000 : 1000,
      hash: index === 0 ? 'hash-b' : 'hash-a',
    }));
    const result = analyzeDatabaseState([
      local(0, 1000, '0000_first', 'hash-a'),
      local(1, 1500, '0001_skipped', 'hash-c'),
      local(2, 2000, '0002_applied', 'hash-b'),
      local(3, 3000, '0003_pending', 'hash-d'),
    ], database(rows));

    expect(result.maxCreatedAt).toBe(2000);
    expect(result.summary).toEqual({
      local: 4,
      database: rowCount,
      applied: 2,
      pending: 1,
      skippedHazards: 1,
      hashMismatches: 0,
      databaseOnly: 0,
    });
    expect(result.findings.map(({ code, severity }) => ({ code, severity }))).toEqual([
      { code: 'DATABASE_DUPLICATE_TIMESTAMP', severity: 'error' },
      { code: 'WOULD_BE_SKIPPED_BY_DRIZZLE', severity: 'error' },
    ]);
    expect(result.findings[1]?.details).toEqual({
      tag: '0001_skipped',
      migrationCreatedAt: 1500,
      databaseHighWatermark: 2000,
    });
  });

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

describe('database row ambiguity (P1.1)', () => {
  it('duplicate timestamp with one matching local hash is applied with a duplicate-timestamp error', () => {
    const result = analyzeDatabaseState(
      [local(0, 1000, '0000_first', 'hash-a')],
      database([
        { id: 1, createdAt: 1000, hash: 'hash-a' },
        { id: 2, createdAt: 1000, hash: 'hash-b' },
      ]),
    );

    expect(result.summary.applied).toBe(1);
    expect(result.summary.databaseOnly).toBe(0);
    expect(result.summary.hashMismatches).toBe(0);
    expect(result.findings.some((item) => item.code === 'DATABASE_DUPLICATE_TIMESTAMP')).toBe(true);
    expect(result.findings.some((item) => item.code === 'DATABASE_TIMESTAMP_MISMATCH')).toBe(false);
    expect(result.findings.some((item) => item.code === 'DATABASE_MIGRATION_NOT_IN_REPO')).toBe(false);
  });

  it('duplicate timestamp with no matching local hash is a hash mismatch, not applied', () => {
    const result = analyzeDatabaseState(
      [local(0, 1000, '0000_first', 'hash-a')],
      database([
        { id: 1, createdAt: 1000, hash: 'hash-x' },
        { id: 2, createdAt: 1000, hash: 'hash-y' },
      ]),
    );

    expect(result.summary.applied).toBe(0);
    expect(result.summary.hashMismatches).toBe(1);
    expect(result.findings.some((item) => item.code === 'DATABASE_DUPLICATE_TIMESTAMP')).toBe(true);
    expect(result.findings.some((item) => item.code === 'MIGRATION_HASH_MISMATCH')).toBe(true);
  });

  it('multiple database-only rows each produce a NOT_IN_REPO finding and raise the high-watermark', () => {
    const result = analyzeDatabaseState(
      [local(0, 1000, '0000_first', 'hash-a')],
      database([
        { id: 1, createdAt: 1500, hash: 'hash-x' },
        { id: 2, createdAt: 2000, hash: 'hash-y' },
      ]),
    );

    expect(result.summary.databaseOnly).toBe(2);
    expect(result.summary.skippedHazards).toBe(1);
    expect(result.findings.filter((item) => item.code === 'DATABASE_MIGRATION_NOT_IN_REPO')).toHaveLength(2);
    // The local migration sits behind the database-only high-watermark.
    expect(result.findings.some((item) => item.code === 'WOULD_BE_SKIPPED_BY_DRIZZLE')).toBe(true);
  });

  it('a hash match at a different timestamp is a timestamp mismatch and a skip hazard', () => {
    const result = analyzeDatabaseState(
      [local(0, 1000, '0000_first', 'hash-a')],
      database([{ id: 1, createdAt: 1500, hash: 'hash-a' }]),
    );

    expect(result.summary.databaseOnly).toBe(1);
    expect(result.summary.skippedHazards).toBe(1);
    expect(result.findings.some((item) => item.code === 'DATABASE_TIMESTAMP_MISMATCH')).toBe(true);
    expect(result.findings.some((item) => item.code === 'WOULD_BE_SKIPPED_BY_DRIZZLE')).toBe(true);
  });

  it('database rows returned out of order produce identical results', () => {
    const migrations = [
      local(0, 1000, '0000_first', 'hash-a'),
      local(1, 2000, '0001_second', 'hash-b'),
    ];
    const ascending = database([
      { id: 1, createdAt: 1000, hash: 'hash-a' },
      { id: 2, createdAt: 2000, hash: 'hash-b' },
    ]);
    const descending = database([
      { id: 2, createdAt: 2000, hash: 'hash-b' },
      { id: 1, createdAt: 1000, hash: 'hash-a' },
    ]);

    const a = analyzeDatabaseState(migrations, ascending);
    const d = analyzeDatabaseState(migrations, descending);

    expect(d.summary).toEqual(a.summary);
    expect(d.maxCreatedAt).toBe(a.maxCreatedAt);
    expect(d.findings.map((item) => item.code)).toEqual(a.findings.map((item) => item.code));
  });
});
