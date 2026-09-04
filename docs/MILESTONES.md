# Engineering Milestones

This file is the detailed execution plan for `drizzle-doctor`. It is more operational than `docs/ROADMAP.md`.

Agents should work top-to-bottom unless an issue explicitly changes priority. A later milestone must not be used to bypass an earlier quality or safety gate.

## Status legend

- ✅ complete
- 🚧 active / partially complete
- ⏳ blocked by an earlier milestone or evidence
- 💡 optional, demand-driven

---

## M0 — Foundation and safety baseline ✅

### Goal

Create a small, deterministic, read-only tool with enough structure to validate the core migration-state hypothesis.

### Delivered

- TypeScript CLI and package structure
- local Drizzle migration repository reader
- journal validation
- SQL file SHA-256 hashing
- PostgreSQL read-only state adapter
- pure local/database analyzer
- text and JSON reporting
- deterministic exit codes
- unit/integration CI
- security, automation, architecture and contributor documentation
- CodeQL and dependency update automation

### Exit gate

M0 is considered complete as long as future changes preserve the invariants in `AGENTS.md` and `docs/ARCHITECTURE.md`.

---

## M1 — Validate v0.1 against realistic Drizzle histories ✅

### Why this comes first

The current implementation is useful only if its model of Drizzle migration history matches real repositories and current upstream behavior. This milestone converts an implementation hypothesis into evidence.

### Delivered

- M1.1 synthetic fixture suite covering all listed states, asserting exact finding codes, severities, summary counters, and exit behavior (`tests/m1-matrix.test.ts`, `tests/cli.test.ts`)
- M1.2 upstream semantics verified against the pinned npm-published `drizzle-orm@0.45.2` (hash, journal, high-watermark apply condition, migration table defaults); equivalence asserted in `tests/upstream-semantics.test.ts`, details in `docs/COMPATIBILITY.md`
- M1.3 purposes-built representative migration history with realistic journal metadata (`version`/`dialect` fields, epoch-ms timestamps, statement breakpoints)
- M1.4 false-positive review documented per error finding in `docs/COMPATIBILITY.md`
- CLI exit-code correction: invalid invocations (unknown command/option) now exit `2` instead of `1`, matching the documented contract; `--version` derives from `package.json`

### Detailed deliverables (reference)

#### M1.1 Synthetic fixture suite

Create explicit fixtures for at least:

1. empty/new project
2. one clean applied migration
3. multiple clean applied migrations
4. ordinary pending migration newer than DB high-watermark
5. missing DB migration whose local timestamp is older than/equal to DB high-watermark
6. edited SQL for an already-applied migration
7. database-only migration row
8. missing referenced SQL file
9. orphan SQL file
10. duplicate journal index
11. duplicate journal tag
12. duplicate timestamp
13. non-monotonic journal timestamps
14. custom migration schema/table
15. migration SQL containing statement breakpoints

Each fixture must assert the expected finding code(s), severity, and exit behavior.

#### M1.2 Current Drizzle semantic check

Compare the project assumptions against current upstream Drizzle source:

- how migration SQL files are read
- how their hashes are computed
- how PostgreSQL migration rows are stored
- how the migration high-watermark is selected
- the exact condition used to decide which migrations are applied
- default migration schema/table behavior

If upstream semantics changed, update tests/docs first and then adjust the implementation deliberately.

#### M1.3 Representative real-world validation

Validate against public or purpose-built Drizzle projects that represent normal generated histories.

Rules:

- do not copy private application data into fixtures
- do not depend permanently on mutable external repositories for core tests
- extract only minimal reproducible fixture shapes where licensing permits
- document any compatibility assumption discovered

#### M1.4 False-positive review

For every error-level finding, answer:

- can a legitimate workflow produce this state?
- if yes, should it remain error, become warning, or be explicitly allowlisted later?
- can the tool explain the state without implying more certainty than it has?

Do not weaken findings simply to eliminate an inconvenient test case.

### Acceptance criteria

M1 is complete when:

- all required fixture classes have deterministic assertions
- current Drizzle PostgreSQL semantics are documented and covered by tests
- normal generated migration histories pass without error findings
- known hazardous histories fail with the intended finding codes
- no database credentials or private fixtures are committed
- Node 20 and Node 22 CI pass
- PostgreSQL integration CI passes

### Evidence to leave behind

- fixture tests
- compatibility notes in docs
- issue/PR summary listing upstream references checked
- changelog entry if behavior changed

---

## M2 — Package and prerelease hardening 🚧

Depends on: M1.

### Goal

Make the CLI installable and predictable for early external users without pretending the API is mature.

### Required deliverables

#### M2.1 Reproducible dependency install ✅

- `package-lock.json` is committed and both CI jobs install with `npm ci` (Node 20/22 matrix)
- README development quick start documents the reproducible install path

#### M2.2 Package surface verification ✅

- `tests/packaging.test.ts` asserts the build produces a working shebang, the bin target resolves, the packed tarball contains only intended files (no tests/src/secrets), and the library export loads
- CI `package-smoke` job installs the produced tarball into a temporary consumer directory and runs the installed `drizzle-doctor` binary (`--help`, `--version`, `repo --json` against a real fixture)

