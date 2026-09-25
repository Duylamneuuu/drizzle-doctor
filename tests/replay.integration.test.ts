// M3 end-to-end replay coverage against a real PostgreSQL database. The
// suite is skipped unless TEST_DATABASE_URL is set (CI's postgres-integration
// job, or a local disposable instance).
//
// Migration SQL executes verbatim with the session's default search_path,
// matching the upstream Drizzle migrator (see docs/COMPATIBILITY.md): only
// the Drizzle migration table is created in the configured schema, and any
// other objects land wherever the SQL points them. Fixtures therefore use
// schema-qualified object names (as drizzle-kit generates for custom
// schemas) so assertions are deterministic.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { readPostgresMigrationState } from '../src/postgres.js';
import { replayMigrations } from '../src/replay.js';
import { inspectMigrationRepository } from '../src/repository.js';

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
const schema = 'drizzle_doctor_replay';
// Unqualified test objects may land in public (verbatim execution); keep it
// clean between runs.
const leftoverPublicTables = ['accounts', 'items', 'custom_t', 'ok_table', 'broken_table', 'never_created', 'never_table', 'first_table', 'early'];

const tempDirs: string[] = [];

async function repoFixture(entries: unknown[], sqlFiles: Record<string, string>): Promise<{ dir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drizzle-doctor-replay-'));
  tempDirs.push(root);
  const migrationsDir = path.join(root, 'drizzle');
  await mkdir(path.join(migrationsDir, 'meta'), { recursive: true });
  await writeFile(path.join(migrationsDir, 'meta', '_journal.json'), JSON.stringify({ entries }, null, 2));
  for (const [file, contents] of Object.entries(sqlFiles)) {
    await writeFile(path.join(migrationsDir, file), contents);
  }
  return { dir: migrationsDir };
}

async function resetTarget(client: Client): Promise<void> {
  await client.query(`drop schema if exists "${schema}" cascade`);
  await client.query(`create schema if not exists "${schema}"`);
  for (const table of leftoverPublicTables) {
    await client.query(`drop table if exists public."${table}" cascade`);
  }
}

function migration(entries: Array<{ idx: number; when: number; tag: string }>, sql: Record<string, string>) {
  return repoFixture(
    entries.map((entry) => ({ ...entry, breakpoints: true })),
    sql,
  );
}

/** Qualification helper so fixture SQL matches drizzle-kit custom-schema output. */
function q(name: string): string {
  return `"${schema}"."${name}"`;
}

