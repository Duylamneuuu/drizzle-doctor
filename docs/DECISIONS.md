# Product and Engineering Decisions

This file prevents agents from repeatedly reopening decisions that are already part of the project contract.

A **locked** decision should not be changed incidentally inside an unrelated task. A **provisional** decision may change when new evidence appears, but the change should be deliberate and documented.

Last reviewed: 2026-09-02.

## Locked decisions

### D1 — This is an OSS developer tool, not a hosted SaaS

Core functionality must run locally/CI without an account, model API, or hosted dashboard.

### D2 — Read-only is the default product boundary

`repo` reads migration files. `status` reads migration metadata from PostgreSQL. Neither applies migrations or repairs production state.

Write behavior, if any, belongs to a clearly separate opt-in feature such as disposable clean replay.

### D3 — The first supported database semantics are PostgreSQL Drizzle migrations

Do not claim generic database support from a PostgreSQL implementation. Other backends need their own upstream semantic review and tests.

### D4 — The core is deterministic and does not require AI

AI may help develop the repository, but user runtime behavior must not depend on a model deciding whether migration history is safe.

### D5 — Comparison policy stays out of thin database adapters

Database adapters read/normalize state. The analyzer decides what that state means.

### D6 — High-watermark skip hazards are first-class errors

A local migration missing from the DB at a timestamp behind/equal to the database migration high-watermark is not ordinary pending work under the modeled Drizzle PostgreSQL semantics.

Do not downgrade this class merely to reduce noise without new upstream evidence.

### D7 — Finding codes are user-facing API once released

Codes should be stable, documented and tested. Renaming/reinterpreting released codes requires a compatibility plan.

### D8 — Exit codes are intentional automation surface

- `0`: completed with no error-level findings
- `1`: completed and found error-level migration problems
- `2`: command could not complete

Do not collapse operational failure and detected migration failure into one meaning.

### D9 — Node 20+ compatibility is currently part of the contract

Dependency upgrades that require newer Node versions must not be merged casually. Removing Node 20 support requires an explicit product decision.

### D10 — Replay must be isolated and explicit

A future replay command must not implicitly reuse ordinary status credentials or infer safety from a hostname. It must target a disposable environment through explicit semantics.

### D11 — No credential logging

Database URLs/passwords must not appear in normal reports, JSON, stderr diagnostics, CI summaries or debug artifacts.

### D12 — No automatic production repair

The tool diagnoses. It may explain what to inspect, but it does not silently rewrite journal history, delete DB migration rows, or execute a guessed fix.

### D13 — Adapter breadth is demand-driven

Do not add SQLite/MySQL/D1/Turso/etc. simply to increase the feature list. Add a backend when there is a concrete migration-state problem and verified Drizzle semantics to support.

### D14 — Releases are evidence-driven

Do not create npm/GitHub releases for activity. A release should correspond to coherent tested user value. Publication requires maintainer authorization.

## Provisional decisions

These are current choices, but can change through a focused task with evidence.

### P1 — Commander remains the CLI parser

Keep while it serves the small CLI well and supports the Node contract. Do not upgrade to a major version that changes Node requirements without evaluating the compatibility impact.

### P2 — PostgreSQL uses `pg`

Keep the adapter simple. A replacement needs a concrete benefit such as reduced runtime weight, safer behavior, or compatibility—not novelty.

### P3 — Text and JSON reporters are both first-class

Human output should be concise; JSON should be deterministic and automation-friendly.

### P4 — README + Markdown docs are enough for now

Do not add a documentation framework until navigation/discoverability becomes a real problem.

### P5 — No configuration file yet

CLI flags/environment variables are sufficient at current scope. Add config only when repeated policies/options justify it.

## Open questions — agents may research, not assume

### Q1 — Should the package expose a supported programmatic library API?

Current package metadata exports a library entry. Before stable release, decide whether this is intentional API or should remain CLI-focused.

Evidence needed:

- real integration use cases
- package import smoke tests
- clear stable export surface

### Q2 — Should JSON have an explicit format version?

Likely useful before external automation grows, but define it only with a documented evolution policy.

### Q3 — What is the safest long-term credential input UX?

`DATABASE_URL` is conventional. `--database-url` is convenient but may expose secrets in shell history/process lists. Research user workflows before adding more mechanisms.

### Q4 — How should clean replay obtain PostgreSQL?

Options include tool-managed ephemeral infrastructure or an explicitly supplied disposable database. Choose based on portability, safety and CI usability.

### Q5 — What should the first reusable GitHub Action distribution model be?

Decide packaging/version pinning only after the npm/package surface is validated.

### Q6 — Which Drizzle versions should be claimed as supported?

Do not guess a broad range. Build the compatibility matrix from current upstream review, fixtures and real reports.

### Q7 — What is the next backend after PostgreSQL?

No answer is locked. Let repeated user issues determine priority.

## Decision-change procedure

When changing a locked/provisional decision:

1. state the old decision
2. state the new evidence/problem
3. describe compatibility and security impact
4. update relevant tests/docs in the same PR
5. add changelog/migration notes if users are affected
6. get maintainer approval for breaking, destructive, publication or telemetry changes

Do not let a dependency update or refactor silently make a product decision on behalf of the project.