#### M2.3 CLI behavior hardening

Cover at minimum:

- helpful `--help` ✅ (`tests/cli.test.ts`)
- helpful `--version` ✅ (`tests/cli.test.ts`, derives from `package.json`)
- invalid argument behavior ✅ (unknown command/option exit `2`)
- missing migration folder ✅ (missing journal finding, exit `1`)
- malformed journal ✅ (`tests/m1-matrix.test.ts`)
- database connection failure ✅ (exit `2`, sanitized message; `tests/cli.test.ts`)
- missing migration table ✅ (`DATABASE_MIGRATIONS_TABLE_MISSING` info finding)
- custom migration schema/table ✅ (integration coverage + `JOURNAL_INDEX_SEQUENCE`-style fixtures)
- text/JSON mode parity ✅ (both reporters covered by CLI tests)
- no credential echoing in errors ✅ (`tests/sanitize.test.ts`, `tests/cli.test.ts` D11 leak test)

#### M2.4 Output contract ✅

Delivered: `docs/OUTPUT_CONTRACT.md` defines exit codes, command identity,
report/finding/summary field shapes, optional-field rules, and stable vs
provisional fields; a `formatVersion: 1` field identifies the report shape and
the document defines the evolution policy (additive changes keep the version,
breaking changes bump it). `tests/output-contract.test.ts` pins the documented
shape and `tests/cli.test.ts` asserts the exit-code/`ok` relationship.

Before prerelease, document:

- exit codes ✅
- finding object fields ✅
- command-level JSON shape ✅
- which fields are stable vs provisional ✅

Prefer additive future changes ✅ (evolution policy).

#### M2.5 npm prerelease preparation ✅ (fully prepared 2026-09-04)

Prepare, but do not publish without explicit maintainer authorization
(D14, `AGENTS.md` stop conditions). All preparation items are done:

- package name availability/ownership check ✅ — `drizzle-doctor` is not
  taken on the npm registry (checked 2026-09-04); no ownership conflict
- version choice ✅ — `0.1.0-alpha.1` (package.json + lockfile bumped;
  `--version` derives from package.json)
- changelog entry ✅ — `CHANGELOG.md` `[0.1.0-alpha.1]` section prepared
- `npm pack --dry-run` ✅ — tarball contains only `dist/`, `README.md`,
  `LICENSE`, `package.json` (35 files, 18.0 kB)
- install-and-smoke-test from tarball ✅ — CI `package-smoke` job installs
  the tarball in a consumer project and runs `--help`, `--version`,
  `repo --json`; local CLI runs against a real fixture match the README
  examples and `docs/OUTPUT_CONTRACT.md`
- provenance/Trusted Publishing plan ✅ (recommendation, not a decision) —
  prefer `npm publish --provenance` from the GitHub Actions workflow on a
  tagged commit: npm provenance via OIDC avoids a long-lived publish token.
  Final choice and the publication itself are the maintainer's

### Acceptance criteria

- M1 complete ✅
- lockfile committed ✅
- clean checkout can install/test/build reproducibly ✅
- packed tarball smoke test succeeds ✅
- documented CLI examples match actual behavior ✅ (verified 2026-09-04)
- CI green ✅
- no release is published automatically ✅ (publication is maintainer-gated)

All pre-publication criteria hold; the milestone stays 🚧 only because the
final npm publish / release-tag step requires maintainer authorization.

---

## M3 — Safe clean replay on disposable PostgreSQL ⏳

Depends on: M1. Prefer M2 package hardening first, but implementation may begin earlier on a feature branch.

### Goal

Answer a different question from `status`: can the full local migration history replay from zero on a fresh PostgreSQL database?

### Product boundary

Replay is **not read-only**, therefore it must be isolated from normal `status` behavior and must never silently target production.

### Required deliverables

#### M3.1 Explicit replay command

Proposed UX:

```bash
drizzle-doctor replay --migrations ./drizzle ...
```

The command must be visibly distinct from `repo` and `status`.

#### M3.2 Isolation strategy

Choose one supported model and document it clearly:

- tool-managed ephemeral PostgreSQL, or
- explicitly supplied disposable test database with an affirmative destructive-mode flag

A hostname pattern alone is not proof that a database is disposable.

Never reuse a normal `DATABASE_URL` implicitly for replay.

#### M3.3 Replay engine

- replay migrations in journal order
- respect Drizzle statement breakpoints/semantics that affect execution
- stop at first failing migration when appropriate
- capture migration tag and statement index where reliable
- sanitize database errors
- clean up tool-managed ephemeral resources

#### M3.4 Result model

Text and JSON output should identify:

- pass/fail
- number of migrations attempted
- first failing migration
- statement index where meaningful
- sanitized database error category/message
- cleanup outcome if the tool manages the database

### Required tests

- successful replay
- SQL syntax failure
- dependency/order failure
- failure mid-migration
- custom migration folder
- cancellation/cleanup path where feasible
- safety guard preventing accidental reuse of ordinary status credentials

### Acceptance criteria

