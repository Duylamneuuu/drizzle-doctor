import { createHash } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Finding, LocalMigration, RepoInspection } from './types.js';

type JournalEntry = {
  idx: number;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type Journal = {
  entries: unknown[];
};

function finding(
  code: string,
  severity: Finding['severity'],
  message: string,
  hint?: string,
  details?: Record<string, unknown>,
): Finding {
  return { code, severity, message, ...(hint ? { hint } : {}), ...(details ? { details } : {}) };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseEntry(value: unknown, position: number): JournalEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;

  if (!Number.isInteger(raw.idx) || Number(raw.idx) < 0) return null;
  if (!Number.isFinite(raw.when) || Number(raw.when) < 0) return null;
  if (typeof raw.tag !== 'string' || raw.tag.trim().length === 0) return null;
  if (typeof raw.breakpoints !== 'boolean') return null;

  return {
    idx: Number(raw.idx),
    when: Number(raw.when),
    tag: raw.tag,
    breakpoints: raw.breakpoints,
  };
}

export async function inspectMigrationRepository(migrationsDirInput: string): Promise<RepoInspection> {
  const migrationsDir = path.resolve(migrationsDirInput);
  const journalPath = path.join(migrationsDir, 'meta', '_journal.json');
  const findings: Finding[] = [];
  const migrations: LocalMigration[] = [];
  const orphanSqlFiles: string[] = [];

  if (!(await exists(journalPath))) {
    findings.push(
      finding(
        'REPO_JOURNAL_MISSING',
        'error',
        `Drizzle journal not found at ${journalPath}.`,
        'Point --migrations at the directory that contains meta/_journal.json.',
      ),
    );
    return { migrationsDir, journalPath, migrations, orphanSqlFiles, findings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(journalPath, 'utf8'));
  } catch (error) {
    findings.push(
      finding(
        'REPO_JOURNAL_INVALID_JSON',
        'error',
        'Drizzle journal is not valid JSON.',
        'Regenerate or repair meta/_journal.json before trusting migration state.',
        { error: error instanceof Error ? error.message : String(error) },
      ),
    );
    return { migrationsDir, journalPath, migrations, orphanSqlFiles, findings };
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as Journal).entries)) {
    findings.push(
      finding(
        'REPO_JOURNAL_INVALID_SHAPE',
        'error',
        'Drizzle journal does not contain an entries array.',
      ),
    );
    return { migrationsDir, journalPath, migrations, orphanSqlFiles, findings };
  }

  const entries: JournalEntry[] = [];
  for (const [position, rawEntry] of (parsed as Journal).entries.entries()) {
    const entry = parseEntry(rawEntry, position);
    if (!entry) {
      findings.push(
        finding(
          'JOURNAL_ENTRY_INVALID',
          'error',
          `Journal entry at position ${position} has an invalid shape.`,
          'Expected idx:number, when:number, tag:string, breakpoints:boolean.',
          { position },
        ),
      );
      continue;
    }
    entries.push(entry);
  }

  const seenIdx = new Map<number, string>();
  const seenWhen = new Map<number, string>();
  const seenTag = new Set<string>();

  for (const [position, entry] of entries.entries()) {
    const priorIdxTag = seenIdx.get(entry.idx);
    if (priorIdxTag) {
      findings.push(
        finding('JOURNAL_DUPLICATE_INDEX', 'error', `Migration index ${entry.idx} is used by both ${priorIdxTag} and ${entry.tag}.`),
      );
    } else {
      seenIdx.set(entry.idx, entry.tag);
    }

    const priorWhenTag = seenWhen.get(entry.when);
    if (priorWhenTag) {
      findings.push(
        finding(
          'JOURNAL_DUPLICATE_TIMESTAMP',
          'error',
          `Migration timestamp ${entry.when} is used by both ${priorWhenTag} and ${entry.tag}.`,
          'Drizzle migration state is keyed by its created_at high-watermark; timestamps should be unique.',
        ),
      );
    } else {
      seenWhen.set(entry.when, entry.tag);
    }

    if (seenTag.has(entry.tag)) {
      findings.push(finding('JOURNAL_DUPLICATE_TAG', 'error', `Migration tag ${entry.tag} appears more than once.`));
    }
    seenTag.add(entry.tag);

    if (entry.idx !== position) {
      findings.push(
        finding(
          'JOURNAL_INDEX_SEQUENCE',
          'warning',
          `Journal position ${position} has idx ${entry.idx}.`,
          'Drizzle normally writes contiguous indices starting at 0; inspect whether the journal was edited manually.',
          { position, idx: entry.idx, tag: entry.tag },
        ),
      );
    }

    if (position > 0) {
      const previous = entries[position - 1];
      if (previous && entry.when <= previous.when) {
        findings.push(
          finding(
            'JOURNAL_TIMESTAMP_ORDER',
            'error',
            `Migration ${entry.tag} (${entry.when}) is not newer than ${previous.tag} (${previous.when}).`,
            'A non-increasing timestamp can create a migration that Drizzle will skip after a newer migration has run.',
            { current: entry.tag, previous: previous.tag },
          ),
        );
      }
    }

    const sqlPath = path.join(migrationsDir, `${entry.tag}.sql`);
    if (!(await exists(sqlPath))) {
      findings.push(
        finding(
          'MIGRATION_SQL_MISSING',
          'error',
          `Journal entry ${entry.tag} references a missing SQL file.`,
          `Expected ${sqlPath}.`,
          { tag: entry.tag, sqlPath },
        ),
      );
      continue;
    }

    const sql = await readFile(sqlPath, 'utf8');
    migrations.push({
      ...entry,
      sqlPath,
      hash: createHash('sha256').update(sql).digest('hex'),
    });
  }

  let files: string[] = [];
  try {
    files = await readdir(migrationsDir);
  } catch (error) {
    findings.push(
      finding(
        'MIGRATIONS_DIR_UNREADABLE',
        'error',
        `Could not list migration directory ${migrationsDir}.`,
        undefined,
        { error: error instanceof Error ? error.message : String(error) },
      ),
    );
  }

  const referenced = new Set(entries.map((entry) => `${entry.tag}.sql`));
  for (const file of files.filter((name) => name.endsWith('.sql')).sort()) {
    if (!referenced.has(file)) {
      orphanSqlFiles.push(file);
      findings.push(
        finding(
          'ORPHAN_SQL_FILE',
          'warning',
          `SQL file ${file} is not referenced by meta/_journal.json.`,
          'Confirm whether this file should be added to the journal or removed from the migration directory.',
          { file },
        ),
      );
    }
  }

  return { migrationsDir, journalPath, migrations, orphanSqlFiles, findings };
}
