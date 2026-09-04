# AI Handoff — Start Here

This document is the canonical entry point for coding agents working on `drizzle-doctor`.

Last reviewed: 2026-09-04.

## 1. Mission

`drizzle-doctor` is an open-source developer tool that diagnoses Drizzle migration integrity before deployment.

The product promise is intentionally narrow:

- deterministic core behavior
- read-only inspection by default
- useful locally and in CI
- no AI/model dependency at runtime
- no hosted SaaS required
- findings should explain what is wrong and why it matters

The most important failure mode today is a Drizzle migration that exists locally but can fall behind the database migration timestamp high-watermark and therefore be skipped.

Do not turn this project into a general schema-diff tool, hosted database dashboard, or automatic production repair system.

## 2. Read order for any agent

Before editing code, read these files in order:

1. `docs/AI_HANDOFF.md` — current mission, state, execution rules
2. `AGENTS.md` — repository-wide agent constraints
3. `README.md` — public product contract and CLI UX
4. `docs/MILESTONES.md` — detailed implementation sequence and acceptance gates
5. `docs/IMPROVEMENTS.md` — prioritized quality/technical improvements
6. `docs/DECISIONS.md` — locked decisions and questions that must not be guessed
7. `docs/ARCHITECTURE.md` — module boundaries and invariants
8. `docs/COMPATIBILITY.md` — verified upstream Drizzle semantics and upgrade checklist
9. `docs/FINDINGS.md` — finding codes and semantics
10. `docs/THREAT_MODEL.md` — security boundaries
11. `docs/AUTOMATION.md` — cloud/automation policy
12. `docs/ROADMAP.md` — high-level public direction
13. relevant source files and tests for the task

If documents disagree, use this precedence:

1. safety/security invariants
2. tests that encode intentional current behavior
3. `README.md` public contract
4. `docs/AI_HANDOFF.md`, `AGENTS.md`, and locked decisions
5. architecture/findings docs
6. roadmap/improvement ideas

Do not silently change an invariant to make a task easier. Document the conflict and choose the safer interpretation.

## 3. Current implementation state

The repository already contains the v0.1 core:

- TypeScript CLI
- local Drizzle journal/SQL audit
- Drizzle-compatible SHA-256 hashing of SQL file contents
- read-only PostgreSQL migration-state reader
- local-vs-database analyzer
- detection of pending/applied/divergent states
- high-watermark skip-hazard detection
- text and JSON output
- deterministic exit codes
- unit tests and PostgreSQL integration CI
- Node 20 and Node 22 CI coverage
- CodeQL, Dependabot, security/contribution docs

The repository also contains the completed M1 validation milestone:

- M1.1 fixture suite asserting exact finding codes, severities, counters, and exit behavior for every modeled state
- M1.2 upstream semantics verified against the pinned `drizzle-orm@0.45.2` with hash/timestamp equivalence tests
- M1.4 false-positive review and upgrade checklist in `docs/COMPATIBILITY.md`
- CLI exit-code contract enforced for invalid invocations

The repository is still pre-release. Do not assume npm publication, a stable public API, or production-scale compatibility testing has happened.

## 4. Current priority

The next priority is **package and prerelease hardening (M2)** — reproducible installs, packed-package smoke tests, CLI behavior hardening, and the documented output contract. Publishing itself still requires maintainer authorization.

M2 progress as of 2026-09-04 (see `docs/MILESTONES.md` for detailed status):

- M2.1 delivered: committed lockfile + `npm ci` in CI and sandbox setup
- M2.2 delivered: `tests/packaging.test.ts` (shebang, tarball contents, library export) + `package-smoke` CI job installing the tarball into a consumer project
- M2.3 delivered: CLI hardening checklist fully marked in `docs/MILESTONES.md`; credential sanitization added (`src/sanitize.ts`, P0.7/D11)
- M2.4 delivered: machine-readable output contract defined in `docs/OUTPUT_CONTRACT.md` (exit codes, finding fields, command-level JSON shape, stable vs provisional fields, evolution policy); reports now carry `formatVersion: 1`; shape pinned by `tests/output-contract.test.ts` (P0.8/Q2)
- Remaining: M2.5 prerelease preparation (version choice, changelog, publish — maintainer-authorized)

Open Dependabot PRs as of 2026-09-03: commander 15 blocked (raises Node floor to 22.12; do not merge while Node 20 is supported, D9), typescript 7.0.2 reviewed as compatible but left for maintainer decision (toolchain major), @types/node 26.4.0 reviewed as safe.

