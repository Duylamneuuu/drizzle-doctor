# AI Handoff — Start Here

This document is the canonical entry point for coding agents working on `drizzle-doctor`.

Last reviewed: 2026-09-16.

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

The repository is still pre-alpha. GitHub Pre-release tag `v0.1.0-alpha.2`
supersedes the initial alpha.1 tag for source/Action consumption. Do not
assume npm publication, a stable public API, or production-scale
compatibility testing has happened. Do not create a moving `@v1` Action tag.

## 4. Current priority

The next remaining **maintainer-gated** item is **npm publish (M2.5 / D14)**.
Do not publish to npm. M4 Action source + GitHub tag `v0.1.0-alpha.2` exist;
consumers pin `@v0.1.0-alpha.2`. A moving `@v1` tag must not be created
while still pre-alpha. Post-release docs closeout (P2.1 recipes, ACTION.md
pin, changelog fold) is the current non-gated M4 follow-up.

M2 progress as of 2026-09-04 (see `docs/MILESTONES.md` for detailed status):

- M2.1 delivered: committed lockfile + `npm ci` in CI and sandbox setup
- M2.2 delivered: `tests/packaging.test.ts` (shebang, tarball contents, library export) + `package-smoke` CI job installing the tarball into a consumer project
- M2.3 delivered: CLI hardening checklist fully marked in `docs/MILESTONES.md`; credential sanitization added (`src/sanitize.ts`, P0.7/D11)
- M2.4 delivered: machine-readable output contract defined in `docs/OUTPUT_CONTRACT.md` (exit codes, finding fields, command-level JSON shape, stable vs provisional fields, evolution policy); reports now carry `formatVersion: 1`; shape pinned by `tests/output-contract.test.ts` (P0.8/Q2)
- M2.5 prepared (2026-09-04; hardening release updated 2026-09-16): name availability checked (`drizzle-doctor` free on npm), current version `0.1.0-alpha.2` (package.json + lockfile), `CHANGELOG.md` prerelease sections written, `npm pack --dry-run` clean (43 files: dist/README/LICENSE/package.json), tarball smoke verified by CI `package-smoke` and local CLI runs, provenance (`npm publish --provenance` via GitHub OIDC) recommended but not decided. The npm publish itself remains maintainer-gated (D14/AGENTS.md); no npm publication was performed.

All M2 pre-publication acceptance criteria hold; M2 stays 🚧 only for the
maintainer-authorized publish step.

