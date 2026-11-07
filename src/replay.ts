// Clean-replay engine (milestone M3): applies the full local migration
// history to an explicitly disposable PostgreSQL target from zero.
//
// The engine models the upstream PostgreSQL migrator (verified against
// `drizzle-orm@0.45.2`, see docs/COMPATIBILITY.md):
//
// - creates the configured migration schema and table if missing (same DDL
//   as the upstream migrator)
// - splits each migration's SQL on the literal `--> statement-breakpoint`
//   separator, matching `readMigrationFiles`
// - inserts a `(hash, created_at)` row after each applied migration, matching
//   the upstream migrator's bookkeeping
// - every local migration is replayed: because the target must be clean (no
//   migration rows), the upstream high-watermark is always absent, so no
//   migration is skipped
//
// Deliberate deviations, which make replay a useful *diagnostic*
// rather than a deployment:
//
// - each migration runs in its own transaction instead of one transaction
//   covering the whole batch. The upstream migrator rolls everything back on
//   failure; replay instead commits each migration individually so the first
//   failing migration is precisely identified and the disposable database
//   retains applied state up to the failure. Per-statement results are
//   identical for ordinary DDL/DML histories.
// - the target must be clean: replay refuses to start when the migration
//   table already contains rows. A "clean replay" from zero is only
//   meaningful on a fresh table; skipping already-applied migrations could
//   silently validate a history that never applied end-to-end.
// - a session advisory lock excludes overlapping replay runs against the
//   same metadata table, including the initial empty-target check and DDL.
//
// Replay is destructive by definition and must never be reached implicitly:
// the CLI requires an explicit --database-url (this module never reads
// DATABASE_URL) and an affirmative --confirm-destructive flag.

import { readFile } from 'node:fs/promises';

import { Client, type QueryResultRow } from 'pg';

import { quoteIdentifier } from './postgres.js';
import { redactConnectionString } from './sanitize.js';
import type { LocalMigration, ReplayFailure, ReplayResult } from './types.js';

/** Drizzle splits migration SQL on this literal separator (drizzle-orm migrator.js). */
export const BREAKPOINT = '--> statement-breakpoint';

export interface ReplayOptions {
  connectionString: string;
  schema: string;
  table: string;
  migrations: LocalMigration[];
  /** Connection and per-query timeout in milliseconds. */
  timeoutMs?: number;
}

function sanitizeError(error: unknown, connectionString: string): { message: string; code?: string } {
  const raw = error instanceof Error ? error.message : String(error);
  // Invariant D11: driver errors must never leak the connection string or
  // its credentials. The failure message is embedded in the JSON report, so
  // the full sanitizer (URL, userinfo, password, password= fragments) is
  // applied here, not only at the CLI boundary.
  return { message: redactConnectionString(raw, connectionString), code: (error as { code?: string })?.code };
}

/**
 * Replays the local migration history against a disposable PostgreSQL target.
 *
 * Throws on operational failures (connection, schema/table creation, file
 * reads). Migration failures are returned as `firstFailure` with the run
 * stopped at the earliest failing location; a non-clean target returns a
 * blocked result without applying anything.
 */
export async function replayMigrations(options: ReplayOptions): Promise<ReplayResult> {
  const { connectionString, schema, table, migrations, timeoutMs = 30_000 } = options;

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    // A client-side read timeout does not cancel server execution. Bound
    // statements on PostgreSQL too, so rollback can proceed after a timeout.
    statement_timeout: timeoutMs,
    application_name: 'drizzle-doctor-replay',
  });
  await client.connect();

  // pg merges connection-string options over Client defaults. Per-query
  // config wins over a URL's query_timeout without reparsing connection/SSL
  // options or relying on driver internals.
  const query = <Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => {
    const config = { text, values, query_timeout: timeoutMs };
    return client.query<Row>(config);
  };

  try {
    // Override URL/startup settings on the connected session before any
    // target inspection or migration SQL. The startup Client option alone
    // can be disabled by statement_timeout=0 in the connection URL.
    await query("select pg_catalog.set_config('statement_timeout', $1, false)", [String(timeoutMs)]);
    const schemaIdent = quoteIdentifier(schema);
    const tableIdent = quoteIdentifier(table);

    // Hold across per-migration commits until this dedicated session ends.
    // Acquire before inspecting/creating the target: two empty-table checks
    // must not both succeed and replay the same non-idempotent SQL. Cast to
    // name so aliases truncated by PostgreSQL use the same lock key; format
    // quotes each component so names containing dots cannot alias the pair.
    // This coordinates cooperating runs, not SQL that explicitly releases
    // session locks (for example, pg_advisory_unlock_all()).
    const lock = await query<{ acquired: boolean }>(
      `select pg_catalog.pg_try_advisory_lock(
        pg_catalog.hashtext('drizzle-doctor/replay'),
        pg_catalog.hashtext(pg_catalog.format('%I.%I', $1::name, $2::name))
      ) as acquired`,
      [schema, table],
    );
    if (!lock.rows[0]?.acquired) {
      throw new Error('Another replay is already running against this migration table.');
    }

    const existing = await query<{ exists: boolean }>(
      `select exists (
        select 1
        from information_schema.tables
        where table_schema = $1 and table_name = $2
      ) as exists`,
      [schema, table],
    );
    const tableExists = Boolean(existing.rows[0]?.exists);
    let rowCount = 0;
    if (tableExists) {
      const count = await query<{ n: string }>(
        `select count(*)::text as n from ${schemaIdent}.${tableIdent}`,
      );
      rowCount = Number(count.rows[0]?.n ?? 0);
    }
    if (rowCount > 0) {
      return {
        schema,
        table,
        total: migrations.length,
        applied: 0,
        blocked: 'TARGET_NOT_EMPTY',
        blockedRowCount: rowCount,
      };
    }

    await query(`create schema if not exists ${schemaIdent}`);
    await query(
      `create table if not exists ${schemaIdent}.${tableIdent} (
        id serial primary key,
        hash text not null,
        created_at bigint
      )`,
    );

    let applied = 0;
    for (const migration of migrations) {
      const sql = await readFile(migration.sqlPath, 'utf8');
      const chunks = splitChunks(sql);

      await query('begin');
      let statement = 0;
      try {
        for (const chunk of chunks) {
          statement += 1;
          await query(chunk);
        }
        await query(
          `insert into ${schemaIdent}.${tableIdent} ("hash", "created_at") values ($1, $2)`,
          [migration.hash, migration.when],
        );
        await query('commit');
        applied += 1;
      } catch (error) {
        await query('rollback').catch(() => undefined);
        const sanitized = sanitizeError(error, connectionString);
        const failure: ReplayFailure = {
          tag: migration.tag,
          statement,
          statementCount: chunks.length,
          ...(sanitized.code ? { code: sanitized.code } : {}),
          message: sanitized.message,
        };
        return { schema, table, total: migrations.length, applied, firstFailure: failure };
      }
    }

    return { schema, table, total: migrations.length, applied };
  } finally {
    // Ending the session releases the advisory lock on every exit path.
    await client.end();
  }
}

/**
 * Splits migration SQL into executable chunks exactly like Drizzle's
 * `readMigrationFiles` (split on the literal breakpoint marker). Chunks that
 * are empty or whitespace-only are dropped: the upstream migrator sends them
 * as no-op queries, so skipping them produces identical database state.
 */
export function splitChunks(sql: string): string[] {
  return sql
    .split(BREAKPOINT)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
}
