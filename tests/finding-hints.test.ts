// P1.2 regression guard: every finding the tool emits carries an actionable
// `hint` (what to inspect next), and the missing-table hint states the
// documented limitation (P1.4) that a missing migration table does not prove
// the database itself is empty. Hint *contents* stay provisional per
// docs/OUTPUT_CONTRACT.md — these tests pin presence and the safety caveat,
// not exact wording.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { analyzeDatabaseState } from '../src/analyze.js';
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

function assertHintsPresent(codes: string[], findings: { code: string; hint?: string }[]): void {
  for (const code of codes) {
    const finding = findings.find((item) => item.code === code);
    expect(finding, `expected finding ${code}`).toBeDefined();
    expect(typeof finding!.hint).toBe('string');
    expect(finding!.hint!.length).toBeGreaterThan(0);
  }
}

describe('finding hints (P1.2)', () => {
  it('repository findings carry hints', async () => {
    const shapeRoot = await mkdtemp(path.join(os.tmpdir(), 'drizzle-doctor-'));
    tempDirs.push(shapeRoot);
    const shapeDir = path.join(shapeRoot, 'drizzle');
    await mkdir(path.join(shapeDir, 'meta'), { recursive: true });
    await writeFile(path.join(shapeDir, 'meta', '_journal.json'), JSON.stringify({ entries: 'not-an-array' }));
    const invalidShapeResult = await inspectMigrationRepository(shapeDir);
    assertHintsPresent(['REPO_JOURNAL_INVALID_SHAPE'], invalidShapeResult.findings);

    const duplicates = await fixture(
      [
        { idx: 0, when: 1000, tag: '0000_same', breakpoints: true },
        { idx: 0, when: 2000, tag: '0000_same', breakpoints: true },
      ],
      { '0000_same.sql': 'select 1;' },
    );
    const duplicatesResult = await inspectMigrationRepository(duplicates);
    assertHintsPresent(['JOURNAL_DUPLICATE_INDEX', 'JOURNAL_DUPLICATE_TAG'], duplicatesResult.findings);

    // Every finding in a mixed repository scenario carries a hint.
    for (const finding of duplicatesResult.findings) {
      expect(typeof finding.hint, finding.code).toBe('string');
    }
  });

  it('analyzer findings carry hints', () => {
    const local = [{ idx: 0, when: 1000, tag: '0000_first', breakpoints: true, sqlPath: '/tmp/0000_first.sql', hash: 'hash-a' }];
    const missing = analyzeDatabaseState(local, {
      schema: 'drizzle',
      table: '__drizzle_migrations',
      tableExists: false,
      rows: [],
    });
    assertHintsPresent(['DATABASE_MIGRATIONS_TABLE_MISSING'], missing.findings);

    const mismatch = analyzeDatabaseState(local, {
      schema: 'drizzle',
      table: '__drizzle_migrations',
      tableExists: true,
      rows: [{ id: 1, createdAt: 1000, hash: 'hash-b' }],
    });
    assertHintsPresent(['MIGRATION_HASH_MISMATCH'], mismatch.findings);

    const skipped = analyzeDatabaseState(
      [...local, { idx: 1, when: 500, tag: '0001_old', breakpoints: true, sqlPath: '/tmp/0001_old.sql', hash: 'hash-old' }],
      {
        schema: 'drizzle',
        table: '__drizzle_migrations',
        tableExists: true,
        rows: [{ id: 1, createdAt: 1000, hash: 'hash-a' }],
      },
    );
    assertHintsPresent(['WOULD_BE_SKIPPED_BY_DRIZZLE'], skipped.findings);
    for (const finding of skipped.findings) {
      expect(typeof finding.hint, finding.code).toBe('string');
    }
  });

  it('the missing-table hint states the P1.4 limitation', () => {
    const result = analyzeDatabaseState(
      [{ idx: 0, when: 1000, tag: '0000_first', breakpoints: true, sqlPath: '/tmp/0000_first.sql', hash: 'hash-a' }],
      { schema: 'drizzle', table: '__drizzle_migrations', tableExists: false, rows: [] },
    );
    const finding = result.findings.find((item) => item.code === 'DATABASE_MIGRATIONS_TABLE_MISSING');
    expect(finding?.hint).toContain('does not prove the database itself is empty');
  });
});
