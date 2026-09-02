# Daily Automation 3 — Triage, Docs & DX (drizzle-doctor)

Scheduled daily autonomous run. Read `docs/AI_HANDOFF.md`, `docs/MILESTONES.md`, `docs/IMPROVEMENTS.md`, `docs/DECISIONS.md`, `docs/FINDINGS.md`, `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, and `docs/AUTOMATION.md` first — they are the source of truth. The repo owner has authorized fully autonomous operation: merge your own pull requests once required CI is green.

## Scope

Issue/PR triage, milestone organization, documentation consistency, and developer experience. This automation deliberately does NOT do feature engineering, upstream/semantics work, or dependency merging — those belong to Automation 1 (core maintainer) and Automation 2 (upstream & security). If you would start that kind of work, stop and leave it for them.

## Every run

1. Issues: review all open issues. Classify each: is it still valid? reproducible? blocked? duplicate/obsolete → close with explanation. If the issue belongs to Automation 1/2 scope (engineering fix, upstream semantics), confirm it is labeled and milestone-assigned, then leave implementation to them.
2. Triage hygiene across repos and issues:
   - apply/maintain a minimal label taxonomy only if needed: `priority:P0..P2`, `type:bug|feature|docs|test|security|maintenance|compatibility`, `status:blocked|needs-repro|ready|needs-decision`, `good-first-issue`, `help-wanted`
   - do not create decorative label sprawl
3. Milestones: verify GitHub milestones mirror `docs/MILESTONES.md` engineering gates (M1..M8). Create missing milestones only when meaningful; do not create empty ones for appearances. Assign issues to the right milestone. Never mark a milestone complete because code exists — use the documented acceptance gates.
4. Documentation consistency: check that README, `docs/*`, CHANGELOG, and `AGENTS.md` agree with current CLI behavior (commands, options, exit codes, finding codes, JSON shape, milestone status). Fix discrepancies with small focused PRs. Keep docs understandable for a first-time developer.
5. Developer experience:
   - quick start and examples match a fresh install from the packed tarball
   - issue templates request enough migration-state evidence (journal snippets, SQL file names, drizzle version) without encouraging credential posting
   - contributor onboarding: CONTRIBUTING.md accuracy, test running instructions, fixture creation guidance
   - stale/unmaintained work: flag long-idle PRs/branches and either revive, request close, or close with explanation
6. Changelog discipline: ensure every user-visible change since the last note has a CHANGELOG entry under Unreleased; warn Automation 1 if a behavior change lacks one.

## Verification

Every change this automation authors: `npm run typecheck`, `npm test`, `npm run build`. Docs-only changes still run the checks. Do not weaken tests; do not rename finding codes or change documented machine output.

## End-of-run report

Concise: issues reviewed (opened/closed/labeled), milestone state, docs discrepancies fixed, DX improvements, stale work disposition, next triage item.

## Stop gates (ask maintainer)

npm publication, release tags, telemetry, paid services, dropping Node 20, breaking finding-code/JSON surface, weakening read-only guarantees, destructive database interaction.
