# Agent Instructions

This repository is an open-source developer tool, not a hosted SaaS.

## Mandatory start here

Before making a non-trivial change, read:

1. `docs/AI_HANDOFF.md`
2. `docs/MILESTONES.md`
3. `docs/IMPROVEMENTS.md`
4. `docs/DECISIONS.md`
5. the task-relevant architecture/findings/security docs
6. the relevant source and tests

`docs/AI_HANDOFF.md` is the canonical operational handoff for autonomous coding agents. `docs/MILESTONES.md` defines sequencing and acceptance gates. `docs/IMPROVEMENTS.md` is a prioritized backlog, not permission to skip the active milestone. `docs/DECISIONS.md` records decisions an agent must not reopen incidentally and questions it must research rather than guess.

If no issue/task is assigned, select work using the task-selection rules in those documents. Prefer the first unblocked milestone gate over broad feature expansion.

## Product contract

`drizzle-doctor` diagnoses Drizzle migration integrity and state. The default/core behavior must remain deterministic and read-only.

Do not:

- apply or repair production migrations automatically
- mutate `meta/_journal.json`
- require an AI model at runtime
- send repository/database contents to external services
- log database credentials
- silently downgrade error findings to warnings
- add features primarily to increase project activity or breadth

## Source of truth

- `README.md` — user-facing product contract
- `docs/AI_HANDOFF.md` — current state, priorities, autonomous execution protocol
- `docs/MILESTONES.md` — detailed milestone gates and Definition of Done
- `docs/IMPROVEMENTS.md` — prioritized technical/quality backlog
- `docs/DECISIONS.md` — locked/provisional decisions and open research questions
- `docs/ARCHITECTURE.md` — internal boundaries and invariants
- `docs/FINDINGS.md` — finding semantics/API surface
- `docs/THREAT_MODEL.md` — security boundaries
- `docs/AUTOMATION.md` — cloud automation policy
- `docs/ROADMAP.md` — high-level planned direction, not a promise
- tests — executable behavior

When sources conflict, do not silently choose the convenient interpretation. Preserve safety and the public product contract, then document the conflict.

## Development rules

1. Prefer a small pure core and thin adapters.
2. Database adapters normalize framework state; comparison logic belongs in `src/analyze.ts`.
3. Finding codes are API surface. Avoid renaming released codes without a migration plan.
4. New behavior needs tests.
5. Keep Node 20+ compatibility unless a deliberate breaking decision is documented and approved.
6. Do not add runtime dependencies without a clear user-facing reason.
7. If behavior depends on Drizzle migration semantics, verify current upstream source before changing the model.
8. Prefer evidence from fixtures/integration tests over assumptions.
9. Do not introduce a generic abstraction until at least a second concrete backend/use case proves it is useful.
10. Keep normal output concise and never expose secrets.

Before proposing completion, run or ensure CI runs:

```bash
npm run typecheck
npm test
npm run build
```

For packaging changes also verify the packed artifact, ideally with `npm pack --dry-run` plus a tarball consumer smoke test.

## Definition of done

A task is complete only when:

- requested behavior is implemented
- important success/failure paths are tested
- relevant docs are updated
- supported CI is green or an external blocker is explicitly documented
- security/product invariants still hold
- no credentials, private fixtures, or generated local artifacts are committed
- any remaining risk/follow-up is stated clearly

## GitHub/automation work

For maintenance agents:

- prefer one focused PR per issue
- update changelog/docs for user-visible changes
- never create meaningless releases or activity-only commits
- do not merge failing CI
- do not publish to npm without an explicit maintainer-approved release task
- do not auto-merge major dependency upgrades merely because Dependabot opened them
- preserve the supported Node matrix when evaluating dependency upgrades

## Safety for replay work

Future clean-replay checks must target an isolated disposable database. Never infer that a database is disposable from its hostname alone; require an explicit execution mode and keep production URLs out of replay paths.

Replay must remain a separate opt-in capability. `repo` and `status` must not gain write behavior.

## Stop conditions requiring maintainer approval

Stop before:

- npm publication
- public release/tag creation intended as a release
- automatic migration repair/application
- adding telemetry or required hosted services
- removing Node 20 support
- intentionally breaking finding codes or documented machine output
- weakening an error solely to make CI/tests pass
- expanding into generic schema management
