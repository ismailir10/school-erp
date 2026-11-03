# Dependency minor, patch and security batch

## Context

The user requested review and merge of the open dependency updates before promoting staging to main. Batch the compatible minor and patch updates instead of serially rebasing Dependabot's overlapping lockfile changes. Keep the resolver major update in its own cycle.

## Spec

- Apply the versions reviewed in PR #716 and include the security fixes from #708, #710, #711, #713, #714 and #715.
- Keep Next's ESLint configuration aligned with the Next patch.
- Preserve application behavior; no schema, migration, environment or credential changes.
- Verify with the local disposable database and green CI. The Supabase/Next updates require signed-in staging verification before promotion.

## Tasks

- [x] T1: Consolidate reviewed dependency manifests and remaining security patches.
- [x] T2: Fix the pre-existing mobile invoice test menu-opening race without weakening assertions.
- [ ] T3: Verify the combined dependency tree, record evidence, review and ship.

## Implementation

- Plan: driver=gpt-6.1, workers=gpt-6.1; the dependency worker owns the batch and local gates while an independent worker reviews the resolver major. The driver reviews, verifies staging and controls merges.
- Reused PR #716's package and lock manifests. Updated the remaining nested jsdom undici and systeminformation patches from the security queue, using registry integrity metadata. Aligned eslint-config-next and its Next ESLint plugin with Next.
- Application source is unchanged. The invoice layout helper now determines whether the opener is a menu trigger before clicking, then waits for and clicks the menu item. No timeout changes or new test skips.
- Rebased onto staging after the separately reviewed resolver major merged; preserved its resolver version and removed the unused old Effect peer row. Preserved all reviewed native optional packages across platforms.

## Verification

- Base: `1856f5c3dec184dda128c6137da0286724105582`; compared paths: `package.json`, `package-lock.json`, the invoice layout E2E helper, this cycle and generated CLAUDE counts.
- Initial batch gate: lint/build passed; Vitest `735 passed | 2 skipped (737)`, `9051 passed | 42 todo (9093)` with three workers. RLS 46/46, API auth 225/225, hooks 32/32, docs audit 13 ok / 1 warn / 0 fail.
- Initial Playwright: 270 passed, 2 failed invoice-dialog setup checks, 1 flaky class skeleton measurement. Trace proved the instant menu visibility probe returned false and omitted the item click; the still-open menu appeared in the failure screenshot. The same failure reproduced with the original dependency versions (1 failed / 3 flaky / 8 passed over two repetitions), establishing an existing test race. A local browser diagnostic observed immediate visibility true/false/true, while awaiting and clicking opened the dialog all three times.
- The class layout first attempt measured the loading skeleton table before class data resolved; its normal retry passed. No application layout changes are included.
- Local verification in progress. Disposable Docker Postgres on `localhost:54329`; both database URLs explicitly point there.
- Staging check: pending (`needs-staging-verify` before merge), because the batch updates authentication dependencies.

## Ship Notes

- No migration, environment or secret changes. Rollback by reverting the batch merge through a PR.
- After staging deploys, verify Google login/session and representative admin, teacher and parent flows before production promotion.
- Supersedes dependency PRs #716, #715, #714, #713, #711, #710 and #708; the resolver major #717 remains separate.