- replay cannot start without explicit disposable-target semantics
- no credentials appear in output
- successful histories replay deterministically
- failures identify the earliest useful location
- `repo` and `status` remain usable without replay infrastructure
- threat model updated
- CI integration coverage passes

---

## M4 — GitHub Action distribution ⏳

Depends on: stable enough M2 prerelease and M1 validation.

### Goal

Make the useful checks easy to add to a repository without requiring a custom CI script.

### Modes

1. repository-only audit — no database secret
2. opt-in status audit — read-only DB credentials
3. later opt-in replay — only after M3 safety model is mature; do not include by default

### Required deliverables

- Action metadata/wrapper
- pinned or immutable dependencies where practical
- example workflow
- concise job summary
- error annotations where they improve usability
- JSON artifact/output if useful for machines
- least-privilege database credential guidance

### Security requirements

- never print DB URLs
- do not run privileged code from untrusted PR context with secrets
- document safe event choices
- avoid mutable remote scripts
- keep permissions minimal

### Acceptance criteria

- example consumer repository/workflow succeeds
- repository-only mode requires no secrets
- status mode works with read-only DB credentials
- findings are visible without digging through raw logs
- Action release/versioning strategy is documented

---

## M5 — Compatibility and policy hardening ⏳

Depends on: real usage from M1–M4.

### Goal

Turn implicit assumptions into explicit compatibility and policy surfaces.

### Workstreams

#### M5.1 Drizzle compatibility matrix

Track tested combinations of:

- Drizzle ORM versions/ranges
- Drizzle Kit generated journal shapes when relevant
- Node versions
- PostgreSQL versions used in CI/validation

Do not claim support solely because compilation succeeds.

#### M5.2 Stable finding schema

- treat published finding codes as API
- document severity semantics
- add schema/version metadata to machine output if needed
- provide migration notes for breaking changes

#### M5.3 Intentional divergence policy

Only if real users need it, design an allowlist that requires:

- exact finding/migration target
- human-readable rationale
- optional expiry/review date

Do not create a blanket `--ignore-errors` switch that defeats the tool.

#### M5.4 Better historical divergence detection

Investigate:

- rewritten timestamps
- reordered historical journal entries
- migration identity ambiguity
- duplicate database timestamps/rows

Add checks only when they have a clear interpretation and low false-positive risk.

### Acceptance criteria

- compatibility claims are evidence-backed
- machine-readable output has a documented evolution policy
- any suppression mechanism is targeted and auditable

---

## M6 — Additional backend adapters 💡

Depends on: concrete user demand and a proven core.

### Candidate order

Prioritize by repeated real issues, not popularity alone.

Possible targets:

- SQLite
- libSQL/Turso
- Cloudflare D1
- MySQL
- provider-specific PostgreSQL guidance where generic PostgreSQL is insufficient

### Adapter rule

Before implementing a backend, document its actual Drizzle migration semantics. Do not force fundamentally different behavior into the PostgreSQL analyzer.

### Acceptance criteria for each adapter

- upstream behavior documented
- normalized state model defined
- fixtures cover backend-specific edge cases
- existing backends do not regress
- user demand or a concrete reproducible problem is linked

---

## M7 — Adoption and developer experience 💡

Depends on: a usable prerelease.

### Goal

Improve adoption without turning development into marketing-driven feature inflation.

Potential work:

- copy-paste CI recipes
- framework examples
- clearer diagnostics with remediation guidance
- fixture generator for bug reports
- minimal debug bundle that excludes secrets
- documentation site only if README/docs become hard to navigate
- issue templates that request enough migration-state evidence

### Success evidence

Prefer signals such as:

- distinct repositories using the CLI/Action
- reproducible external bug reports
- repeated requests for the same feature/backend
- external contributors

Stars/download counts are secondary signals, not correctness evidence.

---

## M8 — Mature release and maintenance policy 💡

### Goal

Define how the project remains trustworthy after early experimentation.

Potential deliverables:

- support window for Node versions
- compatibility release policy
- deprecation process for findings/options
- signed/provenance-enabled releases
- changelog discipline
- release checklist automation that still requires maintainer approval
- security response workflow

### Rule

Do not create release cadence for its own sake. Release when there is a coherent, tested user-facing improvement or fix.

---

# Cross-milestone quality gates

Every milestone must preserve these gates.

## Correctness gate

- behavior corresponds to documented Drizzle semantics
- important edge cases have tests
- no known false-safe result is accepted casually

## Safety gate

- normal database inspection remains read-only
- secrets are not logged
- destructive behavior is opt-in and isolated

## Compatibility gate

- Node support is deliberate
- finding/JSON changes are reviewed as API changes
- package changes are smoke-tested from the actual tarball

## Scope gate

Reject or defer work that mainly increases breadth without improving a demonstrated user problem.

# Agent task selection when no issue is assigned

Use this order:

1. unfinished acceptance criterion in the active milestone
2. P0 item in `docs/IMPROVEMENTS.md`
3. P1 item that directly helps the active milestone
4. documentation/test gap discovered while completing the above

Do not start M6 adapters while M1/M2 remain unproven unless the maintainer explicitly asks for that adapter.
