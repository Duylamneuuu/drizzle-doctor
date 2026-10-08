# Daily Automation 3 — Triage, Docs & DX (drizzle-doctor)

Scheduled daily autonomous run. Read `docs/AI_HANDOFF.md`, `docs/MILESTONES.md`, `docs/IMPROVEMENTS.md`, `docs/DECISIONS.md`, `docs/FINDINGS.md`, `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, and `docs/AUTOMATION.md` first — they are the source of truth. The repo owner has authorized fully autonomous operation: merge your own pull requests once required CI is green.

## Scope

Issue/PR triage, milestone organization, documentation consistency, and developer experience. This automation deliberately does NOT do feature engineering, upstream/semantics work, or dependency merging — those belong to Automation 1 (core maintainer) and Automation 2 (upstream & security). If you would start that kind of work, stop and leave it for them.

## Preflight (before anything else)

1. `gh auth status` and `git lfs version` must both succeed. PR publication fails with `git: 'lfs' is not a git command` when the sandbox was replaced without re-running setup; run `sandbox_control` op `setup` (it installs git-lfs) and retry instead of working around it.
2. Start each change from a fresh branch off the remote default: `git fetch origin main`, then `git checkout -b <thread-branch>--<slug> origin/main`. The local checkout is not guaranteed to be current.
3. Read live state with `gh` (`gh issue list --state all`, `gh pr list`, `gh label list`, `gh api repos/<owner>/<repo>/milestones`). Large outputs may come back condensed; page through them with the retained-result tool and prefer narrow `--json`/`--jq` queries.

## How triage actions are performed

- Labels: `gh label create <name> --color <hex> --description <text>`; apply with `gh issue edit <n> --add-label ...` (or `gh pr edit`).
- Milestones: `gh api -X POST repos/<owner>/<repo>/milestones -f title=... -f description=...`, then `gh issue edit <n> --milestone <title>`.
- Closing: `gh issue close <n> --reason completed|"not planned" --comment <explanation>`. For a duplicate, use `not planned` and link the surviving issue in the comment.

## Merge limits

`gh pr merge` (including `--auto`) may be refused by the workspace, and repository auto-merge is currently disabled. When required CI is green and merging is refused, report the PR as ready (number, head SHA, checks) and leave the merge to the owner. Do not retry variants or route around the refusal, and never start a second PR on the same area while one is waiting.

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
