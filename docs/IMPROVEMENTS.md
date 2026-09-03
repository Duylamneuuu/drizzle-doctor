# Prioritized Improvements

This file captures concrete ways to improve `drizzle-doctor` without inflating scope. It is intentionally prioritized around correctness, safety and distribution quality.

Use it together with `docs/MILESTONES.md`. If an item conflicts with the active milestone, the milestone wins.

## Priority meanings

- **P0** — do before the first meaningful prerelease or before claiming reliability
- **P1** — high-value improvement once P0 gates are satisfied
- **P2** — useful later; implement when evidence or maintenance needs justify it
- **Research** — investigate first; do not implement from assumptions

---

# P0 — correctness and release blockers

## P0.1 Expand the fixture matrix ✅ (completed in M1)

Delivered by M1.1: `tests/m1-matrix.test.ts` and `tests/cli.test.ts` assert exact finding codes, severities, summary counters, and exit behavior for every modeled repository and database state. Fixtures are deterministic and live under `tests`.

## P0.2 Add an upstream semantics verification test/process ✅ (completed in M1)

Delivered by M1.2: `tests/upstream-semantics.test.ts` pins `drizzle-orm@0.45.2` and asserts hash/timestamp equivalence against the real package. `docs/COMPATIBILITY.md` records the verified sources, the finding-to-upstream mapping, the M1.4 false-positive review, and the upgrade checklist.

## P0.3 Commit a lockfile and switch CI to reproducible installs ✅

`package-lock.json` is committed and both CI jobs install with `npm ci` (M2.1). The locked graph is exercised on the Node 20/22 matrix.

## P0.4 Smoke-test the packed package ✅

The unit suite replaces the old dry-run-only step: `tests/packaging.test.ts` builds the CLI, verifies the shebang and bin entry, asserts the tarball contains only intended files, and resolves the library export. A dedicated `package-smoke` CI job then installs the produced tarball into a temporary consumer directory and runs the installed `drizzle-doctor` binary against a real fixture (`--help`, `--version`, `repo --json`).

## P0.5 Remove version duplication ✅ (completed in M1)

The CLI reads `--version` from `package.json` at runtime via `createRequire` (no new dependency); `tests/cli.test.ts` asserts `--version` matches package metadata.

## P0.6 Review database URL handling ✅

`DATABASE_URL` remains the recommended path and `--database-url` help text now explains the shell-history/process-list exposure instead of implying it is equally safe. The `--database-url` flag stays for CI workflows that need it; a safer indirect source can be considered later if real workflows ask for it.

Do not invent a complex secret manager integration.

Why: credential safety includes how secrets reach the process, not only report redaction.

## P0.7 Test error sanitization explicitly ✅

`src/sanitize.ts` redacts the connection string, its `user:password@` prefix, percent-encoded password forms, and `password=` fragments from any error thrown while reading database state; `status` wraps driver errors before they reach stderr (the original error is preserved only as `cause`). `tests/sanitize.test.ts` covers adversarial driver messages and `tests/cli.test.ts` asserts a real connection failure never echoes the URL or password.

## P0.8 Define the machine-readable output contract

Before external automation depends on JSON, document and test:

- report top-level fields
- finding fields
- summary fields
- command identity
- nullable/optional fields
- exit-code relationship to `ok`

Consider a `formatVersion` field before stable release if it meaningfully reduces future ambiguity.

Why: JSON becomes API very quickly once CI users consume it.

---

# P1 — high-value engineering improvements

## P1.1 Add database row ambiguity tests

The analyzer already recognizes duplicate database timestamps. Expand coverage for combinations such as:

- duplicate timestamp with one matching local hash
- duplicate timestamp with no matching local hash
- multiple database-only rows
- hash match at a different timestamp
- database rows returned out of order

Why: real migration tables can contain manually modified or historically odd states.

## P1.2 Make diagnostics more actionable without becoming prescriptive

For each finding, review whether its message answers:

1. what state was observed?
2. why does it matter?
3. what should the developer inspect next?

Avoid automatic repair instructions that imply there is one universally safe fix.

Potential improvement: expose a short stable `hint` plus structured details rather than increasingly long messages.

## P1.3 Add CLI snapshot/behavior tests

Test user-facing command behavior, not only internal functions:

- default command vs `repo`
- `status`
- `--help`
- `--version`
- malformed input
- text/JSON output
- exit codes 0/1/2

Keep snapshots selective; assert semantics rather than freezing irrelevant whitespace everywhere.

## P1.4 Clarify missing-table semantics

A missing migration table is currently informational and all local migrations are considered pending.

Validate this against actual Drizzle first-run behavior and document the limitation: a missing table does not prove the database itself is empty or safe; it only means no Drizzle migration metadata table was found at the configured location.

## P1.5 Add compatibility metadata to diagnostics

Research whether output should include tool version and detected/configured backend metadata.

Useful candidates:

- drizzle-doctor version
- backend (`postgres`)
- migration schema/table
- report format version

Do not include database host, URL or private identifiers by default.

## P1.6 Improve large-history behavior

