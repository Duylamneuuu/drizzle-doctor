# Contributing

Thanks for helping improve `drizzle-doctor`.

## Before opening a PR

1. Check existing issues/PRs for overlapping work.
2. Keep the core deterministic and useful without an AI model or hosted SaaS.
3. Preserve the read-only safety boundary unless a proposal explicitly changes the product contract.
4. Add or update tests for behavior changes.
5. Run:

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Development

```bash
npm install
npm run dev -- repo --migrations ./path/to/drizzle
```

For PostgreSQL integration tests:

```bash
TEST_DATABASE_URL='postgres://...' npm test
```

The integration tests create and drop only the `drizzle_doctor_test` schema in the supplied test database. Do not point test commands at production.

## Pull requests

A good PR should include:

- the problem being solved
- the intended behavior
- tests or fixtures that demonstrate it
- documentation for user-visible changes
- no unrelated refactors

Small adapters and isolated checks are intentionally welcome contribution surfaces.

## Commit/release discipline

- Avoid editing already-published migration examples in a way that changes the scenario they document.
- Keep finding codes stable once released; CI users may depend on them.
- Breaking CLI/JSON changes require a changelog entry and semver consideration.

## Adding a database adapter

Adapters should expose normalized migration rows to the core analyzer rather than duplicating comparison logic. New adapters must document:

- migration table defaults
- how the framework decides whether a migration is pending
- edge cases that can create silent skips/divergence
- integration-test strategy

## Security

See [`SECURITY.md`](SECURITY.md). Never include real credentials or database dumps in an issue or fixture.
