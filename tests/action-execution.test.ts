import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const actionYml = readFileSync(new URL('../action.yml', import.meta.url), 'utf8');
const tempDirs: string[] = [];

// Execute the shipped Bash, not a parallel implementation of the Action.
function runBlock(stepName: string): string {
  const step = actionYml.slice(actionYml.indexOf(`- name: ${stepName}`));
  const match = step.match(/      run: \|\n((?:        .*\n?)*)/);
  if (!match?.[1]) throw new Error(`Missing Action run block: ${stepName}`);
  return match[1].split('\n').map((line) => line.slice(8)).join('\n');
}

const auditScript = runBlock('Run audit (report first, verdict later)');
const summaryScript = runBlock('Publish summary and annotations');

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'drizzle-doctor action '));
  tempDirs.push(root);
  const actionPath = path.join(root, 'action checkout');
  const runnerTemp = path.join(root, 'runner temp');
  mkdirSync(path.join(actionPath, 'dist'), { recursive: true });
  mkdirSync(runnerTemp);
  writeFileSync(path.join(actionPath, 'package.json'), '{"type":"module"}');
  // Stub only the CLI/report renderer: this suite verifies Action file and
  // exit-code plumbing. CLI and rendering semantics have their own tests.
  writeFileSync(path.join(actionPath, 'dist/cli.js'), `
    const exit = Number(process.env.FIXTURE_EXIT);
    if (exit !== 2) process.stdout.write(JSON.stringify({
      ok: exit === 0, findings: [], marker: process.env.FIXTURE_MARKER,
    }));
    process.exitCode = exit;
  `);
  writeFileSync(path.join(actionPath, 'dist/action-summary.js'), `
    export const ACTION_MAX_ANNOTATIONS = 10;
    export const renderActionSummary = (report) => 'fixture ' + report.marker + '\\n';
    export const actionAnnotationFor = () => '';
  `);
  let invocation = 0;

  function audit(mode: string, exit = 0, temp = runnerTemp) {
    const output = path.join(root, `audit-${invocation++}.out`);
    writeFileSync(output, '');
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', auditScript], {
      encoding: 'utf8', timeout: 5_000,
      env: {
        ...process.env, RUNNER_TEMP: temp, GITHUB_ACTION_PATH: actionPath,
        GITHUB_OUTPUT: output, MODE_INPUT: mode, MIGRATIONS_INPUT: './drizzle',
        MIGRATIONS_SCHEMA_INPUT: 'drizzle', MIGRATIONS_TABLE_INPUT: '__drizzle_migrations',
        DATABASE_URL: '', FIXTURE_EXIT: String(exit), FIXTURE_MARKER: String(invocation),
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n')
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    return {
      exit: outputs.exit,
      reportPath: outputs['report-path'] ?? '',
    };
  }

  function summary(auditResult: ReturnType<typeof audit>) {
    const output = path.join(root, `summary-${invocation}.out`);
    const summary = path.join(root, `summary-${invocation}.md`);
    writeFileSync(output, '');
    writeFileSync(summary, '');
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', summaryScript], {
      encoding: 'utf8', timeout: 5_000,
      env: {
        ...process.env, RUNNER_TEMP: runnerTemp, GITHUB_ACTION_PATH: actionPath,
        GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary,
        AUDIT_EXIT: auditResult.exit, REPORT_PATH: auditResult.reportPath,
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    return { output: readFileSync(output, 'utf8'), text: readFileSync(summary, 'utf8') };
  }

  return { audit, summary, runnerTemp };
}

describe('composite Action report isolation', () => {
  it('does not reuse a successful report for an invalid second invocation', () => {
    const f = fixture();
    expect(f.summary(f.audit('repo')).output).toBe('ok=true\n');
    const invalid = f.audit('invalid');
    expect(invalid.exit).toBe('2');
    expect(f.summary(invalid)).toEqual({
      output: 'ok=false\n',
      text: expect.stringContaining('could not complete'),
    });
  });

  it('keeps reports distinct and renders each invocation\'s findings verdict', () => {
    const f = fixture();
    const clean = f.audit('repo');
    const broken = f.audit('repo', 1);
    expect(broken.exit).toBe('1');
    expect(broken.reportPath).not.toBe(clean.reportPath);
    expect(f.summary(clean)).toEqual({ output: 'ok=true\n', text: 'fixture 1\n' });
    expect(f.summary(broken)).toEqual({ output: 'ok=false\n', text: 'fixture 2\n' });
  });

  it('reports an operational failure after a successful invocation as not-ok', () => {
    const f = fixture();
    f.audit('repo');
    const failed = f.audit('status', 2);
    expect(failed.exit).toBe('2');
    expect(f.summary(failed).output).toBe('ok=false\n');
  });

  it('fails closed if a fresh report cannot be created', () => {
    const f = fixture();
    f.audit('repo');
    const failed = f.audit('repo', 0, path.join(f.runnerTemp, 'missing directory'));
    expect(failed.exit).toBe('2');
    expect(f.summary(failed).output).toBe('ok=false\n');
  });
});
