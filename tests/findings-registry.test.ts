// P1.11 finding-code registry guard. The set of machine-readable finding
// codes (and their default severities) is user-facing API once released (D7):
// renaming a code or silently changing a severity would break CI consumers.
// These tests pin the registry in `src/types.ts` against the documented
// codes in `docs/FINDINGS.md` and against every code the implementation can
// emit, so adding a finding without updating the registry + docs fails
// loudly instead of drifting.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FINDING_CODES, FINDING_SEVERITIES, type Finding } from '../src/types.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function documentedCodes(findingsDoc: string): { code: string; severity: Finding['severity'] }[] {
  const rows: { code: string; severity: Finding['severity'] }[] = [];
  for (const line of findingsDoc.split('\n')) {
    const match = line.match(/^\| `([A-Z][A-Z0-9_]*)` \| (error|warning|info) \|/);
    if (match) rows.push({ code: match[1]!, severity: match[2] as Finding['severity'] });
  }
  return rows;
}

describe('finding-code registry (P1.11)', () => {
  it('contains no duplicates', () => {
    expect(new Set(FINDING_CODES).size).toBe(FINDING_CODES.length);
  });

  it('covers exactly the codes documented in docs/FINDINGS.md with matching severities', async () => {
    const findingsDoc = await readFile(path.join(repoRoot, 'docs', 'FINDINGS.md'), 'utf8');
    const documented = documentedCodes(findingsDoc);

    expect(documented.length).toBeGreaterThan(0);
    expect(new Set(documented.map((row) => row.code)).size).toBe(documented.length);
    expect([...FINDING_CODES].sort()).toEqual(documented.map((row) => row.code).sort());

    for (const row of documented) {
      expect(FINDING_SEVERITIES[row.code as (typeof FINDING_CODES)[number]]).toBe(row.severity);
    }
  });

  it('covers exactly the finding codes the implementation emits', async () => {
    const sources = await Promise.all(
      ['repository.ts', 'analyze.ts', 'report.ts'].map((file) =>
        readFile(path.join(repoRoot, 'src', file), 'utf8'),
      ),
    );
    const [repository, analyze, report] = sources as [string, string, string, ...string[]];

    // String literals that look like finding codes, excluding the internal
    // `ReplayResult.blocked` enum value ('TARGET_NOT_EMPTY'), which is not a
    // finding code.
    const emitted = new Set<string>();
    for (const source of [repository, analyze, report]) {
      for (const match of source.matchAll(/'([A-Z][A-Z0-9_]{2,})'/g)) {
        if (match[1] !== 'TARGET_NOT_EMPTY' && match[1] !== 'ENOENT') emitted.add(match[1]!);
      }
    }
    // 'PASS'/'FAIL' are text-report result words, not finding codes.
    emitted.delete('PASS');
    emitted.delete('FAIL');

    expect([...emitted].sort()).toEqual([...FINDING_CODES].sort());
  });
});
