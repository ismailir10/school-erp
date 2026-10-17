# Let the prod-down and backup-failure alerts actually open their issues (2026-10-16)

## Context

The scheduled **Prod Keepalive** (every 3 h) and **Nightly Backup** workflows each end in small jobs that open
or close a GitHub issue: prod-down, keepalive-degraded, and backup-failure. Every run since at least 13 Oct has
been red, and none of those issues was ever opened.

- Those jobs declare `permissions: issues: write` and nothing else. A job-level `permissions` map sets every
  scope it does not name to `none`, so `contents` is `none`, and the first step (`actions/checkout`) fails on this
  private repository. Keepalive run #78 and backup run #159 both show checkout failing after about 30 s.
- **The alarm is silent.** If production went down, nobody would be told.
- **It is already happening for backups.** Nightly Backup has failed every night (#157 to #159 at least) at "Sanity-check
  required secrets". All six secrets read empty: `PROD_DB_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_ENDPOINT`, `BACKUP_GPG_RECIPIENT` and `BACKUP_GPG_FINGERPRINT`. The backup-failure issue that should have
  said so was never opened. No production backup has been taken in that period.

## Decisions

- **Add `contents: read` to all six issue jobs**: keepalive `alert`, `resolve`, `cadence-alert`, `cadence-resolve`,
  and backup `alert`, `resolve`. The user approved the keepalive fix. Backup has the identical defect in the identical
  job shape, and its broken alarm is what hid the missing backups, so it is in scope.
- **Extend the existing workflow guard instead of adding a new one.** `scripts/check-workflow-gh-repo.py` already
  exists for this failure class: the 2026-08 backup alarm that could not resolve its repository. It runs in CI's
  `Keepalive & Alert Self-Test` job. A second rule now fails any job that runs `actions/checkout` under a
  `permissions` map without `contents` access. Its self-test fixtures include the real defect's shape.
- **Missing backup secrets are out of scope.** They are settings that only the owner can enter. This cycle makes
  their absence loud.

## Acceptance criteria

- [x] All six issue jobs grant `contents: read` alongside `issues: write`.
- [x] The guard fails on the pre-fix workflows (all six jobs named) and passes on the fixed ones.
- [x] The guard's self-test covers a passing job-level map, inherited workflow-level permissions, and the failing shape.
- [x] No other workflow behaviour changes.

## Verify flows

1. `python3 scripts/check-workflow-gh-repo.py --self-test` → every fixture OK.
2. `python3 scripts/check-workflow-gh-repo.py .github/workflows/*.yml` → OK on all five workflows.
3. The same guard on `origin/staging`'s `keepalive.yml` and `backup.yml` → exits 1 and names the six jobs.
4. After merge, the next scheduled keepalive run's jobs pass their checkout step (needs Actions minutes, see Ship Notes).

## Test seams

The guard's self-test runs in CI, and the guard runs over the real workflows in CI.

## Non-goals

- Setting the backup secrets.
- The Actions-minutes question.
- Changing schedules or alert wording.

## Assumptions

- The Production environment and repo secrets are readable by a job that requests `environment: production`. The backup
  job does. The secrets are empty because they were never set, or were cleared, not because the workflow is wrong.

## Gate re-openers

None. This is CI config only: no app code, schema, dependency or secret.

## Tasks

- [x] **T1: Permissions and guard.** Add `contents: read` to the six jobs. Add a second rule and fixtures to
      `scripts/check-workflow-gh-repo.py`. Rename the CI step to name both checks.
      Accept: the guard is red on the old workflows and green on the new ones; the self-test is green.

## Implementation

- Plan: driver=claude-opus-5-5, workers=none; T1 inline (why: six one-line YAML additions plus a 20-line rule beside an existing one, smaller than a worker brief).
- T1:
  - `.github/workflows/keepalive.yml` (4 jobs) and `.github/workflows/backup.yml` (2 jobs) gain `contents: read`.
  - `scripts/check-workflow-gh-repo.py` gains `checkout_without_contents()`. A job-level `permissions` map replaces the workflow-level one, a string such as `read-all` or no map at all is left alone, and any `actions/checkout` under a map without `contents: read|write` is an error. Three new self-test fixtures, and the docstring explains the incident.
  - `.github/workflows/ci.yml`: the step is renamed to cover both checks.

## Verification

### Verified locally on 2026-10-16, base `origin/staging` `6484f636`

- `python3 scripts/check-workflow-gh-repo.py --self-test`: all 8 fixtures OK, `self-test passed`.
- `python3 scripts/check-workflow-gh-repo.py .github/workflows/*.yml`: `OK` for `backup`, `ci`, `docs-check`, `e2e` and `keepalive`; exit 0.
- **The same guard on `origin/staging`'s workflows** exits 1:
  - `backup.yml: runs actions/checkout with no contents permission in: alert / …; resolve / …`
  - `keepalive.yml: … in: alert / …; resolve / …; cadence-alert / …; cadence-resolve / …`
- Every workflow file parses with PyYAML.
- No app code is touched. Lint, Vitest, the build and Playwright are not affected; CI runs them.

## Ship Notes

- **Route: other code (CI config).** No app, auth or schema change.
- **After merge, two things need the owner:**
  1. **Backup secrets.** Set all six under GitHub → Settings → Environments → Production → Environment secrets
     (`docs/runbooks/prod-setup.md` §3). Until then, the nightly backup keeps failing. With this fix it now opens a
     `backup-failure` issue saying so.
  2. **Actions minutes.** Since 11:00 UTC on 2026-10-16, GitHub has refused to start keepalive jobs (no runner
     assigned, 2 s). The likely cause is the account's Actions minutes or spending limit. Check Settings → Billing.
     Until it is fixed, no workflow runs, including this PR's CI.
- The fix only reaches the scheduled runs once it is on the default branch (`staging`).
