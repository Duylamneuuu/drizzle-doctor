import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { quoteIdentifier, readPostgresMigrationState } from '../src/postgres.js';
import { replayMigrations } from '../src/replay.js';
import type { LocalMigration } from '../src/types.js';

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
const schema = 'drizzle_doctor_rls';
const role = 'drizzle_doctor_rls_owner';
const table = '__drizzle_migrations';
const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

suite('migration histories protected by row-level security', () => {
  let admin: Client;
  let roleUrl: string;
  let database: string;
  let tempDir: string;
  let migration: LocalMigration;

  beforeAll(async () => {
    admin = new Client({ connectionString });
    await admin.connect();
    await admin.query(`create role ${quoteIdentifier(role)} nologin`);
    const result = await admin.query<{ name: string }>('select current_database() as name');
    database = result.rows[0]!.name;
    await admin.query(`grant create on database ${quoteIdentifier(database)} to ${quoteIdentifier(role)}`);
    const url = new URL(connectionString!);
    // Use the test administrator's connection, but inspect/replay as a role
    // without superuser or BYPASSRLS privileges. No password fixture needed.
    url.searchParams.set('options', `${url.searchParams.get('options') ?? ''} -c role=${role}`.trim());
    roleUrl = url.toString();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'drizzle-doctor-rls-'));
    const sql = `select nextval('"${schema}"."replay_side_effect"');`;
    const sqlPath = path.join(tempDir, '0000_probe.sql');
    await writeFile(sqlPath, sql);
    migration = {
      idx: 0, tag: '0000_probe', when: 2000, breakpoints: true, sqlPath,
      hash: createHash('sha256').update(sql).digest('hex'),
    };
  });

  beforeEach(async () => {
    await admin.query(`drop schema if exists ${quoteIdentifier(schema)} cascade`);
    await admin.query(`create schema ${quoteIdentifier(schema)} authorization ${quoteIdentifier(role)}`);
    await admin.query(`create table ${qualified} (id serial primary key, hash text not null, created_at bigint)`);
    await admin.query(`alter table ${qualified} owner to ${quoteIdentifier(role)}`);
    await admin.query(`insert into ${qualified} (hash, created_at) values ('existing-hash', 1000)`);
    await admin.query(`alter table ${qualified} enable row level security`);
    await admin.query(`alter table ${qualified} force row level security`);
    // SELECT/count sees no rows, while bookkeeping INSERT would succeed.
    await admin.query(`create policy hide_history on ${qualified} using (false) with check (true)`);
    await admin.query(`create sequence "${schema}"."replay_side_effect"`);
    await admin.query(`alter sequence "${schema}"."replay_side_effect" owner to ${quoteIdentifier(role)}`);
  });

  afterAll(async () => {
    try {
      await admin.query(`drop schema if exists ${quoteIdentifier(schema)} cascade`);
      if (database) await admin.query(`revoke create on database ${quoteIdentifier(database)} from ${quoteIdentifier(role)}`);
      await admin.query(`drop role if exists ${quoteIdentifier(role)}`);
    } finally {
      await admin.end();
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('refuses an incomplete status snapshot instead of reporting an empty history', async () => {
    await expect(readPostgresMigrationState({ connectionString: roleUrl, schema, table }))
      .rejects.toThrow(/row.level security/i);
  });

  it.each([false, true])('refuses a filtered replay target before executing SQL (empty: %s)', async (empty) => {
    if (empty) await admin.query(`delete from ${qualified}`);
    await expect(replayMigrations({ connectionString: roleUrl, schema, table, migrations: [migration] }))
      .rejects.toThrow(/row.level security/i);
    // Sequence advancement survives rollback, making this a guard against
    // migration execution rather than only against committed SQL effects.
    const sequence = await admin.query(`select is_called from "${schema}"."replay_side_effect"`);
    expect(sequence.rows[0].is_called).toBe(false);
    const rows = await admin.query(`select count(*)::int as n from ${qualified}`);
    expect(rows.rows[0].n).toBe(empty ? 0 : 1);
  });

  it('allows an unfiltered owner snapshot and still blocks replay of populated history', async () => {
    await admin.query(`alter table ${qualified} no force row level security`);
    const snapshot = await readPostgresMigrationState({ connectionString: roleUrl, schema, table });
    expect(snapshot.rows).toEqual([{ id: 1, hash: 'existing-hash', createdAt: 1000 }]);
    const replay = await replayMigrations({ connectionString: roleUrl, schema, table, migrations: [migration] });
    expect(replay.blocked).toBe('TARGET_NOT_EMPTY');
    expect(replay.applied).toBe(0);
  });
});