suite('replayMigrations', () => {
  let client: Client;

  beforeEach(async () => {
    client = new Client({ connectionString });
    await client.connect();
    await resetTarget(client);
  });

  afterAll(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    if (!connectionString) return;
    const cleanup = new Client({ connectionString });
    await cleanup.connect();
    try {
      await cleanup.query(`drop schema if exists "${schema}" cascade`);
      for (const table of leftoverPublicTables) {
        await cleanup.query(`drop table if exists public."${table}" cascade`);
      }
    } finally {
      await cleanup.end();
    }
  });

  it('replays a healthy multi-migration history and records Drizzle bookkeeping rows', async () => {
    const { dir } = await migration(
      [
        { idx: 0, when: 1000, tag: '0000_first' },
        { idx: 1, when: 2000, tag: '0001_second' },
      ],
      {
        '0000_first.sql': `create table ${q('accounts')}(id serial primary key, name text);`,
        '0001_second.sql': `insert into ${q('accounts')} (name) values ('alice');`,
      },
    );
    const inspection = await inspectMigrationRepository(dir);

    const result = await replayMigrations({
      connectionString: connectionString!,
      schema,
      table: '__drizzle_migrations',
      migrations: inspection.migrations,
    });

    expect(result).toEqual({ schema, table: '__drizzle_migrations', total: 2, applied: 2 });
    expect(inspection.findings).toEqual([]);

    // The replayed database matches the local history: same rows, same hashes.
    const snapshot = await readPostgresMigrationState({
      connectionString: connectionString!,
      schema,
      table: '__drizzle_migrations',
    });
    expect(snapshot.rows).toHaveLength(2);
    expect(snapshot.rows.map((row) => row.createdAt)).toEqual([1000, 2000]);
    expect(snapshot.rows.map((row) => row.hash)).toEqual(inspection.migrations.map((item) => item.hash));

    const accounts = await client.query(`select name from ${q('accounts')}`);
    expect(accounts.rows).toEqual([{ name: 'alice' }]);
  });

  it('supports custom migration schema and table names', async () => {
    const { dir } = await migration(
      [{ idx: 0, when: 1000, tag: '0000_first' }],
      { '0000_first.sql': `create table ${q('custom_t')}(id int);` },
    );
    const inspection = await inspectMigrationRepository(dir);

    const result = await replayMigrations({
      connectionString: connectionString!,
      schema,
      table: 'custom_migration_log',
      migrations: inspection.migrations,
    });

    expect(result.applied).toBe(1);
    const snapshot = await readPostgresMigrationState({
      connectionString: connectionString!,
      schema,
      table: 'custom_migration_log',
    });
    expect(snapshot.rows).toHaveLength(1);
  });

  it('respects journal order (a later migration may depend on an earlier one)', async () => {
    const { dir } = await migration(
      [
        { idx: 0, when: 1000, tag: '0000_create' },
        { idx: 1, when: 2000, tag: '0001_depend' },
      ],
      {
        '0000_create.sql': `create table ${q('items')}(id serial primary key, label text);`,
        '0001_depend.sql': `insert into ${q('items')} (label) values ('depends-on-create');`,
      },
    );
    const inspection = await inspectMigrationRepository(dir);

    const result = await replayMigrations({
      connectionString: connectionString!,
      schema,
      table: '__drizzle_migrations',
      migrations: inspection.migrations,
    });

    expect(result.applied).toBe(2);
  });

  it('splits statements on breakpoints and reports the failing statement index', async () => {
    const { dir } = await migration(
      [
        { idx: 0, when: 1000, tag: '0000_ok' },
        { idx: 1, when: 2000, tag: '0001_broken' },
      ],
      {
        '0000_ok.sql': `create table ${q('ok_table')}(id int);`,
        // chunk 1 succeeds, chunk 3 fails, chunk 4 must never run.
        '0001_broken.sql': [
          `create table ${q('broken_table')}(id int);`,
          '--> statement-breakpoint',
          `insert into ${q('broken_table')} values (1);`,
          '--> statement-breakpoint',
          `select * from ${q('missing_rel')};`,
          '--> statement-breakpoint',
          `create table ${q('never_created')}(id int);`,
        ].join('\n'),
      },
    );
    const inspection = await inspectMigrationRepository(dir);

    const result = await replayMigrations({
      connectionString: connectionString!,
      schema,
      table: '__drizzle_migrations',
      migrations: inspection.migrations,
    });

    expect(result.applied).toBe(1);
    expect(result.firstFailure).toMatchObject({
      tag: '0001_broken',
      statement: 3,
      statementCount: 4,
      code: '42P01', // undefined_table
    });

    // Migration 0000 committed (per-migration transaction); 0001 rolled back,
    // so the post-failure chunk never ran.
    const neverExists = await client.query(
      `select exists (select 1 from information_schema.tables where table_schema = $1 and table_name = $2)`,
      [schema, 'never_created'],
    );
    expect(neverExists.rows[0]?.exists).toBe(false);
  });

  it('rolls back the failing migration but keeps earlier committed migrations', async () => {
    const { dir } = await migration(
      [
        { idx: 0, when: 1000, tag: '0000_first' },
        { idx: 1, when: 2000, tag: '0001_bad_syntax' },
        { idx: 2, when: 3000, tag: '0002_never' },
      ],
      {
        '0000_first.sql': `create table ${q('first_table')}(id int);`,
        '0001_bad_syntax.sql': 'this is not valid sql;',
        '0002_never.sql': `create table ${q('never_table')}(id int);`,
      },
    );
    const inspection = await inspectMigrationRepository(dir);

    const result = await replayMigrations({
      connectionString: connectionString!,
      schema,
      table: '__drizzle_migrations',
      migrations: inspection.migrations,
    });

    expect(result.applied).toBe(1);
    expect(result.firstFailure?.tag).toBe('0001_bad_syntax');
    expect(result.firstFailure?.statement).toBe(1);

    // 0000 is committed; 0002 never ran.
    const count = await client.query(`select count(*)::int as n from "${schema}"."__drizzle_migrations"`);
    expect(count.rows[0]?.n).toBe(1);
    const neverExists = await client.query(
      `select exists (select 1 from information_schema.tables where table_schema = $1 and table_name = $2)`,
      [schema, 'never_table'],
    );
    expect(neverExists.rows[0]?.exists).toBe(false);
  });

  it('executes unqualified migration SQL verbatim (lands in the session search_path, like Drizzle)', async () => {
    const { dir } = await migration(
      [{ idx: 0, when: 1000, tag: '0000_first' }],
      { '0000_first.sql': 'create table plain_table(id int);' },
    );
    const inspection = await inspectMigrationRepository(dir);

    const result = await replayMigrations({
      connectionString: connectionString!,
      schema,
      table: '__drizzle_migrations',
      migrations: inspection.migrations,
    });

    expect(result.applied).toBe(1);
    // The unqualified table was created in public (default search_path),
    // exactly as the upstream migrator would.
    const exists = await client.query(
      `select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'plain_table')`,
    );
    expect(exists.rows[0]?.exists).toBe(true);
    await client.query('drop table if exists public.plain_table cascade');
  });

  it('refuses a target whose migration table already has rows', async () => {
    const { dir } = await migration(
      [{ idx: 0, when: 1000, tag: '0000_first' }],
      { '0000_first.sql': `create table ${q('early')}(id int);` },
    );
    await client.query(`
      create table "${schema}"."__drizzle_migrations" (
        id serial primary key, hash text not null, created_at bigint
      )
    `);
    await client.query(`insert into "${schema}"."__drizzle_migrations" (hash, created_at) values ('h', 1000)`);

    const inspection = await inspectMigrationRepository(dir);
    const result = await replayMigrations({
      connectionString: connectionString!,
      schema,
      table: '__drizzle_migrations',
      migrations: inspection.migrations,
    });

    expect(result.applied).toBe(0);
    expect(result.blocked).toBe('TARGET_NOT_EMPTY');
    expect(result.blockedRowCount).toBe(1);

    // Nothing was applied on top of the existing row.
    const count = await client.query(`select count(*)::int as n from "${schema}"."__drizzle_migrations"`);
    expect(count.rows[0]?.n).toBe(1);
    const earlyExists = await client.query(
      `select exists (select 1 from information_schema.tables where table_schema = $1 and table_name = $2)`,
      [schema, 'early'],
    );
    expect(earlyExists.rows[0]?.exists).toBe(false);
  });

  it('accepts an empty migration table as clean and never echoes the connection string', async () => {
    const { dir } = await migration(
      [{ idx: 0, when: 1000, tag: '0000_first' }],
      { '0000_first.sql': 'select 1;' },
    );
    await client.query(`
      create table "${schema}"."__drizzle_migrations" (
        id serial primary key, hash text not null, created_at bigint
      )
    `);
    const inspection = await inspectMigrationRepository(dir);

    const result = await replayMigrations({
      connectionString: connectionString!,
      schema,
      table: '__drizzle_migrations',
      migrations: inspection.migrations,
    });

    expect(result.applied).toBe(1);
    expect(result.firstFailure).toBeUndefined();
    // Sanitization invariant: failure messages never carry the credential material.
    expect(JSON.stringify(result)).not.toContain(connectionString);
  });
});
