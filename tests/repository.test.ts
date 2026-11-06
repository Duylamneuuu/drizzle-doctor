import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { inspectMigrationRepository } from '../src/repository.js';
import { hasErrors } from '../src/types.js';

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

  it('reports an unreadable journal as REPO_JOURNAL_UNREADABLE, not as invalid JSON', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'drizzle-doctor-'));
    tempDirs.push(root);
    const migrationsDir = path.join(root, 'drizzle');
    await mkdir(path.join(migrationsDir, 'meta'), { recursive: true });
    // A directory in place of the journal file makes readFile throw
    // deterministically (EISDIR) without depending on process permissions.
    await mkdir(path.join(migrationsDir, 'meta', '_journal.json'));

    const result = await inspectMigrationRepository(migrationsDir);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.code).toBe('REPO_JOURNAL_UNREADABLE');
    expect(result.findings[0]?.severity).toBe('error');
    expect(result.findings.some((item) => item.code === 'REPO_JOURNAL_INVALID_JSON')).toBe(false);
    expect(hasErrors(result.findings)).toBe(true);
  });

  it('reports a referenced SQL file that exists but cannot be read', async () => {
    const migrationsDir = await fixture(
      [{ idx: 0, when: 1000, tag: '0000_dir', breakpoints: true }],
      {},
    );
    // A directory in place of the SQL file makes readFile throw
    // deterministically (EISDIR) without depending on process permissions.
    await mkdir(path.join(migrationsDir, '0000_dir.sql'));

    const result = await inspectMigrationRepository(migrationsDir);

    expect(result.migrations).toEqual([]);
    expect(result.findings.some((item) => item.code === 'MIGRATION_SQL_UNREADABLE')).toBe(true);
    expect(hasErrors(result.findings)).toBe(true);
  });

  it.skipIf(process.platform === 'win32').each([
    { file: '0000_fifo.sql', code: 'MIGRATION_SQL_UNREADABLE' },
    { file: 'meta/_journal.json', code: 'REPO_JOURNAL_UNREADABLE' },
  ])('rejects $file as a FIFO without hanging', async ({ file, code }) => {
    const migrationsDir = await fixture(
      [{ idx: 0, when: 1000, tag: '0000_fifo', breakpoints: true }],
      {},
    );
    const fifoPath = path.join(migrationsDir, file);
    await rm(fifoPath, { force: true });
    execFileSync('mkfifo', [fifoPath]);

    // Bound the regression check so a blocking file open cannot hang Vitest.
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '--eval',
        `import { inspectMigrationRepository } from ${JSON.stringify(path.resolve('src/repository.ts'))}; const result = await inspectMigrationRepository(${JSON.stringify(migrationsDir)}); console.log(JSON.stringify(result.findings.map((finding) => finding.code)));`,
      ],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 3000 },
    );

    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout.trim())).toContain(code);
  });

  it('rejects migration tags that escape the migrations directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'drizzle-doctor-'));
    tempDirs.push(root);
    const migrationsDir = path.join(root, 'drizzle');
    await mkdir(path.join(migrationsDir, 'meta'), { recursive: true });
    await writeFile(
      path.join(migrationsDir, 'meta', '_journal.json'),
      JSON.stringify({
        entries: [
          { idx: 0, when: 1000, tag: '../outside', breakpoints: true },
          { idx: 1, when: 2000, tag: '..\\outside', breakpoints: true },
        ],
      }),
    );
    // Before the guard, the journal entry above resolved to this file and
    // the audit accepted/hashed content outside the migration repository.
    await writeFile(path.join(root, 'outside.sql'), 'select secret_from_outside;');

    const result = await inspectMigrationRepository(migrationsDir);

    expect(result.migrations).toEqual([]);
    expect(result.findings.map((finding) => finding.code)).toEqual([
      'JOURNAL_ENTRY_INVALID',
      'JOURNAL_ENTRY_INVALID',
    ]);
  });

  it('rejects a SQL symlink that resolves outside the migrations directory', async () => {
    const migrationsDir = await fixture(
      [{ idx: 0, when: 1000, tag: '0000_link', breakpoints: true }],
      {},
    );
    // A sibling with the same directory-name prefix must not count as contained.
    const outsideDir = `${migrationsDir}-outside`;
    await mkdir(outsideDir);
    await writeFile(path.join(outsideDir, 'outside.sql'), 'select 1;');
    await symlink(path.join(outsideDir, 'outside.sql'), path.join(migrationsDir, '0000_link.sql'));

    const result = await inspectMigrationRepository(migrationsDir);

    expect(result.migrations).toEqual([]);
    expect(result.findings.map((item) => item.code)).toEqual(['MIGRATION_SQL_UNREADABLE']);
    expect(hasErrors(result.findings)).toBe(true);
  });

  it('rejects a journal reached through an out-of-directory meta symlink', async () => {
    const migrationsDir = await fixture([], {});
    const outsideMeta = path.join(path.dirname(migrationsDir), 'outside-meta');
    await mkdir(outsideMeta);
    await writeFile(path.join(outsideMeta, '_journal.json'), JSON.stringify({ entries: [] }));
    await rm(path.join(migrationsDir, 'meta'), { recursive: true });
    await symlink(outsideMeta, path.join(migrationsDir, 'meta'), 'dir');

    const result = await inspectMigrationRepository(migrationsDir);

    expect(result.migrations).toEqual([]);
    expect(result.findings.map((item) => item.code)).toEqual(['REPO_JOURNAL_UNREADABLE']);
    expect(hasErrors(result.findings)).toBe(true);
  });

  it('accepts SQL symlinks whose targets stay inside the migrations directory', async () => {
    const sql = 'select 1;';
    const migrationsDir = await fixture(
      [{ idx: 0, when: 1000, tag: '0000_link', breakpoints: true }],
      {},
    );
    await mkdir(path.join(migrationsDir, 'shared'));
    await writeFile(path.join(migrationsDir, 'shared', 'source.sql'), sql);
    await symlink(path.join('shared', 'source.sql'), path.join(migrationsDir, '0000_link.sql'));

    const result = await inspectMigrationRepository(migrationsDir);

    expect(result.findings).toEqual([]);
    expect(result.migrations[0]?.hash).toBe(createHash('sha256').update(sql).digest('hex'));
  });

  it('accepts a symlink supplied as the migrations directory', async () => {
    const migrationsDir = await fixture(
      [{ idx: 0, when: 1000, tag: '0000_first', breakpoints: true }],
      { '0000_first.sql': 'select 1;' },
    );
    const linkedDir = path.join(path.dirname(migrationsDir), 'linked-drizzle');
    await symlink(migrationsDir, linkedDir, 'dir');

    const result = await inspectMigrationRepository(linkedDir);

    expect(result.findings).toEqual([]);
    expect(result.migrations).toHaveLength(1);
  });

  it('uses original journal positions for index-sequence findings after an invalid entry', async () => {
    const migrationsDir = await fixture(
      [
        { idx: 0, when: 1000, tag: '../invalid', breakpoints: true },
        { idx: 1, when: 2000, tag: '0001_valid', breakpoints: true },
      ],
      { '0001_valid.sql': 'select 1;' },
    );

    const result = await inspectMigrationRepository(migrationsDir);

    expect(result.migrations.map((migration) => migration.tag)).toEqual(['0001_valid']);
    expect(result.findings.map((finding) => finding.code)).toEqual(['JOURNAL_ENTRY_INVALID']);
  });
});
