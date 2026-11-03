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
- [ ] T2: Run local gates, record evidence, review and ship.

## Implementation

- Plan: driver=gpt-6.1, workers=gpt-6.1; the dependency worker owns the batch and local gates while an independent worker reviews the resolver major. The driver reviews, verifies staging and controls merges.
- Reused PR #716's package and lock manifests. Updated the remaining nested jsdom undici and systeminformation patches from the security queue, using registry integrity metadata. Aligned eslint-config-next and its Next ESLint plugin with Next.
- No application source or tests changed. No new test skips.

## Verification

- Base: `01333ca54afc3b078ddb891d3d9744687eb642c1`; runtime diff: `package.json`, `package-lock.json`.
- Local verification in progress. Disposable Docker Postgres on `localhost:54329`; both database URLs explicitly point there.
- Staging check: pending (`needs-staging-verify` before merge), because the batch updates authentication dependencies.

## Ship Notes

- No migration, environment or secret changes. Rollback by reverting the batch merge through a PR.
- After staging deploys, verify Google login/session and representative admin, teacher and parent flows before production promotion.
- Supersedes dependency PRs #716, #715, #714, #713, #711, #710 and #708; the resolver major #717 remains separate.