Do not jump directly to broad adapter support or feature expansion. The active sequence is:

1. M1 — validate v0.1 behavior and fixtures ✅
2. M2 — prerelease/package hardening
3. M3 — safe clean-replay capability
4. M4 — GitHub Action distribution
5. M5 — compatibility/policy hardening
6. M6+ — adapters only when justified by evidence

See `docs/MILESTONES.md` for gates and exact completion criteria.

## 5. Existing GitHub tasks

Open issues track the next major work:

- first npm prerelease preparation (#5) — milestone M2
- ephemeral PostgreSQL replay (#2) — milestone M3
- GitHub Action packaging (#3) — milestone M4

The M1 validation issue (#1) is closed as completed.

When an issue is assigned, treat the issue as the task scope. When no issue is assigned, choose the first unblocked item in `docs/MILESTONES.md` and prefer creating/updating an issue rather than performing a large untracked change.

## 6. Autonomous execution loop

An agent may work autonomously inside the product contract. Use this loop:

### Step A — understand

- read the required docs
- inspect the current implementation and tests
- inspect the relevant issue/PR if one exists
- identify the smallest coherent deliverable

### Step B — verify assumptions

If the task depends on Drizzle migration semantics, check current upstream Drizzle source before changing behavior.

Do not rely on old blog posts or assumptions when upstream source can answer the question.

### Step C — implement

- keep comparison policy in the pure analyzer where possible
- keep database-specific behavior in thin adapters
- preserve read-only defaults
- avoid new dependencies unless there is a clear user benefit
- keep Node 20+ compatibility unless a deliberate breaking change is approved

### Step D — test

At minimum, ensure:

```bash
npm run typecheck
npm test
npm run build
```

For package-facing changes also run:

```bash
npm pack --dry-run
```

For PostgreSQL behavior, add/run integration coverage.

### Step E — self-review

Before declaring completion, ask:

- Does this change weaken read-only behavior?
- Could it expose a database URL or secret?
- Did a finding code or JSON shape change?
- Could this produce a false sense of safety?
- Does it still work without AI or hosted services?
- Is the behavior tested, not just documented?
- Did scope expand beyond the issue?

### Step F — document

Update the smallest relevant set of:

- tests
- `README.md`
- `docs/FINDINGS.md`
- `docs/ARCHITECTURE.md`
- `docs/THREAT_MODEL.md`
- `docs/DECISIONS.md` when a product/compatibility decision changes
- `CHANGELOG.md`
- milestone status

Do not edit every document mechanically.

### Step G — handoff

A completed task should leave:

- code/tests/docs committed
- CI green or a clearly documented external blocker
- no credentials or generated local artifacts committed
- a concise summary of what changed
- exact commands/tests run
- remaining risks or follow-up work

## 7. Definition of done

A milestone item is not done because code exists. It is done only when all of these are true:

- behavior is implemented
- tests cover success and important failure paths
- CI passes on supported environments
- user-facing behavior is documented when relevant
- security implications are reviewed
- no known P0/P1 regression remains
- acceptance criteria in `docs/MILESTONES.md` are met

## 8. Stop and ask for maintainer approval

Do not autonomously perform any of the following unless the task explicitly authorizes it:

- publish to npm
- create a public release/tag intended as a release
- auto-repair or apply production migrations
- run destructive replay against a user-supplied database without explicit disposable-target safeguards
- weaken finding severity to make CI pass
- remove Node 20 support
- rename released finding codes or break documented JSON output
- add telemetry or send repository/database contents to a third party
- introduce paid/hosted runtime requirements
- broaden the project into unrelated schema-management features

If a task requires one of these, prepare the implementation or migration plan where safe, then stop for approval.

## 9. Decision principles

When several implementations are possible, prefer in this order:

1. correctness
2. safety
3. deterministic behavior
4. compatibility with actual Drizzle semantics
5. clear diagnostics
6. low operational complexity
7. low dependency count
8. performance
9. feature breadth

For this project, a smaller trustworthy tool is better than a larger tool that can silently report the wrong migration state.

## 10. What not to optimize for

Do not optimize for:

- commit count
- GitHub activity
- release frequency
- number of supported databases
- number of finding codes
- AI-generated features
- marketing claims before validation

Optimize for reproducible evidence that the tool catches migration-history problems correctly.
