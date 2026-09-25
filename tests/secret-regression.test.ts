// P1.14 — secret-pattern regression tests (invariant D11: no credential
// logging). Uses dummy credentials only (never real secrets) and asserts
// they never appear in text/JSON stdout or stderr on any expected CLI
// failure path: repo/status/replay x text/JSON x flag/env credential supply.
//
// `tests/sanitize.test.ts` pins the redactor itself and `tests/cli.test.ts`
// pins two flag-based text-mode paths; this file pins the remaining
// failure-path surface so a future output change cannot silently leak a
// credential through an unasserted channel.
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { readPostgresMigrationState } from '../src/postgres.js';
import { replayMigrations } from '../src/replay.js';
import { redactConnectionString } from '../src/sanitize.js';

const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');
const cliEntry = path.resolve('src/cli.ts');

const execFileAsync = promisify(execFile);

// Dummy credentials for leak assertions only. They are intentionally fake
// (unreachable loopback target, non-existent database) and must never be
// replaced with real values.
const DUMMY_PASSWORD = 'dd-p1-14-dummy-s3cret-pw';
const DUMMY_URL = `postgres://doctor:${DUMMY_PASSWORD}@127.0.0.1:1/nope`;
const DUMMY_ENV_URL = `postgres://doctor:${DUMMY_PASSWORD}@127.0.0.1:1/envdb`;
// Keyword/value-form connection string: exercises the non-URL-parseable
// redaction path with a dummy password.
const DUMMY_KV_URL = `host=127.0.0.1 port=1 user=doctor password=${DUMMY_PASSWORD} dbname=nope`;

const tempDirs: string[] = [];

async function repoFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drizzle-doctor-'));
  tempDirs.push(root);
  const migrationsDir = path.join(root, 'drizzle');
  await mkdir(path.join(migrationsDir, 'meta'), { recursive: true });
  await writeFile(
    path.join(migrationsDir, 'meta', '_journal.json'),
    JSON.stringify({ entries: [{ idx: 0, when: 1000, tag: '0000_first', breakpoints: true }] }),
  );
  await writeFile(path.join(migrationsDir, '0000_first.sql'), 'select 1;');
  return migrationsDir;
}

async function run(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [tsxCli, cliEntry, ...args], {
      env,
      timeout: 30_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

function envWithoutDatabaseUrl(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  return env;
}

function expectNoLeak(stdout: string, stderr: string, secrets: string[] = [DUMMY_PASSWORD, DUMMY_URL, DUMMY_ENV_URL]): void {
  for (const secret of secrets) {
    expect(stdout).not.toContain(secret);
    expect(stderr).not.toContain(secret);
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('secret-pattern regression tests (P1.14, D11)', () => {
  it('status --database-url failure in text mode never echoes the credential', async () => {
    const dir = await repoFixture();
    const { code, stdout, stderr } = await run(
      ['status', '--migrations', dir, '--database-url', DUMMY_URL],
      envWithoutDatabaseUrl(),
    );
    expect(code).toBe(2);
    expectNoLeak(stdout, stderr);
  });

  it('status --database-url failure in JSON mode emits no report and never echoes the credential', async () => {
    const dir = await repoFixture();
    const { code, stdout, stderr } = await run(
      ['status', '--migrations', dir, '--database-url', DUMMY_URL, '--json'],
      envWithoutDatabaseUrl(),
    );
    expect(code).toBe(2);
    // Exit 2 means no report at all: stdout must be empty so no JSON body
    // can carry credential material either.
    expect(stdout).toBe('');
    expectNoLeak(stdout, stderr);
  });

  it('status via DATABASE_URL env failure never echoes the credential (text and JSON)', async () => {
    const dir = await repoFixture();
    const env = { ...process.env, DATABASE_URL: DUMMY_ENV_URL };
    const text = await run(['status', '--migrations', dir], env);
    expect(text.code).toBe(2);
    expectNoLeak(text.stdout, text.stderr);
    const json = await run(['status', '--migrations', dir, '--json'], env);
    expect(json.code).toBe(2);
    expect(json.stdout).toBe('');
    expectNoLeak(json.stdout, json.stderr);
  });

  it('replay --database-url failure never echoes the credential (text and JSON)', async () => {
    const dir = await repoFixture();
    const env = envWithoutDatabaseUrl();
    const text = await run(
      ['replay', '--migrations', dir, '--database-url', DUMMY_URL, '--confirm-destructive'],
      env,
    );
    expect(text.code).toBe(2);
    expectNoLeak(text.stdout, text.stderr);
    const json = await run(
      ['replay', '--migrations', dir, '--database-url', DUMMY_URL, '--confirm-destructive', '--json'],
      env,
    );
    expect(json.code).toBe(2);
    expect(json.stdout).toBe('');
    expectNoLeak(json.stdout, json.stderr);
  });

  it('successful repo --json output contains no credential material from the environment', async () => {
    const dir = await repoFixture();
    // Even with a credential-bearing DATABASE_URL present in the
    // environment, a repo report (which never touches the database) must
    // not pick it up.
    const env = { ...process.env, DATABASE_URL: DUMMY_ENV_URL };
    const { code, stdout } = await run(['repo', '--migrations', dir, '--json'], env);
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as { ok: boolean };
    expect(report.ok).toBe(true);
    expectNoLeak(JSON.stringify(report), '');
  });

  it('keyword/value-form connection strings are redacted from error text', async () => {
    const message = `connection to "${DUMMY_KV_URL}" failed: password authentication failed`;
    const redacted = redactConnectionString(message, DUMMY_KV_URL);
    expect(redacted).not.toContain(DUMMY_PASSWORD);
    expect(redacted).not.toContain(DUMMY_KV_URL);
  });

  it('readPostgresMigrationState connection failure carries no credential', async () => {
    const failure = await readPostgresMigrationState({ connectionString: DUMMY_URL, timeoutMs: 2_000 }).then(
      () => {
        throw new Error('expected readPostgresMigrationState to throw');
      },
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(failure).not.toContain(DUMMY_PASSWORD);
    expect(failure).not.toContain(DUMMY_URL);
  });

  it('replayMigrations connection failure throws without the credential', async () => {
    const failure = await replayMigrations({ connectionString: DUMMY_URL, schema: 'drizzle', table: '__drizzle_migrations', migrations: [], timeoutMs: 2_000 }).then(
      () => {
        throw new Error('expected replayMigrations to throw');
      },
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(failure).not.toContain(DUMMY_PASSWORD);
    expect(failure).not.toContain(DUMMY_URL);
  });
});
