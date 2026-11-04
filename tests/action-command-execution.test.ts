// Execute the actual composite Action glue, not a copy of its rendering loop.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import type { DoctorReport } from '../src/types.js';

const root = path.resolve('.');
const action = readFileSync(path.join(root, 'action.yml'), 'utf8');
const summaryBlock = action.match(
  /    - name: Publish summary and annotations\n[\s\S]*?      run: \|\n((?:        .*\n?)*)/,
)?.[1];

beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { cwd: root, timeout: 120_000 });
}, 120_000);

describe('composite Action summary execution', () => {
  it.each([true, false])('keeps injected commands inert (summary file: %s)', (useSummaryFile) => {
    expect(summaryBlock, 'the actual Action summary step must be present').toBeDefined();
    const script = summaryBlock!.replace(/^ {8}/gm, '');
    const temporary = mkdtempSync(path.join(tmpdir(), 'doctor action execution '));
    try {
      const migrations = path.join(temporary, 'migrations');
      mkdirSync(path.join(migrations, 'meta'), { recursive: true });
      const tag = '0000_![approve](https:example.invalid)<img src=x>\r\n::warning::forged-v2\r##[warning]forged-v1';
      writeFileSync(path.join(migrations, 'meta', '_journal.json'), JSON.stringify({
        version: '7', dialect: 'postgresql',
        entries: [{ idx: 0, when: 1000, tag, breakpoints: true }],
      }));
      const audit = spawnSync(process.execPath, [
        path.join(root, 'dist', 'cli.js'), 'repo', '--migrations', migrations, '--json',
      ], { encoding: 'utf8', timeout: 10_000 });
      expect(audit.error).toBeUndefined();
      expect(audit.status).toBe(1);
      const report = JSON.parse(audit.stdout) as DoctorReport;
      // Prove the malicious text reaches a finding, rather than passing
      // because journal validation rejected the fixture before rendering it.
      expect(report.findings.some((finding) => finding.message.includes(tag))).toBe(true);
      const reportFile = path.join(temporary, 'drizzle-doctor-report.json');
      writeFileSync(reportFile, audit.stdout);

      const outputFile = path.join(temporary, 'outputs');
      const summaryFile = path.join(temporary, 'summary');
      const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
        encoding: 'utf8', timeout: 10_000,
        env: {
          ...process.env,
          GITHUB_ACTION_PATH: root,
          RUNNER_TEMP: temporary,
          GITHUB_OUTPUT: outputFile,
          GITHUB_STEP_SUMMARY: useSummaryFile ? summaryFile : '',
          AUDIT_EXIT: '1',
          REPORT_PATH: reportFile,
        },
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe('');
      expect(readFileSync(outputFile, 'utf8')).toBe('ok=false\n');
      expect(readFileSync(reportFile, 'utf8')).toBe(audit.stdout);

      const lines = result.stdout.split('\n').filter(Boolean);
      const annotations = lines.filter((line) => line.startsWith('::error title=drizzle-doctor ['));
      expect(annotations).toHaveLength(Math.min(10,
        report.findings.filter((finding) => finding.severity === 'error').length));
      expect(annotations.some((line) => line.includes('%0D%0A::warning::forged-v2'))).toBe(true);
      // The runner tries V2 parsing first, so legacy-looking text inside a
      // valid ::error annotation is data. All other log lines must be inert.
      for (const line of lines.filter((line) => !annotations.includes(line))) {
        expect(line.trimStart()).not.toMatch(/^::/);
        expect(line).not.toContain('##[');
        expect(line).not.toContain('\r');
      }
      const summary = useSummaryFile ? readFileSync(summaryFile, 'utf8') : result.stdout;
      expect(summary).toContain('| error |');
      expect(summary).toContain('&#33;&#91;approve&#93;&#40;https&#58;example&#46;invalid&#41;&#60;img src&#61;x&#62;');
      if (useSummaryFile) {
        expect(summary).not.toContain('##[');
        expect(summary).not.toMatch(/[\r\n]::warning::/);
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
