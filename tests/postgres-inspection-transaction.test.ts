import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readPostgresMigrationState } from '../src/postgres.js';
import { replayMigrations } from '../src/replay.js';

const client = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn<(sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>>(),
  end: vi.fn(),
}));

vi.mock('pg', () => ({
  Client: class {
    connect = client.connect;
    query = client.query;
    end = client.end;
  },
}));

const options = { connectionString: 'postgresql://localhost/disposable', schema: 'drizzle', table: '__drizzle_migrations' };
const inspect = () => readPostgresMigrationState(options);
const replay = () => replayMigrations({ ...options, migrations: [] });
const statements = () => client.query.mock.calls.map(([sql]) => sql);

describe('transaction-local migration history inspection', () => {
  let tableExists: boolean;
  let rowCount: number;
  let failAt: RegExp | undefined;
  const failure = new Error('inspection failed');

  beforeEach(() => {
    vi.resetAllMocks();
    tableExists = true;
    rowCount = 1;
    failAt = undefined;
    client.connect.mockResolvedValue(undefined);
    client.end.mockResolvedValue(undefined);
    client.query.mockImplementation(async (sql) => {
      if (failAt?.test(sql)) throw failure;
      if (sql.includes('information_schema.tables')) return { rows: [{ exists: tableExists }] };
      if (sql.startsWith('select count')) return { rows: [{ n: String(rowCount) }] };
      if (sql.startsWith('select id')) return { rows: [{ id: 1, hash: 'existing', created_at: '1000' }] };
      return { rows: [] };
    });
  });

  it('keeps the RLS setting and status queries inside one read-only transaction', async () => {
    const snapshot = await inspect();
    expect(snapshot.rows).toEqual([{ id: 1, hash: 'existing', createdAt: 1000 }]);
    // Transaction pooling may reassign the server at every COMMIT. A session
    // SET before BEGIN cannot protect these later metadata queries.
    expect(statements()).toEqual([
      'begin read only',
      'set local row_security = off',
      expect.stringContaining('information_schema.tables'),
      expect.stringContaining('select id, hash, created_at'),
      'commit',
    ]);
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('ends the inspection transaction when the status table is absent', async () => {
    tableExists = false;
    expect(await inspect()).toMatchObject({ tableExists: false, rows: [] });
    expect(statements()).toEqual([
      'begin read only', 'set local row_security = off',
      expect.stringContaining('information_schema.tables'), 'commit',
    ]);
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('checks replay cleanliness in the guarded transaction before refusing a populated target', async () => {
    expect(await replay()).toMatchObject({ blocked: 'TARGET_NOT_EMPTY', applied: 0, blockedRowCount: 1 });
    expect(statements()).toEqual([
      'begin read only', 'set local row_security = off',
      expect.stringContaining('information_schema.tables'), expect.stringContaining('select count(*)'), 'commit',
    ]);
    expect(client.end).toHaveBeenCalledOnce();
  });

  it.each([false, true])('finishes replay inspection before setup (table exists: %s)', async (exists) => {
    tableExists = exists;
    rowCount = 0;
    expect(await replay()).toMatchObject({ applied: 0 });
    const sql = statements();
    expect(sql.slice(0, 3)).toEqual([
      'begin read only', 'set local row_security = off', expect.stringContaining('information_schema.tables'),
    ]);
    const commit = sql.indexOf('commit');
    expect(commit).toBe(exists ? 4 : 3);
    expect(sql[commit + 1]).toMatch(/^create schema/);
    expect(sql[commit + 2]).toMatch(/^create table/);
    expect(client.end).toHaveBeenCalledOnce();
  });

  describe.each([['status', inspect], ['replay', replay]] as const)('%s cleanup', (_name, run) => {
    it('rolls back a failed inspection and does not continue to setup', async () => {
      failAt = /^select (id|count)/;
      await expect(run()).rejects.toBe(failure);
      expect(statements().slice(0, 2)).toEqual(['begin read only', 'set local row_security = off']);
      expect(statements().at(-1)).toBe('rollback');
      expect(statements()).not.toContain('commit');
      expect(statements().some((sql) => sql.startsWith('create'))).toBe(false);
      expect(client.end).toHaveBeenCalledOnce();
    });

    it('fails closed when ending the inspection transaction fails', async () => {
      failAt = /^commit$/;
      await expect(run()).rejects.toBe(failure);
      expect(statements().slice(-2)).toEqual(['commit', 'rollback']);
      expect(statements().some((sql) => sql.startsWith('create'))).toBe(false);
      expect(client.end).toHaveBeenCalledOnce();
    });
  });
});
