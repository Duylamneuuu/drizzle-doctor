import { Client } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { analyzeDatabaseState } from '../src/analyze.js';
import { readPostgresMigrationState } from '../src/postgres.js';
import type { LocalMigration } from '../src/types.js';

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
const schema = 'drizzle_doctor_test';

function local(idx: number, when: number, tag: string, hash: string): LocalMigration {
  return { idx, when, tag, breakpoints: true, sqlPath: `/tmp/${tag}.sql`, hash };
}

suite('readPostgresMigrationState', () => {
  beforeEach(async () => {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await client.query(`drop schema if exists "${schema}" cascade`);
      await client.query(`create schema "${schema}"`);
      await client.query(`
        create table "${schema}"."__drizzle_migrations" (
          id serial primary key,
          hash text not null,
          created_at bigint
        )
      `);
      await client.query(
        `insert into "${schema}"."__drizzle_migrations" (hash, created_at) values ($1, $2), ($3, $4)`,
        ['hash-a', 1000, 'hash-b', 2000],
      );
    } finally {
      await client.end();
    }
  });

  afterAll(async () => {
    if (!connectionString) return;
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await client.query(`drop schema if exists "${schema}" cascade`);
    } finally {
      await client.end();
    }
  });

  it('reads the Drizzle migration table without changing it', async () => {
    if (!connectionString) throw new Error('TEST_DATABASE_URL is required for this test');

    const snapshot = await readPostgresMigrationState({
      connectionString,
      schema,
      table: '__drizzle_migrations',
    });

    expect(snapshot.tableExists).toBe(true);
    expect(snapshot.rows).toEqual([
      { id: 1, hash: 'hash-a', createdAt: 1000 },
      { id: 2, hash: 'hash-b', createdAt: 2000 },
    ]);
  });

  it('reads a custom-named migration table', async () => {
    if (!connectionString) throw new Error('TEST_DATABASE_URL is required for this test');

    const client = new Client({ connectionString });
    await client.connect();
    try {
      await client.query(`
        create table "${schema}"."custom_migration_log" (
          id serial primary key,
          hash text not null,
          created_at bigint
        )
      `);
      await client.query(
        `insert into "${schema}"."custom_migration_log" (hash, created_at) values ($1, $2)`,
        ['hash-custom', 3000],
      );
    } finally {
      await client.end();
    }

    const snapshot = await readPostgresMigrationState({
      connectionString,
      schema,
      table: 'custom_migration_log',
    });

    expect(snapshot.tableExists).toBe(true);
    expect(snapshot.rows).toEqual([{ id: 1, hash: 'hash-custom', createdAt: 3000 }]);
  });

  it('flags a skip hazard against real database rows', async () => {
    if (!connectionString) throw new Error('TEST_DATABASE_URL is required for this test');

    const snapshot = await readPostgresMigrationState({
      connectionString,
      schema,
      table: '__drizzle_migrations',
    });

    const analysis = analyzeDatabaseState(
      [
        // present in the DB (timestamp + hash match rows above)
        local(0, 1000, '0000_first', 'hash-a'),
        // present in the DB
        local(1, 2000, '0001_second', 'hash-b'),
        // missing from the DB and old => Drizzle would skip it
        local(2, 1500, '0002_late', 'hash-c'),
      ],
      snapshot,
    );

    expect(analysis.summary.applied).toBe(2);
    expect(analysis.summary.skippedHazards).toBe(1);
    expect(analysis.findings.some((f) => f.code === 'WOULD_BE_SKIPPED_BY_DRIZZLE')).toBe(true);
  });
});
