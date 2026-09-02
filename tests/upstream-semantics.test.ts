// M1.2 — semantics equivalence against the pinned upstream drizzle-orm
// release. This suite protects the project's two critical assumptions:
//
//   1. migration hash = sha256 of the SQL file contents, read as utf8
//   2. Drizzle applies a migration only when `folderMillis` is strictly
//      newer than the latest recorded created_at (high-watermark)
//
// The version under test is pinned exactly in package.json so an upstream
// change cannot silently move this suite; when upgrading drizzle-orm, update
// the compatibility notes in docs/COMPATIBILITY.md in the same change.
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readMigrationFiles } from 'drizzle-orm/migrator';
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

describe('upstream hash equivalence (drizzle-orm 0.45.2)', () => {
  it('produces the same sha256 hashes and timestamps as readMigrationFiles', async () => {
    const dir = await fixture(
      [
        { version: '7', dialect: 'postgresql', idx: 0, when: 1_710_000_000_000, tag: '0000_first', breakpoints: true },
        { version: '7', dialect: 'postgresql', idx: 1, when: 1_710_000_010_000, tag: '0001_second', breakpoints: true },
        { version: '7', dialect: 'postgresql', idx: 2, when: 1_710_000_020_000, tag: '0002_third', breakpoints: false },
      ],
      {
        '0000_first.sql': 'create table users(id serial primary key, email text);\n--> statement-breakpoint\ncreate index users_email_idx on users(email);',
        '0001_second.sql': 'alter table users add column name text;',
        '0002_third.sql': "insert into users (email, name) values ('a@b.c', 'snowman \\u2603');",
      },
    );

    const upstream = readMigrationFiles({ migrationsFolder: dir });
    const ours = (await inspectMigrationRepository(dir)).migrations;

    expect(upstream).toHaveLength(3);
    expect(ours).toHaveLength(3);
    for (let index = 0; index < 3; index++) {
      expect(ours[index]?.hash).toBe(upstream[index]?.hash);
      expect(ours[index]?.when).toBe(upstream[index]?.folderMillis);
    }
  });

  it('hashes exactly the raw file bytes, including breakpoint markers and final newlines', async () => {
    const sql = 'select 1;\n--> statement-breakpoint\nselect 2;\n';
    const dir = await fixture([{ idx: 0, when: 1000, tag: '0000_x', breakpoints: true }], {
      '0000_x.sql': sql,
    });

    const expected = createHash('sha256').update(sql).digest('hex');
    const ours = await inspectMigrationRepository(dir);
    const upstream = readMigrationFiles({ migrationsFolder: dir });

    expect(ours.migrations[0]?.hash).toBe(expected);
    expect(upstream[0]?.hash).toBe(expected);
  });
});
