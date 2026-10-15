import { describe, expect, it } from 'vitest';

import { createRepoReport, formatJsonReport, formatTextReport } from '../src/report.js';
import type { DoctorReport } from '../src/types.js';

function report(): DoctorReport {
  return createRepoReport({
    migrationsDir: '/tmp/drizzle', journalPath: '/tmp/drizzle/meta/_journal.json',
    migrations: [], orphanSqlFiles: [], findings: [],
  });
}

describe('terminal-safe text reports', () => {
  it('escapes C0/C1 controls and Unicode line separators but keeps formatter newlines', () => {
    const value = report();
    const controls = Array.from({ length: 32 }, (_, index) => String.fromCharCode(index)).join('')
      + Array.from({ length: 33 }, (_, index) => String.fromCharCode(127 + index)).join('')
      + '\u2028\u2029';
    value.repository.migrationsDir = controls;
    const text = formatTextReport(value);
    expect(text).toContain('\\u0000');
    expect(text).toContain('\\t\\n\\u000b\\u000c\\r');
    expect(text).toContain('\\u007f');
    expect(text).toContain('\\u009f\\u2028\\u2029');
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/);
    expect(text.split('\n')).toContain('Migrations: 0');
    expect(text).toContain('\n\nFindings\n  None.\n\nResult: PASS');
    expect(JSON.parse(formatJsonReport(value)).repository.migrationsDir).toBe(controls);
  });

  it.each(['repo', 'status', 'replay'] as const)('escapes untrusted fields in %s reports without mutating them', (command) => {
    const value = report();
    const payload = '\u001b[2J\r\nResult: PASS\u009b2J';
    const escaped = '\\u001b[2J\\r\\nResult: PASS\\u009b2J';
    value.command = command;
    value.ok = false;
    value.repository.migrationsDir = payload;
    value.findings = [{ code: 'MIGRATION_SQL_MISSING', severity: 'error', message: payload, hint: payload }];
    if (command === 'status') {
      value.database = { schema: payload, table: payload, tableExists: true, rowCount: 0, maxCreatedAt: null };
    }
    if (command === 'replay') {
      value.replay = {
        schema: payload, table: payload, total: 1, applied: 0,
        firstFailure: { tag: payload, statement: 1, statementCount: 1, message: payload },
      };
    }
    const before = formatJsonReport(value);
    const text = formatTextReport(value);
    expect(text).toContain(`Repository: ${escaped}`);
    expect(text).toContain(`ERROR [MIGRATION_SQL_MISSING] ${escaped}`);
    expect(text).toContain(`Hint: ${escaped}`);
    if (command === 'status') expect(text).toContain(`Database: ${escaped}.${escaped}`);
    if (command === 'replay') expect(text).toContain(`failed at ${escaped} statement 1/1`);
    expect(text).not.toMatch(/[\u001b\r\u009b]/);
    expect(text.split('\n').filter((line) => line.startsWith('Result:'))).toEqual(['Result: FAIL']);
    expect(formatJsonReport(value)).toBe(before);
  });

  it('preserves ordinary Unicode text', () => {
    const value = report();
    value.repository.migrationsDir = '/tmp/migración_日本語_🚀';
    expect(formatTextReport(value)).toContain('Repository: /tmp/migración_日本語_🚀');
  });
});
