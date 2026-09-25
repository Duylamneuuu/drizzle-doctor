// P1.6 — large-history behavior guard. A synthetic journal of 2000
// migrations must inspect successfully with no findings and without
// pathological runtime growth (docs/IMPROVEMENTS.md P1.6).
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { inspectMigrationRepository } from '../src/repository.js';

const MIGRATION_COUNT = 2000;
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('large migration history (P1.6)', () => {
  it('inspects 2000 migrations with no findings and no quadratic blowup', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'drizzle-doctor-'));
    tempDirs.push(root);
    const migrationsDir = path.join(root, 'drizzle');
    await mkdir(path.join(migrationsDir, 'meta'), { recursive: true });

    const entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }> = [];
    await Promise.all(
      Array.from({ length: MIGRATION_COUNT }, async (_, i) => {
        const tag = `${String(i).padStart(4, '0')}_migration`;
        entries.push({ idx: i, when: 1_710_000_000_000 + i * 1000, tag, breakpoints: false });
        await writeFile(path.join(migrationsDir, `${tag}.sql`), `-- migration ${i}\ncreate table t${i}(id integer);\n`);
      }),
    );
    await writeFile(
      path.join(migrationsDir, 'meta', '_journal.json'),
      JSON.stringify({ entries }, null, 2),
    );

    const started = Date.now();
    const result = await inspectMigrationRepository(migrationsDir);
    const elapsedMs = Date.now() - started;

    expect(result.findings).toEqual([]);
    expect(result.migrations).toHaveLength(MIGRATION_COUNT);
    expect(result.migrations[0]?.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.migrations[MIGRATION_COUNT - 1]?.tag).toBe(`${String(MIGRATION_COUNT - 1).padStart(4, '0')}_migration`);
    // Generous linear-time guard: a pathological quadratic implementation
    // would exceed this by orders of magnitude, while a correct one finishes
    // in well under a second locally. Deliberately loose for slow CI runners.
    expect(elapsedMs).toBeLessThan(30_000);
  });
});
