# Automation policy

This project is designed to be maintainable with cloud coding agents, but automation exists to improve the software — not to manufacture activity.

## Allowed autonomous work

A maintenance agent may:

- inspect open issues and recent CI failures
- reproduce a reported bug with synthetic fixtures
- create a focused branch and implementation
- add or improve tests
- update documentation and the changelog for user-visible behavior
- open a pull request with verification evidence
- review dependency updates for compatibility
- improve examples, diagnostics, and contributor ergonomics

## Human-gated work

Do not autonomously:

- publish to npm
- create a GitHub release/tag
- merge a behavior-changing PR solely because its own tests pass
- change the Node support floor
- weaken a finding severity or read-only guarantee
- add telemetry/network calls
- add an AI/runtime service dependency
- introduce destructive database behavior

These require an explicit maintainer task/approval.

## Suggested maintenance loop

1. Check `main` CI and security scans.
2. Read open issues and choose one real, bounded problem.
3. Confirm it is still reproducible against the current code and relevant Drizzle behavior.
4. Implement the smallest complete fix/feature.
5. Run typecheck, tests, build, and relevant integration tests.
6. Update tests/docs/changelog.
7. Open a focused PR; do not bundle unrelated cleanup.
8. Wait for CI/review rather than generating another PR for the same area.

## Priority order during pre-alpha

1. Correctness / false-positive fixes
2. Real-world fixture validation
3. PostgreSQL migration-state coverage
4. Clean replay isolation
5. GitHub Action distribution
6. Additional adapters only after demonstrated demand

## Dependency updates

Patch/minor updates can be routine when compatibility and CI are clean. Major updates require explicit review of:

- Node engine requirements
- ESM/CJS behavior
- CLI behavior
- JSON/report stability
- integration tests

Do not raise the supported Node version just to make a dependency PR easier to merge.

## Evidence expected in an automated PR

Include:

- issue/reproduction being addressed
- files/behavior changed
- commands/tests run
- any upstream Drizzle assumption relied upon
- false-positive or compatibility risk

## Release rule

A release must represent useful software change or a justified fix. Never create releases, commits, issues, or social posts merely to make the repository look active.