Current histories are normally small, so do not prematurely optimize. Still, add one scale test with a large synthetic journal to catch accidental quadratic behavior or huge output growth.

Measure before changing algorithms.

## P1.7 Normalize filesystem/path error UX

Improve messages for:

- migration directory missing
- journal missing
- journal not readable
- referenced SQL unreadable
- permission errors

Output should be concise and should not dump internal stack traces by default.

## P1.8 Add an explicit debug mode only if needed

If external bug reports become hard to diagnose, consider `--debug` or a sanitized diagnostic bundle.

Requirements:

- opt-in
- no secrets
- no full migration SQL unless explicitly requested by the user
- document exactly what is collected

Do not add telemetry.

---

# P1 — architecture hardening

## P1.9 Separate public types from internal implementation details

Before publishing the library export as a supported API, decide whether programmatic imports are actually a product goal.

Options:

- CLI-only package for the first prerelease
- deliberately supported small library API

If keeping library exports:

- export only stable useful types/functions
- document them
- test package-level imports

Why: accidental exports become compatibility obligations.

## P1.10 Introduce backend capability boundaries before adding adapters

Before SQLite/MySQL support, define the minimum interface around:

- migration state loading
- backend identity
- analyzer semantics

Do not build an abstraction framework prematurely. Extract only what a second real adapter demonstrates is shared.

## P1.11 Treat finding codes as a registry

Continue documenting each finding in `docs/FINDINGS.md` with:

- code
- severity
- command(s)
- trigger
- interpretation
- structured detail fields where stable

Add tests preventing accidental duplicate finding codes or silent rename once releases begin.

---

# P1 — security and CI hardening

## P1.12 Pin release-critical GitHub Actions more strictly

Before publishing a reusable GitHub Action or sensitive release workflow, consider pinning third-party actions to immutable commit SHAs and documenting the update process.

The normal test workflow can follow the project's chosen maintenance policy, but release/security-sensitive workflows should be stricter.

## P1.13 Add least-privilege PostgreSQL examples

Document an example privilege model for `status` checks that can read only the migration metadata needed.

Do not claim a one-size-fits-all SQL grant set without testing it against the exact queries used by the adapter.

## P1.14 Add secret-pattern regression tests

Use dummy credentials in tests and assert they never appear in text/JSON/stderr outputs for expected failure paths.

This is more useful than adding a generic redaction library prematurely.

---

# P2 — developer experience and adoption

## P2.1 Add copy-paste recipes

After prerelease, add concise examples for:

- local repo audit
- local PostgreSQL status audit
- GitHub Actions repo-only audit
- GitHub Actions status audit

Avoid examples for features that are not released.

## P2.2 Create a minimal reproduction helper

If bug reports become difficult, build a helper or documented process that creates a sanitized migration-history reproduction without application data.

This should prefer journal metadata and minimal SQL fixtures over dumping a full repository.

## P2.3 Add structured remediation references

Later, findings may link to stable documentation anchors explaining investigation steps.

Keep report output short; move deep explanations into docs.

## P2.4 Consider configuration only when flags become unwieldy

Do not add a config file now just because developer tools often have one.

A config file becomes justified when users repeatedly need a set of policies/options that are awkward to express in CI and CLI flags.

## P2.5 Documentation site only if navigation becomes a real problem

README + Markdown docs are currently sufficient. A docs framework adds dependencies and maintenance.

Add one only when discoverability is demonstrably limiting usage.

---

# Research queue

These require evidence before implementation.

## R1 — Drizzle backend semantic differences

Research PostgreSQL, SQLite, D1, libSQL and MySQL migration implementations separately. Determine whether timestamp/high-watermark behavior is shared or backend-specific.

Output: a comparison note, not code first.

## R2 — generated journal compatibility over time

Research meaningful `_journal.json` shape changes across supported Drizzle Kit versions.

Output: compatibility matrix and fixtures.

## R3 — migration hash edge cases

Verify behavior for:

- line-ending changes
- final newline changes
- encoding assumptions
- statement-breakpoint comments

The tool should match Drizzle exactly, even when a difference seems semantically irrelevant to SQL.

## R4 — provider-specific PostgreSQL behavior

Only investigate Neon/Supabase/etc. when generic PostgreSQL access or permissions produce a concrete difference relevant to migration metadata inspection.

---

# Explicitly rejected improvements for now

Do not implement these unless the product direction changes:

- automatic production migration repair
- AI-generated migration decisions
- required cloud dashboard
- telemetry by default
- schema diffing unrelated to Drizzle migration history
- generic SQL linter
- migration generation
- blanket ignore-all-errors flag
- broad adapter collection with no users

# How an autonomous agent should consume this file

If no task is assigned:

1. check the active milestone in `docs/MILESTONES.md`
2. take the first unfinished P0 item that helps that milestone
3. confirm there is not already an issue/PR for it
4. implement the smallest testable change
5. update docs only where behavior changed
6. leave CI green

Do not work through this file mechanically from top to bottom when an item has become obsolete; verify current repository state first.