Open Dependabot PRs as of 2026-09-04: @types/node 26.4.0 merged (#8). commander 15 still blocked (declares `engines: node >=22.12.0`; do not merge while Node 20 is supported, D9 — commander 14 receives security updates until May 2027, so there is no security pressure). typescript 7.0.2 reviewed as compatible (engines `node >=16.20.0`, CI green on Node 20/22, devDependency only) but left open for the maintainer's toolchain-major decision. Both status notes are recorded on the PRs themselves (#7, #10).

Maintenance run 2026-09-04: no CI failures in repository history (all 60 main + 42 PR runs green); CodeQL green on latest main; local `npm run typecheck`, `npm test` (58 passed), `npm run build`, and `npm pack --dry-run` all pass; no credential leakage found. P1.1 database-row ambiguity tests merged (PR #17).

Weekly maintainer/release review 2026-09-04: no release published — publication is maintainer-gated (D14, `AGENTS.md`, `docs/AUTOMATION.md`) and the automation environment holds no npm publish credentials. All safe preparation is complete (see M2.5 above). Upstream watch: stable `drizzle-orm@0.45.2`/`drizzle-kit@0.31.10` unchanged and still match `docs/COMPATIBILITY.md`; the v1 line (1.0.0-rc.4) is a separate compatibility track (versioned migration table with `name`/`applied_at`, `getMigrationsToRun` name-based skip in the async pg path, `drizzle-kit up` folder migration) — recorded under "Upstream watch" in `docs/COMPATIBILITY.md`, tracked by R2/Q6, not modeled yet.

Maintenance run 2026-09-05: M3 (safe clean replay on disposable PostgreSQL)
implemented on the thread branch — `replay` command (`src/replay.ts`),
`REPLAY_MIGRATION_FAILED`/`REPLAY_TARGET_NOT_EMPTY` findings, `replay` report
section pinned in `docs/OUTPUT_CONTRACT.md`, unit + integration + CLI-guard
tests (all 82 tests green locally against a real PostgreSQL 16 instance;
replay integration joins the CI `postgres-integration` job). Isolation model
chosen and recorded in `docs/DECISIONS.md` Q4: explicitly supplied disposable
target + `--confirm-destructive`; `replay` never reads `DATABASE_URL`. M3 merged
2026-09-05 (PR #21, squash `ebea403`); issue #2 closed as completed. M2
publication remains the next gate before M4 (GitHub Action distribution), which
still depends on a stable enough prerelease.

Maintenance run 2026-09-06: P1.7 filesystem/path error UX delivered —
`inspectMigrationRepository` now reports a journal that exists but cannot be
read as `REPO_JOURNAL_UNREADABLE` (no longer misreported as
`REPO_JOURNAL_INVALID_JSON`) and a referenced SQL file that exists but cannot
be read as `MIGRATION_SQL_UNREADABLE` (no longer an uncaught crash with exit
2). Unreadable migration input is always a finding with a hint and exit 1;
`docs/OUTPUT_CONTRACT.md` exit-2 wording clarified accordingly. Tests added
in `tests/repository.test.ts` and `tests/cli.test.ts` using deterministic
EISDIR fixtures; `docs/FINDINGS.md`, `CHANGELOG.md`, and
`docs/IMPROVEMENTS.md` (P1.7 marked delivered) updated. P1.6 large-history
guard delivered separately (`tests/scale.test.ts`: 2000-migration fixture,
~1s local, no algorithm change needed). Local typecheck, full
unit suite, build, and `npm pack --dry-run` green; main CI and CodeQL green.

Maintenance run 2026-09-06 (daily maintainer, follow-up): PR #23 (P1.7/P1.6)
merged to main as squash `be47f3d` — all required checks green (Node 20/22,
postgres integration, package smoke, CodeQL). Local verification on the new
main head: typecheck, 78 unit tests passed (11 skipped — DB integration
needs `TEST_DATABASE_URL`), build, and `npm audit --omit=dev` (0
vulnerabilities) all green; no credential leakage found (only 127.0.0.1 test
fixtures); all 56 PR-event CI runs in repository history green; CodeQL green
on latest main. Dependabot: commander 15 (#7) and typescript 7.0.2 (#10)
remain open with maintainer-deferred decisions recorded on the PRs; no change
this run. Issues: #5 and #18 are duplicate "release: prepare first npm
prerelease" tracking issues (both open; #18 carries the current M2 status) —
recommend closing #5 as the duplicate; the automation environment has no
issue-close capability, so this is a maintainer action. Issue #3 (GitHub
Action distribution, M4) remains queued behind the M2 publish decision.
No release published (maintainer-gated).

Maintenance run 2026-09-10: PR #27 (@types/node 26.4.0 → 26.4.1) merged as
squash `ec7b892`; main CI and CodeQL green on the new head. Thread branch
rebased onto `ec7b892`; local typecheck, 87 unit tests passed (11 skipped —
DB integration needs `TEST_DATABASE_URL`), build, and `npm pack --dry-run`
all green. PR #26 (M4 Action) has all checks green but is still in draft
state, so the GitHub API rejects merges (405); review comment left
documenting readiness pending a maintainer un-draft. PR #28 (vitest 4 → 5):
new finding — `npm view vitest@5.0.0 engines` declares
`node: ^22.12.0 || ^24.0.0 || >=26.0.0`, conflicting with locked D9 (Node 20
floor); must not merge while Node 20 is supported — review comment left
recommending closure (same category as commander 15, PR #7). PR #7 (commander
15) remains blocked on D9 (engines `node >=22.12.0`); PR #10 (typescript 7)
has no engines conflict (devDependency only, `node >=16.20.0`) but stays held
open per the maintainer's recorded toolchain-major deferral. M2 stays 🚧
solely for the maintainer-authorized publish step (D14); no release
published (maintainer-gated).

Maintenance run 2026-09-12: PR #30 (P1.2 actionable hints on all findings +
P1.4 missing-table limitation doc) merged as `5f7c25c`; PR #26 (M4 GitHub
Action distribution, first increment) un-drafted, rebased onto the new main,
and merged as `7d80ebf` — all 8 CI checks green on the merge head (CodeQL,
CI Node 20/22 + postgres-integration + package-smoke, Action smoke
repo/status modes). Post-merge main CI/CodeQL/Action-smoke runs green on
`7d80ebf`. M4 marked 🚧 (first increment) in `docs/MILESTONES.md`; P1.12/P1.13
marked delivered in `docs/IMPROVEMENTS.md`. Local note: `npm run typecheck`
clean and `npm run build` clean on the merge head; full `npm test` in this
sandbox shows all non-packaging tests green but `tests/packaging.test.ts`
(3 tests) times out at the default 5s vitest timeout — the sandbox runs
single-CPU and three suites each spawn `npm run build`/`npm pack`
concurrently, while the same file passes standalone (~11s) and all
packaging assertions pass in CI's `package-smoke` job; environment/resource
artifact, not a product regression. No release/tag published
(maintainer-gated, D14). Open Dependabot PRs unchanged: #7 (commander 15)
and #28 (vitest 5) blocked on locked D9 (Node 20 floor); #10 (typescript 7)
held per maintainer toolchain-major deferral. Open issues #3 (M4; first
increment now merged, release/tag still gated), #5/#18 (duplicate npm
prerelease trackers, maintainer-gated publish + open Q1 library-API
decision) need maintainer updates/closes — no issue-mutation capability in
the automation toolset.

