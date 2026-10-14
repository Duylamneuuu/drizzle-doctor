// Hash compatibility research (R3): compare file-content variants with the
// real, exactly pinned upstream reader, without executing migration SQL.
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readMigrationFiles } from 'drizzle-orm/migrator';
import { afterEach, describe, expect, it } from 'vitest';

import { inspectMigrationRepository } from '../src/repository.js';

const tempDirs: string[] = [];
const sql = 'select 1;\n--> statement-breakpoint\nselect 2;';
const variants = [
  { name: 'LF without a final newline', bytes: Buffer.from(sql) },
  { name: 'LF with a final newline', bytes: Buffer.from(`${sql}\n`) },
  { name: 'CRLF without a final newline', bytes: Buffer.from(sql.replaceAll('\n', '\r\n')) },
  { name: 'CRLF with a final newline', bytes: Buffer.from(`${sql.replaceAll('\n', '\r\n')}\r\n`) },
  { name: 'UTF-8 BOM', bytes: Buffer.from(`\uFEFF${sql}`) },
  { name: 'non-ASCII UTF-8', bytes: Buffer.from("select '雪 ☃ 🩺';\n") },
  { name: 'empty file', bytes: Buffer.alloc(0) },
  { name: 'malformed UTF-8', bytes: Buffer.from([0x73, 0x65, 0x6c, 0x65, 0x63, 0x74, 0x20, 0xff, 0x3b]) },
];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('upstream SQL text hashing (drizzle-orm 0.45.4)', () => {
  it.each(variants)('matches upstream for $name', async ({ bytes, name }) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'drizzle-doctor-hash-'));
    tempDirs.push(dir);
    await mkdir(path.join(dir, 'meta'));
    await writeFile(path.join(dir, 'meta', '_journal.json'), JSON.stringify({
      entries: [{ idx: 0, when: 1000, tag: '0000_hash', breakpoints: true }],
    }));
    await writeFile(path.join(dir, '0000_hash.sql'), bytes);

    // Upstream decodes with Buffer.toString() before hashing. In particular,
    // invalid UTF-8 is replaced, while BOMs and line endings are retained.
    const expected = createHash('sha256').update(bytes.toString('utf8')).digest('hex');
    const upstream = readMigrationFiles({ migrationsFolder: dir });
    const ours = await inspectMigrationRepository(dir);

    expect(ours.findings).toEqual([]);
    expect(ours.migrations).toHaveLength(1);
    expect(upstream).toHaveLength(1);
    expect(ours.migrations[0]?.hash).toBe(upstream[0]?.hash);
    expect(upstream[0]?.hash).toBe(expected);
    expect(ours.migrations[0]?.when).toBe(upstream[0]?.folderMillis);

    if (name === 'malformed UTF-8') {
      expect(expected).not.toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });
});
