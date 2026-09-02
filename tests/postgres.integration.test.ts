import { Client } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { readPostgresMigrationState } from '../src/postgres.js';

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
const schema = 'drizzle_doctor_test';

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
});
