import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('Action unsupported-mode diagnostics', () => {
  it.each([
    'unsupported',
    'repo\n::error::forged annotation',
    'repo\r::warning::forged annotation',
    'repo ##[error]forged legacy annotation',
    'postgres://user:synthetic-password@example.invalid/database',
  ])('rejects %j without logging caller-controlled data', async (mode) => {
    const action = await readFile(new URL('../action.yml', import.meta.url), 'utf8');
    const auditStep = action.slice(action.indexOf('    - name: Run audit (report first, verdict later)'));
    const runBlock = auditStep.match(/      run: \|\n((?:        .*\n?)*)/)?.[1];
    expect(runBlock).toBeDefined();
    const script = runBlock!.replace(/^ {8}/gm, '');

    const root = await mkdtemp(path.join(os.tmpdir(), 'drizzle-doctor-action-mode-'));
    try {
      const outputPath = path.join(root, 'output');
      await writeFile(outputPath, '');
      // Run the actual composite script with the runner's errexit setting.
      // Invalid modes must stop before reading other inputs or invoking Node.
      const { stdout, stderr } = await execFileAsync('bash', ['-e', '-o', 'pipefail', '-c', script], {
        env: { ...process.env, MODE_INPUT: mode, GITHUB_OUTPUT: outputPath },
        timeout: 10_000,
      });

      expect(stdout).toBe('');
      expect(stderr).toBe("drizzle-doctor: unsupported mode (expected 'repo' or 'status')\n");
      expect(await readFile(outputPath, 'utf8')).toBe('exit=2\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
