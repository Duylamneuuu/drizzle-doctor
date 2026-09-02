#!/usr/bin/env node

import process from 'node:process';

import { Command } from 'commander';

import { analyzeDatabaseState } from './analyze.js';
import { readPostgresMigrationState } from './postgres.js';
import { inspectMigrationRepository } from './repository.js';
import { createRepoReport, createStatusReport, formatJsonReport, formatTextReport } from './report.js';
import { hasErrors } from './types.js';

interface RepoOptions {
  migrations: string;
  json?: boolean;
}

interface StatusOptions extends RepoOptions {
  databaseUrl?: string;
  migrationsSchema: string;
  migrationsTable: string;
}

function printReport(report: ReturnType<typeof createRepoReport>, json = false): void {
  process.stdout.write(`${json ? formatJsonReport(report) : formatTextReport(report)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

async function runRepo(options: RepoOptions): Promise<void> {
  const inspection = await inspectMigrationRepository(options.migrations);
  printReport(createRepoReport(inspection), Boolean(options.json));
}

async function runStatus(options: StatusOptions): Promise<void> {
  const inspection = await inspectMigrationRepository(options.migrations);

  if (hasErrors(inspection.findings)) {
    printReport(createRepoReport(inspection, 'status'), Boolean(options.json));
    return;
  }

  const connectionString = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Missing database URL. Pass --database-url or set DATABASE_URL.');
  }

  const database = await readPostgresMigrationState({
    connectionString,
    schema: options.migrationsSchema,
    table: options.migrationsTable,
  });
  const analysis = analyzeDatabaseState(inspection.migrations, database);
  printReport(createStatusReport(inspection, database, analysis), Boolean(options.json));
}

const program = new Command();
program
  .name('drizzle-doctor')
  .description('Read-only Drizzle migration integrity and PostgreSQL state auditor.')
  .version('0.1.0')
  .showHelpAfterError()
  .option('-m, --migrations <dir>', 'Drizzle migrations directory', './drizzle')
  .option('--json', 'Emit machine-readable JSON')
  .action(async (options: RepoOptions) => runRepo(options));

program
  .command('repo')
  .description('Audit the local Drizzle migration journal and SQL files.')
  .option('-m, --migrations <dir>', 'Drizzle migrations directory', './drizzle')
  .option('--json', 'Emit machine-readable JSON')
  .action(async (options: RepoOptions) => runRepo(options));

program
  .command('status')
  .description('Compare local migrations with the PostgreSQL Drizzle migration table.')
  .option('-m, --migrations <dir>', 'Drizzle migrations directory', './drizzle')
  .option('--database-url <url>', 'PostgreSQL connection URL (defaults to DATABASE_URL)')
  .option('--migrations-schema <schema>', 'Drizzle migration schema', 'drizzle')
  .option('--migrations-table <table>', 'Drizzle migration table', '__drizzle_migrations')
  .option('--json', 'Emit machine-readable JSON')
  .action(async (options: StatusOptions) => runStatus(options));

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`drizzle-doctor: ${message}\n`);
  process.exitCode = 2;
});