Maintenance run 2026-09-13: P1.14 secret-pattern regression tests delivered
— new `tests/secret-regression.test.ts` (8 tests, dummy credential
`dd-p1-14-dummy-s3cret-pw` against an unreachable loopback target) asserts
no credential material in text/JSON stdout or stderr across the expected
CLI failure surface (`status` × `--database-url`/`DATABASE_URL` ×
text/JSON; `replay` × text/JSON; successful `repo --json` with a
credential-bearing environment; keyword/value-form redaction; direct
`readPostgresMigrationState`/`replayMigrations` connection-failure
messages). Live probing confirmed operational (exit 2) failures emit an
empty stdout, so `--json` cannot smuggle credentials through a report body.
P1.14 marked ✅ in `docs/IMPROVEMENTS.md`. Local verification:
`npm run typecheck` clean, `npm run build` clean, 102 unit tests passed
(11 skipped — DB integration needs `TEST_DATABASE_URL`,
`tests/packaging.test.ts` excluded — known single-CPU sandbox timeout
artifact, unchanged). Latest main CI/CodeQL runs green on `17c9599`. Open
Dependabot PRs #7 (commander 15) and #28 (vitest 5) stay blocked on locked
D9; #10 (typescript 7) stays held per maintainer deferral — none merged.
No release/tag published (maintainer-gated, D14).

Maintenance run 2026-09-14: PR #32 (P1.14, 8 secret-regression tests)
un-drafted, verified locally (typecheck clean, 8/8 new tests green), and
squash-merged as `827cffa` — post-merge main CI (run 85) and CodeQL (run 76)
green on the merge head. New work on the thread branch: CLI usage-error
hardening (M2.3/P1.3) — a bare invocation with no subcommand now reliably
shows usage on stderr with exit `2` instead of leaking commander's
`(outputHelp)` placeholder into stderr (previously only the
`commander.helpDisplayed` path was mapped while the bare-invocation
`commander.help` path fell through to a generic writer), pinned by a new
`tests/cli.test.ts` regression test asserting exit 2, empty stdout, usage
on stderr, and no placeholder text. `docs/MILESTONES.md` (M2.3 row),
`docs/IMPROVEMENTS.md` (P1.3 marked ✅ with per-row delivery mapping), and
`CHANGELOG.md` (Unreleased entry) updated. Local verification on the thread
head: `npm run typecheck` clean, `npx vitest run --exclude
tests/packaging.test.ts` 103 passed / 11 skipped (DB integration needs
`TEST_DATABASE_URL`; packaging excluded — same known single-CPU sandbox
timeout artifact), `npm run build` clean, `npm pack --dry-run` clean (43
files, `drizzle-doctor-0.1.0-alpha.1.tgz`). No finding code, severity,
report shape, or other exit changed (D7/D8 intact). No release/tag
published (maintainer-gated, D14). Upstream watch: `npm view` still shows
`drizzle-orm` stable `latest` at `0.45.2` (rc line at `1.0.0-rc.5-5935859`
under the `rc5` tag), matching `docs/COMPATIBILITY.md` — no drift, no doc
update needed.

