# Adopt the shared agent-workflow skills

## Context

Three repos run the same agent loop written three different ways. The best of all three now lives in
`ismailir10/agent-workflow`: five tool-neutral skills (`working-principles`, `spec`, `build`, `verify-local`, `ship`)
that each repo vendors with `scripts/sync-agent-workflow.sh`. Talib's own `spec`/`build`/`ship` skills mixed generic
procedure with Talib-specific steps (worktree setup, UAT reports, standards dispatch, verification routes, the staging
check, promotion). This cycle replaces them with the vendored copies and moves every Talib-specific step into
`docs/workflow/*.md` and a Repo profile in CLAUDE.md, so nothing repo-specific is lost and nothing generic is
duplicated.

It also corrects what PR #641 made wrong: `Playwright E2E` and `Backup Pipeline Self-Test` now run only on pushes to
`staging`/`main`, manual dispatch, or a PR labelled `e2e`. So "defer Playwright to the required CI check" and "four
required checks" no longer hold. Local e2e is now required in verify-local, and the `e2e` label goes on PRs that touch
user flows.

## Decisions

- Vendor into `.claude/skills/` (the canonical skill dir; `.agents/` stays gitignored and symlinked).
- Workflow docs are a new `docs/workflow/` directory, allowed by `audit-docs.sh`.
- Model tiers stay recorded: the build plan bullet names driver and worker models.
- Claude Code skill bindings (`superpowers:*`, `feature-dev:code-reviewer`) stay as a mapping table in
  `docs/workflow/build.md`, so the registry check keeps meaning something.
- The Full gate mirrors CI's required jobs locally (lint, Vitest, RLS/API-auth guards, build, Playwright).
- Promotion PRs get the `e2e` label so the heavy jobs still gate production.
- The old open-ended fix loop (soft escalation every 3 rounds) is replaced by the shared stop rule (3 rounds without
  progress → `needs-human`, stop).

## Acceptance criteria

- [x] `bash scripts/sync-agent-workflow.sh --check` passes and runs in the `Docs sync` job.
- [x] Every Talib-specific step from the old `spec`/`build`/`ship` skills has a home in `docs/workflow/` or CLAUDE.md.
- [x] CLAUDE.md has a Repo profile with every template row, and no text says Playwright can be deferred to CI.
- [x] `audit-docs.sh`, `test-audit-docs.sh`, `test-hooks.sh` and `check-workflow-gh-repo.py` pass.

## Non-goals

App code; `uat`, `audit-docs`, `better-*`, `.claude/standards/*`; branch-protection settings; `ops/*.json`;
`.github/pull_request_template.md`.

## Assumptions

- Branch protection is currently not enforced (private repo on the free plan); CLAUDE.md says so rather than claiming it.

## Gate re-openers

None.

## Tasks

- [x] T1 Vendor the shared skills, move Talib's steps into `docs/workflow/` and the Repo profile, and point the audit at the moved tables (one change: the sync overwrites the tables the audit reads) — accept: old→new table complete, audit and its regression tests green
- [x] T2 Record the new vendored source and run `sync-agent-workflow.sh --check` in the `Docs sync` job — accept: `--check` passes locally, workflow YAML valid

## Implementation

- Plan: driver=claude-opus-5-5, workers=none; T1–T2 inline (interlocking prose moves where a worker would need the whole old and new text as context).
- T1: `.claude/skills/{working-principles,spec,build,verify-local,ship}/`, `.claude/skills/.agent-workflow.lock`, `scripts/{sync-agent-workflow,pr-screenshots}.sh` (vendored at agent-workflow@ab828e6); `docs/workflow/{spec,build,verify,ship}.md`, `CLAUDE.md`, `README.md`, `docs/runbooks/environments.md` (repo-specific steps moved, e2e/CI statements corrected); `scripts/audit-docs.sh`, `scripts/test-audit-docs.sh` (standards-table check reads `docs/workflow/build.md` and fails on an empty table, links and skill names in `docs/workflow/` checked, `docs/workflow/` allowed); `scripts/link-agent-skills.sh` (links the two new skills for Codex).
- T2: `.claude/skills/VENDORED.md`, `.github/workflows/docs-check.yml`.

## Verification

### Verified locally — 4dd6f72 + T2, 2026-10-10
- Scope: workflow docs, vendored skills, audit/link scripts and one CI step. No `app/`, `components/`, `lib/`, `prisma/`, `e2e/` or package change, so no app build, browser walk or Playwright run (per the user's instruction). The scripts and CI step this cycle changes were run directly instead.
- `bash scripts/sync-agent-workflow.sh --check` → `agent-workflow: vendored files match ref=ab828e64447c0dace55a240b3246840bd918bb45`; after appending a line to `.claude/skills/ship/SKILL.md` it exits 1 with `.claude/skills/ship/SKILL.md: FAILED` (reverted).
- `bash scripts/audit-docs.sh` → `13 ok, 1 warn, 0 fail` (the warn is the pre-existing ADR 60-day window); `Standards-table paths exist … docs/workflow/build.md … (16)`, `Relative links … README, CLAUDE and docs/workflow resolves`.
- `bash scripts/test-audit-docs.sh` → `Summary: 7 audit regression checks passed` (new probe: a missing load-on-demand table is rejected).
- `bash scripts/test-hooks.sh` → `Summary: 32 passed, 0 failed`.
- `python3 scripts/check-workflow-gh-repo.py .github/workflows/*.yml` → `OK` for all five workflows; `--self-test` → `OK — self-test passed`.
- Links and `#anchors` in CLAUDE.md, README.md, `docs/runbooks/environments.md` and `docs/workflow/*.md` checked with a slug script: all resolve.
- Highlight: n/a (no UI change).

## Ship Notes

- No migrations, env vars or app changes. Rollback: revert the PR.
- After merge, the next session reads the vendored skills; Codex needs `bash scripts/link-agent-skills.sh` (runs at setup) to see `working-principles` and `verify-local`.
- `needs-human` label does not exist yet; `docs/workflow/ship.md` says to create it on first use.
