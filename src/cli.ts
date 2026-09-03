#!/usr/bin/env node

import { createRequire } from 'node:module';
import process from 'node:process';

import { Command, CommanderError } from 'commander';

import { analyzeDatabaseState } from './analyze.js';
import { readPostgresMigrationState } from './postgres.js';
import { inspectMigrationRepository } from './repository.js';
import { createRepoReport, createStatusReport, formatJsonReport, formatTextReport } from './report.js';
import { redactConnectionString } from './sanitize.js';
import { hasErrors } from './types.js';
import type { DatabaseSnapshot } from './types.js';

const require = createRequire(import.meta.url);
const packageVersion = require('../package.json').version as string;

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

  let database: DatabaseSnapshot;
  try {
    database = await readPostgresMigrationState({
      connectionString,
      schema: options.migrationsSchema,
      table: options.migrationsTable,
    });
  } catch (error) {
    // Never let a driver error echo the connection string or its password
    // (invariant D11). The original error is preserved as `cause` only.
    const rawMessage = error instanceof Error ? error.message : String(error);
    throw new Error(redactConnectionString(rawMessage, connectionString), { cause: error });
  }
  const analysis = analyzeDatabaseState(inspection.migrations, database);
  printReport(createStatusReport(inspection, database, analysis), Boolean(options.json));
}

const program = new Command();
program
  .name('drizzle-doctor')
  .description('Read-only Drizzle migration integrity and PostgreSQL state auditor.')
  .version(packageVersion)
  .showHelpAfterError();

program
  .command('repo')
  .description('Audit the local Drizzle migration journal and SQL files.')
  .option('-m, --migrations <dir>', 'Drizzle migrations directory', './drizzle')
  .option('--json', 'Emit machine-readable JSON')
  .exitOverride()
  .action(async (options: RepoOptions) => runRepo(options));

program
  .command('status')
  .description('Compare local migrations with the PostgreSQL Drizzle migration table.')
  .option('-m, --migrations <dir>', 'Drizzle migrations directory', './drizzle')
  .option('--database-url <url>', 'PostgreSQL connection URL (defaults to DATABASE_URL; prefer the environment variable so the credential stays out of shell history and process listings)')
  .option('--migrations-schema <schema>', 'Drizzle migration schema', 'drizzle')
  .option('--migrations-table <table>', 'Drizzle migration table', '__drizzle_migrations')
  .option('--json', 'Emit machine-readable JSON')
  .exitOverride()
  .action(async (options: StatusOptions) => runStatus(options));

program.command('*', { hidden: true }).argument('[args...]').exitOverride().action((args: string[]) => {
  throw new Error(`unknown command '${args.join(' ')}'`);
});

program.exitOverride();

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof CommanderError) {
    // Help/version requests are successful exits; a bare invocation shows help
    // with a non-zero code; every other commander error means the command
    // could not complete (unknown command/option), not that migration
    // problems were found.
    if (error.exitCode === 0) return;
    if (error.code === 'commander.helpDisplayed') {
      process.exitCode = 1;
      return;
    }
    process.stderr.write(`drizzle-doctor: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`drizzle-doctor: ${message}\n`);
  process.exitCode = 2;
});
