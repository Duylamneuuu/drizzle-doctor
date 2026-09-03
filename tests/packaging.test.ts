// M2.2 package surface verification — the packed package, not just the source
// checkout, must be usable: the build produces a bin with a working shebang,
// the tarball contains only intended files (no tests/src/secrets), and the
// built CLI behaves like the documented contract.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

const root = path.resolve('.');
const packageJson = JSON.parse(require('fs').readFileSync(path.resolve('package.json'), 'utf8')) as {
  name: string;
  version: string;
};

async function run(args: string[], options: { cwd?: string; timeout?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(args[0], args.slice(1), {
      cwd: options.cwd ?? root,
      timeout: options.timeout ?? 120_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

describe('packed package surface (M2.2)', () => {
  it('builds a CLI entry with a working shebang that matches the package version', async () => {
    const build = await run(['npm', 'run', 'build']);
    expect(build.code).toBe(0);

    const cliSource = await readFile(path.resolve('dist/cli.js'), 'utf8');
    expect(cliSource.startsWith('#!/usr/bin/env node')).toBe(true);

    const version = await run(['node', 'dist/cli.js', '--version']);
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toBe(packageJson.version);

    const help = await run(['node', 'dist/cli.js', '--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: drizzle-doctor');
    expect(help.stdout).toContain('repo');
    expect(help.stdout).toContain('status');
  });

  it('publishes only intended files in the tarball', async () => {
    const pack = await run(['npm', 'pack', '--dry-run', '--json']);
    expect(pack.code).toBe(0);

    const entries = JSON.parse(pack.stdout) as Array<{
      filename: string;
      files: Array<{ path: string }>;
    }>;
    expect(entries).toHaveLength(1);
    const files = entries[0]?.files.map((file) => file.path) ?? [];

    expect(files).toContain('dist/cli.js');
    expect(files).toContain('dist/index.js');
    expect(files).toContain('package.json');
    expect(files).toContain('README.md');
    expect(files).toContain('LICENSE');

    // Nothing outside the intended publish surface.
    for (const file of files) {
      expect(file).toMatch(/^(dist\/|package\.json$|README\.md$|LICENSE$)/);
    }
    expect(files.some((file) => file.startsWith('tests/'))).toBe(false);
    expect(files.some((file) => file.startsWith('src/'))).toBe(false);
    expect(files.some((file) => file.includes('.github'))).toBe(false);
    expect(files.some((file) => file.includes('.git'))).toBe(false);
    expect(entries[0]?.filename).toBe(`drizzle-doctor-${packageJson.version}.tgz`);
  });

  it('the built library export resolves', async () => {
    const build = await run(['npm', 'run', 'build']);
    expect(build.code).toBe(0);
    const load = await run(['node', '--input-type=module', '-e', "import('./dist/index.js').then((m) => { if (!m.analyzeDatabaseState) process.exit(1); })"]);
    expect(load.code).toBe(0);
  });
});
