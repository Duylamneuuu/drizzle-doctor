import type {
  DatabaseAnalysis,
  DatabaseMigration,
  DatabaseSnapshot,
  Finding,
  LocalMigration,
  StatusSummary,
} from './types.js';

function finding(
  code: string,
  severity: Finding['severity'],
  message: string,
  hint?: string,
  details?: Record<string, unknown>,
): Finding {
  return { code, severity, message, ...(hint ? { hint } : {}), ...(details ? { details } : {}) };
}

export function analyzeDatabaseState(
  localMigrations: LocalMigration[],
  database: DatabaseSnapshot,
): DatabaseAnalysis {
  const findings: Finding[] = [];
  const summary: StatusSummary = {
    local: localMigrations.length,
    database: database.rows.length,
    applied: 0,
    pending: 0,
    skippedHazards: 0,
    hashMismatches: 0,
    databaseOnly: 0,
  };

  if (!database.tableExists) {
    findings.push(
      finding(
        'DATABASE_MIGRATIONS_TABLE_MISSING',
        'info',
        `Migration table ${database.schema}.${database.table} does not exist.`,
        'This is normal before the first migration. All local migrations are considered pending.',
      ),
    );
    summary.pending = localMigrations.length;
    return { findings, summary, maxCreatedAt: null };
  }

  const maxCreatedAt = database.rows.length > 0
    ? Math.max(...database.rows.map((row) => row.createdAt))
    : null;

  const dbByTimestamp = new Map<number, DatabaseMigration[]>();
  const localByTimestamp = new Map(localMigrations.map((migration) => [migration.when, migration]));
  const localByHash = new Map(localMigrations.map((migration) => [migration.hash, migration]));

  for (const row of database.rows) {
    const bucket = dbByTimestamp.get(row.createdAt) ?? [];
    bucket.push(row);
    dbByTimestamp.set(row.createdAt, bucket);
  }

  for (const [createdAt, rows] of dbByTimestamp) {
    if (rows.length > 1) {
      findings.push(
        finding(
          'DATABASE_DUPLICATE_TIMESTAMP',
          'error',
          `Database contains ${rows.length} migration rows with created_at ${createdAt}.`,
          'Drizzle treats created_at as a migration high-watermark; duplicate timestamps make state ambiguous.',
          { createdAt, ids: rows.map((row) => row.id) },
        ),
      );
    }
  }

  for (const row of database.rows) {
    const localAtTimestamp = localByTimestamp.get(row.createdAt);
    if (localAtTimestamp) continue;

    const localWithHash = localByHash.get(row.hash);
    summary.databaseOnly += 1;

    if (localWithHash) {
      findings.push(
        finding(
          'DATABASE_TIMESTAMP_MISMATCH',
          'error',
          `Database migration ${row.id} has the hash of ${localWithHash.tag} but a different created_at.`,
          'The local journal timestamp may have been rewritten after the migration was applied.',
          {
            databaseCreatedAt: row.createdAt,
            localCreatedAt: localWithHash.when,
            tag: localWithHash.tag,
          },
        ),
      );
    } else {
      findings.push(
        finding(
          'DATABASE_MIGRATION_NOT_IN_REPO',
          'error',
          `Database migration row ${row.id} (${row.createdAt}) has no matching local migration.`,
          'Restore the migration history or document the intentional divergence before deploying.',
          { id: row.id, createdAt: row.createdAt, hash: row.hash },
        ),
      );
    }
  }

  for (const migration of localMigrations) {
    const rows = dbByTimestamp.get(migration.when) ?? [];
    if (rows.length > 0) {
      const matchingHash = rows.some((row) => row.hash === migration.hash);
      if (matchingHash) {
        summary.applied += 1;
      } else {
        summary.hashMismatches += 1;
        findings.push(
          finding(
            'MIGRATION_HASH_MISMATCH',
            'error',
            `Local migration ${migration.tag} differs from the migration recorded at created_at ${migration.when}.`,
            'Do not edit an already-applied migration. Restore the original SQL or create a new migration.',
            {
              tag: migration.tag,
              createdAt: migration.when,
              localHash: migration.hash,
              databaseHashes: rows.map((row) => row.hash),
            },
          ),
        );
      }
      continue;
    }

    if (maxCreatedAt !== null && migration.when <= maxCreatedAt) {
      summary.skippedHazards += 1;
      findings.push(
        finding(
          'WOULD_BE_SKIPPED_BY_DRIZZLE',
          'error',
          `Local migration ${migration.tag} is missing from the database but is not newer than the database high-watermark.`,
          'Current Drizzle PostgreSQL migration logic applies only migrations newer than the latest recorded created_at; this migration can be silently skipped.',
          {
            tag: migration.tag,
            migrationCreatedAt: migration.when,
            databaseHighWatermark: maxCreatedAt,
          },
        ),
      );
    } else {
      summary.pending += 1;
    }
  }

  return { findings, summary, maxCreatedAt };
}
