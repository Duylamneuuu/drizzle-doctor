# Agent Instructions

This repository is an open-source developer tool, not a hosted SaaS.

## Product contract

`drizzle-doctor` diagnoses Drizzle migration integrity and state. The default/core behavior must remain deterministic and read-only.

Do not:

- apply or repair production migrations automatically
- mutate `meta/_journal.json`
- require an AI model at runtime
- send repository/database contents to external services
- log database credentials
- silently downgrade error findings to warnings

## Source of truth

- `README.md` — user-facing product contract
- `docs/ARCHITECTURE.md` — internal boundaries and invariants
- `docs/ROADMAP.md` — planned scope, not a promise of implementation
- tests — executable behavior

## Development rules

1. Prefer a small pure core and thin adapters.
2. Database adapters normalize framework state; comparison logic belongs in `src/analyze.ts`.
3. Finding codes are API surface. Avoid renaming released codes without a migration plan.
4. New behavior needs tests.
5. Keep Node 20+ compatibility unless a deliberate breaking decision is documented.
6. Do not add runtime dependencies without a clear user-facing reason.

Before proposing completion, run or ensure CI runs:

```bash
npm run typecheck
npm test
npm run build
```

## GitHub/automation work

For maintenance agents:

- prefer one focused PR per issue
- update changelog/docs for user-visible changes
- never create meaningless releases or activity-only commits
- do not merge failing CI
- do not publish to npm without an explicit maintainer-approved release task

## Safety for replay work

Future clean-replay checks must target an isolated disposable database. Never infer that a database is disposable from its hostname alone; require an explicit execution mode and keep production URLs out of replay paths.
