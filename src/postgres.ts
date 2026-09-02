import { Client } from 'pg';

import type { DatabaseSnapshot } from './types.js';

export interface PostgresReadOptions {
  connectionString: string;
  schema?: string;
  table?: string;
  timeoutMs?: number;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function readPostgresMigrationState(options: PostgresReadOptions): Promise<DatabaseSnapshot> {
  const schema = options.schema ?? 'drizzle';
  const table = options.table ?? '__drizzle_migrations';
  const timeoutMs = options.timeoutMs ?? 10_000;

  const client = new Client({
    connectionString: options.connectionString,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
    application_name: 'drizzle-doctor',
  });

  await client.connect();

  try {
    const existence = await client.query<{ exists: boolean }>(
      `select exists (
        select 1
        from information_schema.tables
        where table_schema = $1 and table_name = $2
      ) as exists`,
      [schema, table],
    );

    const tableExists = Boolean(existence.rows[0]?.exists);
    if (!tableExists) {
      return { schema, table, tableExists: false, rows: [] };
    }

    const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
    const result = await client.query<{ id: number; hash: string; created_at: string | number }>(
      `select id, hash, created_at from ${qualified} order by created_at asc, id asc`,
    );

    const rows = result.rows.map((row) => {
      const createdAt = Number(row.created_at);
      if (!Number.isSafeInteger(createdAt)) {
        throw new Error(`Invalid created_at value in ${schema}.${table}: ${String(row.created_at)}`);
      }
      return {
        id: Number(row.id),
        hash: String(row.hash),
        createdAt,
      };
    });

    return { schema, table, tableExists: true, rows };
  } finally {
    await client.end();
  }
}
