// M1.1 synthetic fixture suite — one named fixture for every state class in
// docs/MILESTONES.md M1.1. Each case asserts the exact finding codes and
// severities, summary counters, and the report-level `ok` flag (exit 0/1).
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { analyzeDatabaseState } from '../src/analyze.js';
import { inspectMigrationRepository } from '../src/repository.js';
import { createStatusReport } from '../src/report.js';
import { hasErrors } from '../src/types.js';
import type { DatabaseSnapshot, LocalMigration } from '../src/types.js';

const tempDirs: string[] = [];

async function repoFixture(entries: unknown[], sqlFiles: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drizzle-doctor-'));
  tempDirs.push(root);
  const migrationsDir = path.join(root, 'drizzle');
  await mkdir(path.join(migrationsDir, 'meta'), { recursive: true });
  await writeFile(path.join(migrationsDir, 'meta', '_journal.json'), JSON.stringify({ entries }, null, 2));
  for (const [file, contents] of Object.entries(sqlFiles)) {
    await writeFile(path.join(migrationsDir, file), contents);
  }
  return migrationsDir;
}

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

function codes(findings: { code: string }[]): string[] {
  return findings.map((finding) => finding.code).sort();
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('M1.1 repository fixtures', () => {
  it('1. empty/new project: journal with no entries is clean', async () => {
    const dir = await repoFixture([], {});
    const result = await inspectMigrationRepository(dir);

    expect(result.findings).toEqual([]);
    expect(result.migrations).toEqual([]);
    expect(hasErrors(result.findings)).toBe(false);
  });

  it('1b. empty/new project: missing journal is an error', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'drizzle-doctor-'));
    tempDirs.push(root);
    const result = await inspectMigrationRepository(root);

    expect(codes(result.findings)).toEqual(['REPO_JOURNAL_MISSING']);
    expect(result.findings[0]?.severity).toBe('error');
    expect(hasErrors(result.findings)).toBe(true);
  });

  it('8. journal entry referencing a missing SQL file', async () => {
    const dir = await repoFixture([{ idx: 0, when: 1000, tag: '0000_missing', breakpoints: true }], {});
    const result = await inspectMigrationRepository(dir);

    expect(result.migrations).toEqual([]);
    expect(codes(result.findings)).toEqual(['MIGRATION_SQL_MISSING']);
    expect(result.findings[0]?.severity).toBe('error');
    expect(hasErrors(result.findings)).toBe(true);
  });

  it('9. orphan SQL file is a warning; repository still passes', async () => {
    const dir = await repoFixture(
      [{ idx: 0, when: 1000, tag: '0000_first', breakpoints: true }],
      { '0000_first.sql': 'select 1;', '9999_orphan.sql': 'select 2;' },
    );
    const result = await inspectMigrationRepository(dir);

    expect(result.orphanSqlFiles).toEqual(['9999_orphan.sql']);
    expect(codes(result.findings)).toEqual(['ORPHAN_SQL_FILE']);
    expect(result.findings[0]?.severity).toBe('warning');
    expect(hasErrors(result.findings)).toBe(false);
  });

  it('10. duplicate journal index is an error', async () => {
    const dir = await repoFixture(
      [
        { idx: 0, when: 1000, tag: '0000_first', breakpoints: true },
        { idx: 0, when: 2000, tag: '0001_second', breakpoints: true },
      ],
      { '0000_first.sql': 'select 1;', '0001_second.sql': 'select 2;' },
    );
    const result = await inspectMigrationRepository(dir);

    // The second position also deviates from the contiguous sequence.
    expect(codes(result.findings)).toEqual(['JOURNAL_DUPLICATE_INDEX', 'JOURNAL_INDEX_SEQUENCE']);
    expect(result.findings.find((f) => f.code === 'JOURNAL_DUPLICATE_INDEX')?.severity).toBe('error');
    expect(hasErrors(result.findings)).toBe(true);
  });

  it('11. duplicate journal tag is an error', async () => {
    const dir = await repoFixture(
      [
        { idx: 0, when: 1000, tag: '0000_same', breakpoints: true },
        { idx: 1, when: 2000, tag: '0000_same', breakpoints: true },
      ],
      { '0000_same.sql': 'select 1;' },
    );
    const result = await inspectMigrationRepository(dir);

    expect(codes(result.findings)).toEqual(['JOURNAL_DUPLICATE_TAG']);
    expect(result.findings[0]?.severity).toBe('error');
    expect(hasErrors(result.findings)).toBe(true);
  });

  it('12. duplicate journal timestamp is an error (and implies non-increasing order)', async () => {
    const dir = await repoFixture(
      [
        { idx: 0, when: 1000, tag: '0000_first', breakpoints: true },
        { idx: 1, when: 1000, tag: '0001_second', breakpoints: true },
      ],
      { '0000_first.sql': 'select 1;', '0001_second.sql': 'select 2;' },
    );
    const result = await inspectMigrationRepository(dir);

    expect(codes(result.findings)).toEqual(['JOURNAL_DUPLICATE_TIMESTAMP', 'JOURNAL_TIMESTAMP_ORDER']);
    expect(result.findings.find((f) => f.code === 'JOURNAL_DUPLICATE_TIMESTAMP')?.severity).toBe('error');
    expect(hasErrors(result.findings)).toBe(true);
  });

  it('13. non-monotonic journal timestamps are an error', async () => {
    const dir = await repoFixture(
      [
        { idx: 0, when: 2000, tag: '0000_newer', breakpoints: true },
        { idx: 1, when: 1500, tag: '0001_older', breakpoints: true },
      ],
      { '0000_newer.sql': 'select 1;', '0001_older.sql': 'select 2;' },
    );
    const result = await inspectMigrationRepository(dir);

    expect(codes(result.findings)).toEqual(['JOURNAL_TIMESTAMP_ORDER']);
    expect(hasErrors(result.findings)).toBe(true);
  });

  it('15. SQL containing statement breakpoints hashes the full file and stays clean', async () => {
    const sql = 'create table a(id integer);\n--> statement-breakpoint\ncreate index a_idx on a(id);';
    const dir = await repoFixture(
      [
        { idx: 0, when: 1000, tag: '0000_first', breakpoints: true },
      ],
      { '0000_first.sql': sql },
    );
    const result = await inspectMigrationRepository(dir);

    expect(result.findings).toEqual([]);
    expect(result.migrations[0]?.hash).toBe(
      '2438bcdbe45a828cf25f59078e5890f2f2439c3602f28a0001a89834fcfd0997',
    );
  });

  it('malformed journal JSON and shape errors', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'drizzle-doctor-'));
    tempDirs.push(root);
    const meta = path.join(root, 'meta');
    await mkdir(meta);
    await writeFile(path.join(meta, '_journal.json'), '{ not json');
    const invalidJson = await inspectMigrationRepository(root);
    expect(codes(invalidJson.findings)).toEqual(['REPO_JOURNAL_INVALID_JSON']);
    expect(hasErrors(invalidJson.findings)).toBe(true);

    await writeFile(path.join(meta, '_journal.json'), JSON.stringify({ dial: 'postgresql' }));
    const invalidShape = await inspectMigrationRepository(root);
    expect(codes(invalidShape.findings)).toEqual(['REPO_JOURNAL_INVALID_SHAPE']);
    expect(hasErrors(invalidShape.findings)).toBe(true);

    await writeFile(
      path.join(meta, '_journal.json'),
      JSON.stringify({ entries: [{ idx: 0, when: 1000, tag: '0000_x' }] }),
    );
    const invalidEntry = await inspectMigrationRepository(root);
    expect(codes(invalidEntry.findings)).toEqual(['JOURNAL_ENTRY_INVALID']);
    expect(hasErrors(invalidEntry.findings)).toBe(true);
  });
});

