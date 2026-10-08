# Dependency batch — dependabot minors and patches (2026-10-08)

## Context
Dependabot opened ten minor/patch PRs against `staging` on 2026-10-08 (#617–#626), plus an older `@babel/core` patch (#602). The Dependency cadence rule (CLAUDE.md) batches minors and patches into one branch with one gate instead of merging them one by one, which would re-stale every other PR behind branch protection's up-to-date requirement. The user asked to review and merge or close all open PRs.

## Spec
- [x] Every dependabot version lands in one `chore(deps)` PR; the individual dependabot PRs are closed as superseded.
- [x] No app code changes unless a bump forces one.

## Tasks
- [x] **T1 — Bump, install, gate.**

## Implementation
- T1: `resend` 6.18.x → 6.32.x; `@prisma/adapter-pg` ^7.9.1 → ^7.10.0, with `@prisma/client` and `prisma` bumped to ^7.10.0 alongside (the adapter's `@prisma/driver-adapter-utils` pins 7.10.0, so mixing would split Prisma versions); `eslint-config-next` 16.3.6 → 16.3.8 (exact pin kept); `lucide-react` ^1.31.0 → ^1.52.0; `pg` ^8.22.0 → ^8.23.1; `tailwind-merge` ^3.6.0 → ^3.7.0; `@testing-library/react` ^16.3.2 → ^16.3.3; `@supabase/ssr` ^0.12.4 → ^0.12.7; `react-resizable-panels` ^4.12.2 → ^4.14.2; `@base-ui/react` ^1.7.0 → ^1.8.0; `@babel/core` (transitive only) 7.29.0 → 7.29.7 in the lockfile, no new direct dependency. No code changes were needed.

## Verification
- `npm run lint` → 0 errors (56 pre-existing warnings); `npx tsc --noEmit -p .` clean; `npm run build` passed; `npx vitest run` → 551 files passed, 2 skipped; 5589 tests passed, 42 todo. `npx prisma generate` → Prisma Client 7.10.0.
- Playwright: deferred to the required CI `Playwright E2E` check (no app code changed; the UI libraries bumped are minor versions).
- Ship verification route: dependency-only diff (package.json + package-lock.json) → CI's four required checks; no auth code changed.

## Ship Notes
- No migration, no env var. Prisma client/CLI move to 7.10.0 together; `prisma generate` runs in `npm run build` as before.
- `npm audit` reports 20 advisories (1 critical, 16 high) that this batch does not address; they need a separate look (likely transitive).
- Rollback: revert the squash commit.
