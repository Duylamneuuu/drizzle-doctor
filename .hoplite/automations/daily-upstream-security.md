# Daily Automation 2 — Upstream & Security Watch (drizzle-doctor)

Scheduled daily autonomous run. Read `docs/AI_HANDOFF.md`, `docs/COMPATIBILITY.md`, `docs/THREAT_MODEL.md`, `docs/AUTOMATION.md`, `AGENTS.md`, and `CHANGELOG.md` first — they are the source of truth. The repo owner has authorized fully autonomous operation: merge your own pull requests once required CI is green.

## Scope

Watch upstream Drizzle behavior, security posture, and CI health. This automation deliberately does NOT do feature engineering, issue triage, or milestone work — those belong to Automation 1 (core maintainer) and Automation 3 (triage/docs). If you would start that kind of work, stop and leave it for them.

## Every run

1. CI health: check `main` CI runs and CodeQL. If broken, diagnose, fix, verify, leave green. Never paper over a failure.
2. Security status: CodeQL alerts, Dependabot alerts, `npm audit` (or `npm audit --omit=dev` scoped appropriately). Investigate anything real; create an issue with reproduction evidence before fixing if it is non-trivial.
3. Dependabot PRs: review each. Patch/minor with green CI and clear compatibility → merge. Major → inspect breaking changes (Node engine requirement vs the Node 20 floor, ESM/CJS behavior, output/report stability, integration tests), then merge with evidence, adapt code + docs if worthwhile, or close with explanation. Never auto-accept a major merely because Dependabot opened it.
4. Upstream Drizzle: compare current npm `drizzle-orm` release against the pinned devDependency (`drizzle-orm` exact version in `package.json`, verified semantics in `docs/COMPATIBILITY.md`, equivalence tests in `tests/upstream-semantics.test.ts`). If upstream changed migration semantics — journal format, hashing, created_at/high-watermark apply condition, migration table DDL/defaults, breakpoint handling, new runtimes:
   1. reproduce the change against the real package,
   2. update `tests/upstream-semantics.test.ts` so it still asserts equivalence,
   3. update `docs/COMPATIBILITY.md` (version/date/URLs, finding mapping, upgrade checklist),
   4. only then adjust detection logic, deliberately and documented.
   Never preserve an outdated assumption just because existing tests expect it. Do not bump the pinned version as routine housekeeping without semantic review.
5. Credential hygiene: scan the diff/repo state for stray credentials or connection strings; verify no test output or docs leak `DATABASE_URL` values. If found, remove and note the audit.
6. Packaged-artifact integrity (supports M2): run `npm pack --dry-run` and verify the tarball contains only `dist`, `README.md`, `LICENSE`, `package.json`; no tests, fixtures, secrets, or local artifacts.

## Execution rules

- Verification before merging anything: `npm run typecheck`, `npm test`, `npm run build`; integration tests for PostgreSQL changes.
- One focused PR per change; meaningful title; changelog entry for user-visible behavior.
- Do not manufacture activity: if nothing warrants a change, report a quiet, verified state.

## End-of-run report

Concise: CI health, security summary (alerts reviewed/actioned), dependency changes merged/closed, upstream findings (release diff vs pinned, semantics unchanged/changed), credential scan result, next watch item.

## Stop gates (ask maintainer)

npm publication, release tags, telemetry, paid services, dropping Node 20, breaking finding-code/JSON surface, weakening read-only guarantees, destructive database interaction.
