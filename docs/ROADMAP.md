# Roadmap

This roadmap describes intended direction, not release promises. Real user reports should be allowed to change priorities.

## v0.1 — migration integrity baseline

- [x] TypeScript CLI skeleton
- [x] local journal/SQL audit
- [x] Drizzle-compatible SQL SHA-256 hashing
- [x] read-only PostgreSQL migration-state reader
- [x] detect pending vs applied migrations
- [x] detect database-only history
- [x] detect hash mismatches
- [x] detect high-watermark skip hazards
- [x] text + JSON reporters
- [x] CI + integration test against PostgreSQL
- [ ] validate against real-world Drizzle fixture repositories
- [ ] publish first npm prerelease

## v0.2 — clean replay

Goal: prove that a fresh database can consume the full migration history in order.

- ephemeral PostgreSQL replay runner
- explicit isolation guardrails
- identify the first failing migration/statement
- CI-friendly summary and JSON result
- no dependency on a hosted SaaS

## v0.3 — GitHub-native distribution

- packaged GitHub Action
- PR/job summary
- opt-in annotations for error findings
- examples for common Drizzle workflows
- documented least-privilege database credentials for status checks

## v0.4 — history/policy hardening

- stable finding-code registry
- configurable severity policy
- intentional-divergence allowlist with rationale/expiry
- stronger detection of rewritten timestamps/history
- compatibility matrix for supported Drizzle versions

## v0.5+ — adapters based on real demand

Candidates:

- SQLite / libSQL / Turso
- Cloudflare D1
- MySQL
- Neon/Supabase-specific guidance when generic PostgreSQL behavior is insufficient

Adapters should be added because users encounter a concrete migration-state problem, not to inflate the feature list.

## Non-goals

- a schema migration framework that replaces Drizzle
- a hosted dashboard required for core functionality
- automatic production repair
- AI-generated migration decisions at runtime
- arbitrary database schema diffing unrelated to Drizzle migration history

## Adoption checkpoints

Before investing in broad adapters, look for evidence such as:

- distinct repositories running the CLI/Action
- issues that reproduce real migration-history failures
- external contributors adding checks/adapters
- repeated requests for the same backend

If the project receives no meaningful external usage after a sustained public trial, narrow or stop rather than manufacturing release activity.
