import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { inspectMigrationRepository } from '../src/repository.js';

const tempDirs: string[] = [];

async function fixture(entries: unknown[], sqlFiles: Record<string, string>): Promise<string> {
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

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('inspectMigrationRepository', () => {
  it('accepts a healthy Drizzle journal and computes hashes', async () => {
    const migrationsDir = await fixture(
      [
        { idx: 0, when: 1000, tag: '0000_first', breakpoints: true },
        { idx: 1, when: 2000, tag: '0001_second', breakpoints: true },
      ],
      {
        '0000_first.sql': 'create table first(id integer);',
        '0001_second.sql': 'alter table first add column name text;',
      },
    );

    const result = await inspectMigrationRepository(migrationsDir);

    expect(result.findings).toEqual([]);
    expect(result.migrations).toHaveLength(2);
    expect(result.migrations[0]?.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reports a migration referenced by the journal when its SQL file is missing', async () => {
    const migrationsDir = await fixture(
      [{ idx: 0, when: 1000, tag: '0000_missing', breakpoints: true }],
      {},
    );

    const result = await inspectMigrationRepository(migrationsDir);

    expect(result.findings.some((item) => item.code === 'MIGRATION_SQL_MISSING')).toBe(true);
  });

  it('flags non-increasing timestamps because they can fall behind the database high-watermark', async () => {
    const migrationsDir = await fixture(
      [
        { idx: 0, when: 2000, tag: '0000_newer', breakpoints: true },
        { idx: 1, when: 1500, tag: '0001_older', breakpoints: true },
      ],
      {
        '0000_newer.sql': 'select 1;',
        '0001_older.sql': 'select 2;',
      },
    );

    const result = await inspectMigrationRepository(migrationsDir);

    expect(result.findings.some((item) => item.code === 'JOURNAL_TIMESTAMP_ORDER')).toBe(true);
  });

  it('warns about SQL files that are not referenced by the journal', async () => {
    const migrationsDir = await fixture(
      [{ idx: 0, when: 1000, tag: '0000_first', breakpoints: true }],
      {
        '0000_first.sql': 'select 1;',
        '9999_orphan.sql': 'select 2;',
      },
    );

    const result = await inspectMigrationRepository(migrationsDir);

    expect(result.orphanSqlFiles).toEqual(['9999_orphan.sql']);
    expect(result.findings.some((item) => item.code === 'ORPHAN_SQL_FILE')).toBe(true);
  });
});
