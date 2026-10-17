# Three CI checks per PR instead of six to fifteen (2026-10-17)

## Context

The owner, looking at the promotion PR's check list, said there are too many CI checks.

- **A normal PR showed 6 rows:**
  - 4 real checks: `Docs sync`, `Lint, Typecheck & Test`, `Build`, `Keepalive & Alert Self-Test`.
  - 2 skipped: `Playwright E2E` and `Backup Pipeline Self-Test` when the PR has no `e2e` label.
- **The promotion PR (#663) showed 15 rows.**
  - Its head *is* `staging`, so the push to `staging` and the PR to `main` each ran every workflow.
  - Each push run added an `Already verified on PR` job on top.
- **Two of the checks take seconds.** `Docs sync` and the keepalive self-test each run in under 10 s, yet each got its own runner, checkout and row.
- **`Build` duplicated work.** It reinstalled the same `npm ci` that `Lint, Typecheck & Test` had already installed.

## Decisions

- **Three checks.** The owner chose this option.
  - **`Checks`** (~20 s): the doc-sync rule, `audit-docs.sh`, the audit/hook regression tests, the vendored-skill checksum, shellcheck, the keepalive/alert self-tests and the workflow guard. These were the old `Docs sync` and `Keepalive & Alert Self-Test`.
  - **`Test & Build`** (~5 min): typecheck, lint, Vitest, the RLS and API-auth guards, then the production build. One `npm ci` instead of two.
  - **`E2E`**: Playwright and the backup self-test in one job, on a PR labelled `e2e` or on manual dispatch.
    - Its three Postgres services listen on 5432, 5433 and 5434, so they no longer collide.
    - The fast backup self-test runs first.
- **No CI on pushes to `staging`/`main`.** The promotion PR already runs all three checks on the exact tree that reaches production, and every promotion carries `e2e`. Pushes to `main` are always that promotion's merge commit.
  - Cost: a squash merge to `staging` that combines badly with another merge is now caught at the next promotion PR, not right after the merge. Every PR still runs CI before it merges.
  - The `Already verified on PR` jobs go too. `scripts/ci-already-verified.sh` stays, since it is vendored and pinned by the agent-workflow lock; it is simply unused.
- **E2E stays its own workflow file**, so that adding the `e2e` label starts it without re-running `Checks` and `Test & Build`. A label other than `e2e` still produces one skipped `E2E` run that bills no minutes, as before.
- **Docs follow the new names.** This covers `CLAUDE.md`, `docs/workflow/{ship,verify}.md`, the environments and prod-setup runbooks, `ops/branch-protection.json` and `ops/ruleset-main.json`. Branch protection is not enforced on this plan, so no merge is blocked by the rename.

## Acceptance criteria

- [x] A ready PR without `e2e` shows `Checks` and `Test & Build`, plus a skipped `E2E`.
- [x] A PR with `e2e` (including every promotion) shows exactly `Checks`, `Test & Build` and `E2E`.
- [x] A push to `staging` or `main` starts no CI workflow.
- [x] Every step the old six jobs ran still runs, in one of the three.
- [x] No doc outside history names an old check as current.

## Verify flows

1. Both workflow files parse, and `actionlint` passes on them.
2. `check-workflow-gh-repo.py` passes its self-test and all workflows.
3. The inlined doc-sync rule gives the same verdicts as the old `case` script on sample diffs.
4. `audit-docs.sh` and `test-audit-docs.sh` pass.
5. This PR's own CI shows the three new checks. It carries `e2e` so that `E2E` runs.

## Test seams

The workflow guard and audit scripts run inside `Checks`. This PR's own run is the end-to-end test.

## Non-goals

- Changing what any check tests.
- The scheduled keepalive and backup workflows; they never appear on PRs.

## Assumptions

- The GitHub PR view counts one row per job. Merging jobs is the only way to cut rows.

## Gate re-openers

None. This is CI config and docs only, with no app code.

## Tasks

- [x] **T1: Workflows.** Write `ci.yml` (Checks, Test & Build; PR-only), fold Playwright and the backup self-test into one `E2E` job in `e2e.yml` (PR-only), and delete `docs-check.yml`.
      Accept: actionlint is clean and the guard is OK.
- [x] **T2: Docs.** Rename the old checks everywhere they describe current behaviour.
      Accept: no stale hits and the audit is green.

## Implementation

- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5 (T2). T1 was done inline, because the workflow shape was the decision itself. T2 is mechanical renames across nine files.
- T1:
  - `.github/workflows/ci.yml` was rewritten with two jobs and PR-only triggers. The doc-sync rule is inlined as a two-grep check.
  - `.github/workflows/e2e.yml` was rewritten as one `E2E` job with three Postgres services. The backup self-test now runs on ports 5433/5434.
  - `.github/workflows/docs-check.yml` was removed.
- T2: see the diff (CLAUDE.md, the runbooks, `docs/workflow/`, `ops/*.json`, comments in `scripts/audit-docs.sh`, `vitest.config.ts` and `.claude/skills/VENDORED.md`).

## Verification

### Verified locally on 2026-10-17, base `origin/staging` `ccc740ef`

- PyYAML parse: `ci.yml` has jobs `Checks` and `Test & Build`; `e2e.yml` has job `E2E`. Neither has a `push` trigger.
- `actionlint` 1.7.7 on both files: clean.
- `check-workflow-gh-repo.py --self-test`: passed. On all workflows: OK for `backup`, `ci`, `e2e` and `keepalive`.
- The doc-sync rule on sample diffs:
  - code alone → FAIL;
  - code plus a cycle doc, code plus README, or workflow-only → OK.
  - These match the old rule.
- Every non-workflow step of `Checks` ran locally and passed:
  - `audit-docs.sh`: 13 ok, 1 warn (ADR window), 0 fail.
  - `test-audit-docs.sh`: OK.
  - `test-hooks.sh`: 32 passed, 0 failed.
  - `sync-agent-workflow.sh --check`: vendored files match.
- **The counts block was stale on `staging` itself** (`ccc740ef`). #665 and #667 each regenerated it on their own branch, so after both squash-merged the cycle-doc count was one short. The promotion PR #663 caught it, which is exactly the risk the Decisions section accepts. Regenerating it here fixes `staging`.

## Ship Notes

- **Route: other code (CI config).**
- The first PR to run under the new files is this one. Its check list is the proof.
