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

## P0.1 Expand the fixture matrix

Current unit/integration coverage proves the initial core works, but the project needs a named fixture for every important state in M1.

Improve by:

- storing small deterministic fixture repositories under tests
- asserting exact finding codes and summary counters
- separating repository corruption fixtures from database-state fixtures
- making expected false-positive/ambiguous cases explicit

Why: this is the strongest defense against regressions in a diagnostic tool.

## P0.2 Add an upstream semantics verification test/process

The tool models Drizzle behavior that may change upstream.

Improve by:

- documenting the exact Drizzle source locations/versions reviewed
- testing assumptions through minimal compatibility fixtures
- adding a repeatable maintainer checklist for upstream upgrades
- avoiding a brittle test that downloads `main` on every CI run

Why: silently modeling outdated Drizzle behavior is worse than failing loudly.

## P0.3 Commit a lockfile and switch CI to reproducible installs

The repository should not depend on unconstrained fresh dependency resolution for every CI run.

Improve by:

- generating/committing the npm lockfile
- using `npm ci` in CI after the lockfile exists
- verifying the supported Node matrix with the locked dependency graph

Why: deterministic installs are part of deterministic tooling.

## P0.4 Smoke-test the packed package

`npm run build` is not enough to prove the npm artifact works.

Improve by having CI or a release check:

1. run `npm pack`
2. install the produced tarball into a temporary consumer directory
3. run `drizzle-doctor --help`
4. run a small `repo` fixture through the installed binary
5. verify the library export only if it is intentionally public

Why: catches missing files, broken bin paths, ESM/export mistakes and packaging drift.

## P0.5 Remove version duplication

The CLI currently hard-codes its version while `package.json` also owns a version.

Improve by deriving CLI version from package metadata or a build-time single source of truth.

Requirements:

- keep package execution simple under ESM
- avoid adding a dependency just for version reading
- add a test that `--version` matches package metadata

Why: release version drift is easy to create and confusing to users.

## P0.6 Review database URL handling

The CLI supports `--database-url`, which is convenient but can expose credentials through shell history or process listings even if the application never prints the value.

Improve by evaluating one of these approaches:

- prefer `DATABASE_URL` and document it as the recommended path
- keep the flag but warn in security docs/help about shell history/process visibility
- support a safer indirect source later if real CI/local workflows need it

Do not invent a complex secret manager integration.

Why: credential safety includes how secrets reach the process, not only report redaction.

## P0.7 Test error sanitization explicitly

Add tests ensuring connection/parser/runtime errors cannot echo a supplied credential-bearing URL into normal stderr/report output.

If an upstream PostgreSQL client error contains the original connection string, sanitize before displaying it.

Why: the current product promise says credentials are not logged; this needs executable evidence.

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