describe('M1.1 database-state fixtures', () => {
  it('2. one clean applied migration', () => {
    const result = analyzeDatabaseState([local(0, 1000, '0000_first', 'hash-a')], database([{ id: 1, createdAt: 1000, hash: 'hash-a' }]));

    expect(result.findings).toEqual([]);
    expect(result.summary).toMatchObject({ local: 1, database: 1, applied: 1, pending: 0, skippedHazards: 0, hashMismatches: 0, databaseOnly: 0 });
    expect(hasErrors(result.findings)).toBe(false);
  });

  it('3. multiple clean applied migrations', () => {
    const migrations = [local(0, 1000, '0000_a', 'h-a'), local(1, 2000, '0001_b', 'h-b'), local(2, 3000, '0002_c', 'h-c')];
    const result = analyzeDatabaseState(
      migrations,
      database([
        { id: 1, createdAt: 1000, hash: 'h-a' },
        { id: 2, createdAt: 2000, hash: 'h-b' },
        { id: 3, createdAt: 3000, hash: 'h-c' },
      ]),
    );

    expect(result.findings).toEqual([]);
    expect(result.summary.applied).toBe(3);
    expect(result.summary.pending).toBe(0);
  });

  it('4. pending migration newer than the database high-watermark', () => {
    const result = analyzeDatabaseState(
      [local(0, 1000, '0000_first', 'h-a'), local(1, 2000, '0001_newer', 'h-b')],
      database([{ id: 1, createdAt: 1000, hash: 'h-a' }]),
    );

    expect(result.findings).toEqual([]);
    expect(result.summary).toMatchObject({ applied: 1, pending: 1, skippedHazards: 0 });
    expect(hasErrors(result.findings)).toBe(false);
  });

  it('5. migration missing from the DB at/below the high-watermark is a skip hazard', () => {
    const migrations = [
      local(0, 1000, '0000_first', 'h-a'),
      local(1, 1500, '0001_behind', 'h-behind'),
      local(2, 2000, '0002_latest', 'h-b'),
    ];
    const result = analyzeDatabaseState(
      migrations,
      database([
        { id: 1, createdAt: 1000, hash: 'h-a' },
        { id: 2, createdAt: 2000, hash: 'h-b' },
      ]),
    );

    expect(result.summary.skippedHazards).toBe(1);
    expect(codes(result.findings)).toEqual(['WOULD_BE_SKIPPED_BY_DRIZZLE']);
    expect(result.findings[0]?.severity).toBe('error');
    expect(result.findings[0]?.details?.databaseHighWatermark).toBe(2000);
    expect(hasErrors(result.findings)).toBe(true);
  });

  it('6. edited SQL for an already-applied migration is a hash mismatch', () => {
    const result = analyzeDatabaseState(
      [local(0, 1000, '0000_first', 'edited-hash')],
      database([{ id: 1, createdAt: 1000, hash: 'original-hash' }]),
    );

    expect(result.summary.hashMismatches).toBe(1);
    expect(codes(result.findings)).toEqual(['MIGRATION_HASH_MISMATCH']);
    expect(result.findings[0]?.severity).toBe('error');
    expect(hasErrors(result.findings)).toBe(true);
  });

  it('7. database-only history is an error', () => {
    const result = analyzeDatabaseState(
      [local(0, 1000, '0000_first', 'h-a')],
      database([
        { id: 1, createdAt: 1000, hash: 'h-a' },
        { id: 2, createdAt: 1500, hash: 'unknown-hash' },
      ]),
    );

    expect(result.summary.databaseOnly).toBe(1);
    expect(codes(result.findings)).toEqual(['DATABASE_MIGRATION_NOT_IN_REPO']);
    expect(hasErrors(result.findings)).toBe(true);
  });

  it('7b. database row whose hash belongs to another local timestamp', () => {
    const result = analyzeDatabaseState(
      [local(0, 1000, '0000_first', 'h-a')],
      database([{ id: 1, createdAt: 999, hash: 'h-a' }]),
    );

    expect(result.summary.databaseOnly).toBe(1);
    expect(codes(result.findings)).toEqual(['DATABASE_TIMESTAMP_MISMATCH']);
    expect(result.findings[0]?.severity).toBe('error');
    expect(hasErrors(result.findings)).toBe(true);
  });

  it('12b. duplicate database timestamps are an error, even when one hash matches', () => {
    const result = analyzeDatabaseState(
      [local(0, 1000, '0000_first', 'h-a')],
      database([
        { id: 1, createdAt: 1000, hash: 'h-a' },
        { id: 2, createdAt: 1000, hash: 'h-something-else' },
      ]),
    );

    expect(codes(result.findings)).toEqual(['DATABASE_DUPLICATE_TIMESTAMP']);
    expect(result.findings[0]?.severity).toBe('error');
    // The matching row is still counted as applied; ambiguity is reported separately.
    expect(result.summary.applied).toBe(1);
    expect(hasErrors(result.findings)).toBe(true);
  });

  it('14. missing migration table is informational; custom schema/table pass through', () => {
    const snapshot: DatabaseSnapshot = {
      schema: 'app_history',
      table: 'drizzle_log',
      tableExists: false,
      rows: [],
    };
    const result = analyzeDatabaseState([local(0, 1000, '0000_first', 'h-a')], snapshot);

    expect(codes(result.findings)).toEqual(['DATABASE_MIGRATIONS_TABLE_MISSING']);
    expect(result.findings[0]?.severity).toBe('info');
    expect(result.summary.pending).toBe(1);
    expect(hasErrors(result.findings)).toBe(false);

    const report = createStatusReport(
      { migrationsDir: '/tmp/drizzle', journalPath: '/tmp/drizzle/meta/_journal.json', migrations: [], orphanSqlFiles: [], findings: [] },
      snapshot,
      result,
    );
    expect(report.database).toMatchObject({ schema: 'app_history', table: 'drizzle_log', tableExists: false });
    expect(report.ok).toBe(true);
  });

  it('13b. non-monotonic local timestamps surface as DB-side skip hazards too', () => {
    const migrations = [
      local(0, 2000, '0000_newer', 'h-newer'),
      local(1, 1000, '0001_older', 'h-older'),
    ];
    const result = analyzeDatabaseState(
      migrations,
      database([
        { id: 1, createdAt: 2000, hash: 'h-newer' },
        { id: 2, createdAt: 3000, hash: 'h-later' },
      ]),
    );

    expect(result.summary.skippedHazards).toBe(1);
    expect(codes(result.findings)).toEqual([
      'DATABASE_MIGRATION_NOT_IN_REPO',
      'WOULD_BE_SKIPPED_BY_DRIZZLE',
    ]);
    expect(hasErrors(result.findings)).toBe(true);
  });
});