Maintenance run 2026-09-14 (follow-up): PR #33 (M2.3/P1.3 CLI usage-error
hardening) un-drafted and squash-merged as `6866892` — post-merge main CI
(run 87), Action smoke (run 7), and CodeQL (run 78) green on the merge head.
Thread branch reset to the merge head; local validation on it: `npm run
typecheck` clean, `npx vitest run tests/cli.test.ts` 18/18 green, full unit
run `npx vitest run --exclude tests/packaging.test.ts` 103 passed / 11
skipped (DB integration needs `TEST_DATABASE_URL`; packaging excluded — same
known single-CPU sandbox timeout artifact), `npm run build` clean, `npm pack
--dry-run` clean (43 files). Upstream recheck: `drizzle-orm` stable `latest`
still `0.45.2`, pinned devDependency unchanged; v1 rc line active under rc
tags only — no compatibility drift. New fix this segment: README's
Machine-readable output section said `--json` applies to "`repo` or `status`"
only and its field table used "`repo`/`status`"-era "both" scoping — stale
since the M3 `replay` command landed. Updated the README wording and table to
all three commands (`command` = `"repo" | "status" | "replay"`, plus the
`replay`-only section row) so the README matches `docs/OUTPUT_CONTRACT.md`
and actual report shapes; docs-only, no product code touched, no finding
codes/severities/exits changed (D7/D8 intact). Release/tag still
maintainer-gated (D14; issues #3/#5/#18 untouched), Dependabot majors #7/#10
still deferred.

Maintenance run 2026-09-15: P1.5 compatibility metadata delivered on the
thread branch — every JSON report now carries a `metadata` object
(`toolVersion` from runtime `package.json`, `backend: "postgres"`,
`reportFormatVersion` mirroring `formatVersion`) plus
`migrationsSchema`/`migrationsTable` on `status`/`replay` from the resolved
snapshot/target only (omitted on `repo`, which never connects; no hosts,
URLs, or credentials — D11). Purely additive per the OUTPUT_CONTRACT
evolution policy, so `formatVersion` stays `1` (M5.2 "schema/version metadata
if needed" now satisfied). Changed: `src/types.ts` (`ReportMetadata`,
required `DoctorReport.metadata`, library-exported), `src/report.ts`
(builders emit metadata), tests (`tests/report-metadata.test.ts` new, 5
tests; key-list assertions in `tests/output-contract.test.ts` +
`tests/replay.test.ts`; `metadata` added to the `tests/action-summary.test.ts`
fixture), docs (`docs/OUTPUT_CONTRACT.md` `metadata` section + example +
stable-field row, `README.md` field table, `CHANGELOG.md` Unreleased entry,
P1.5 marked ✅ in `docs/IMPROVEMENTS.md`). Local verification:
`npm run typecheck` clean, full `npm test` with `TEST_DATABASE_URL`
**122/122 green across 18 files** (incl. integration), `npm run build`
clean, `npm pack --dry-run` clean (43 files), live CLI smoke confirms
`metadata` on `repo --json` (no location keys) and `status --json` (resolved
schema/table). No finding code, severity, exit, or text format changed
(D7/D8 intact). Upstream watch: `drizzle-orm` stable `latest` still
`0.45.2`, `drizzle-kit` `0.31.10` — no drift. PR #28 (vitest 5) stays blocked
on locked D9 (Node 20 floor); release/tag still maintainer-gated (D14).

Maintenance run 2026-09-16: maintainer published GitHub Pre-release
`v0.1.0-alpha.1` at commit `3d82576`. npm was **not** published. Docs
closeout (this line): ACTION.md / README recipes pin
`Duylamneuuu/drizzle-doctor@v0.1.0-alpha.1`; P2.1 copy-paste recipes;
CHANGELOG `[0.1.0-alpha.1]` expanded to the tagged tree; M2/M4 status
notes updated. Do not create `@v1`. Do not publish to npm.

Maintenance run 2026-09-16 (hardening follow-up): GitHub Pre-release
`v0.1.0-alpha.2` supersedes alpha.1 for source/Action consumers. It rejects
path-like journal tags, preserves original journal positions after malformed
metadata, and prevents composite Action input interpolation into Bash source.
npm remains unpublished; no moving `@v1` tag was created.

Do not jump directly to broad adapter support or feature expansion. The active sequence is:

1. M1 — validate v0.1 behavior and fixtures ✅
2. M2 — prerelease/package hardening
3. M3 — safe clean-replay capability ✅
4. M4 — GitHub Action distribution 🚧 (source + tag `v0.1.0-alpha.2`; npm and `@v1` still gated)
5. M5 — compatibility/policy hardening
6. M6+ — adapters only when justified by evidence

See `docs/MILESTONES.md` for gates and exact completion criteria.

## 5. Existing GitHub tasks

Open issues track the next major work:

- first npm prerelease preparation (#5) — milestone M2 (GitHub tag exists;
  npm still gated)
- GitHub Action packaging (#3) — milestone M4 (source + tag
  `v0.1.0-alpha.2` exist; moving `@v1` and npm remain maintainer-gated;
  do not close until the maintainer confirms)

The M1 validation issue (#1) is closed as completed; the M3 replay issue (#2)
is closed as completed via PR #21.

Issue #18 (created 2026-09-04) was a duplicate M2-checklist tracker of #5 and
was closed as a duplicate on 2026-09-16. Keep subsequent prerelease progress
and maintainer decisions in #5.

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
