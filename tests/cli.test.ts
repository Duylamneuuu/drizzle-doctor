// M1.1 exit-behavior assertions + P1.3 CLI behavior coverage.
// Runs the real CLI entry through tsx so exit codes and output are the
// contract under test, not internal functions.
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');
const cliEntry = path.resolve('src/cli.ts');
const packageJson = JSON.parse(require('fs').readFileSync(path.resolve('package.json'), 'utf8')) as {
  version: string;
};

const execFileAsync = promisify(execFile);

const tempDirs: string[] = [];

async function repoFixture(entries: unknown[], sqlFiles: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drizzle-doctor-'));
  tempDirs.push(root);
  const migrationsDir = path.join(root, 'drizzle');
  await mkdir(path.join(migrationsDir, 'meta'), { recursive: true });
  await writeFile(path.join(migrationsDir, 'meta', '_journal.json'), JSON.stringify({ entries }, null, 2));
  for (const [file, contents] of Object.entries(sqlFiles)) {
    await writeFile(path.join(migrationsDir, file), contents);
  }
  return migrationsDir;
}

async function run(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<{ code: number; stdout: string; stderr: string }> {
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

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('cli exit behavior', () => {
  it('--help exits 0 and lists the commands', async () => {
    const { code, stdout } = await run(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: drizzle-doctor');
    expect(stdout).toContain('repo');
    expect(stdout).toContain('status');
  });

  it('--version matches package.json and exits 0', async () => {
    const { code, stdout } = await run(['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(packageJson.version);
  });

  it('healthy repository exits 0 with PASS', async () => {
    const dir = await repoFixture(
      [{ idx: 0, when: 1000, tag: '0000_first', breakpoints: true }],
      { '0000_first.sql': 'select 1;' },
    );
    const { code, stdout } = await run(['repo', '--migrations', dir]);
    expect(code).toBe(0);
    expect(stdout).toContain('Result: PASS');
  });

  it('repository with a missing journal exits 1 with the finding', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'drizzle-doctor-'));
    tempDirs.push(root);
    const { code, stdout } = await run(['repo', '--migrations', root]);
    expect(code).toBe(1);
    expect(stdout).toContain('ERROR [REPO_JOURNAL_MISSING]');
  });

  it('--json output parses and carries the ok flag', async () => {
    const dir = await repoFixture(
      [{ idx: 0, when: 1000, tag: '0000_first', breakpoints: true }],
      { '0000_first.sql': 'select 1;' },
    );
    const { code, stdout } = await run(['repo', '--migrations', dir, '--json']);
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as { ok: boolean; command: string; generatedAt: string; formatVersion: number };
    expect(report.ok).toBe(true);
    expect(report.command).toBe('repo');
    expect(report.formatVersion).toBe(1);
    expect(typeof report.generatedAt).toBe('string');
  });

  it('failing repository in JSON mode exits 1 with ok=false (exit-code contract)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'drizzle-doctor-'));
    tempDirs.push(root);
    const { code, stdout } = await run(['repo', '--migrations', root, '--json']);
    expect(code).toBe(1);
    const report = JSON.parse(stdout) as { ok: boolean; command: string; findings: Array<{ code: string }> };
    expect(report.ok).toBe(false);
    expect(report.command).toBe('repo');
    expect(report.findings.some((finding) => finding.code === 'REPO_JOURNAL_MISSING')).toBe(true);
  });

  it('unknown command exits 2, not 1', async () => {
    const { code, stderr } = await run(['frobnicate']);
    expect(code).toBe(2);
    expect(stderr).toContain('unknown command');
  });

  it('unknown option exits 2, not 1', async () => {
    const { code, stderr } = await run(['repo', '--bogus-flag']);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown option '--bogus-flag'");
  });

  it('status without a database URL exits 2 with an explanatory error', async () => {
    const dir = await repoFixture(
      [{ idx: 0, when: 1000, tag: '0000_first', breakpoints: true }],
      { '0000_first.sql': 'select 1;' },
    );
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const { code, stderr } = await run(['status', '--migrations', dir], env);
    expect(code).toBe(2);
    expect(stderr).toContain('Missing database URL');
  });

  it('status connection failures never echo the database URL or password (D11)', async () => {
    const dir = await repoFixture(
      [{ idx: 0, when: 1000, tag: '0000_first', breakpoints: true }],
      { '0000_first.sql': 'select 1;' },
    );
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const url = 'postgres://doctor:sup3r-s3cret@127.0.0.1:1/nope';
    const { code, stdout, stderr } = await run(
      ['status', '--migrations', dir, '--database-url', url],
      env,
    );
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).not.toContain('sup3r-s3cret');
    expect(stderr).not.toContain('postgres://doctor');
    expect(stderr).not.toContain(url);
  });
});
