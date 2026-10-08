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
- Ship verification route (classified against source SHA `9d100a9`, diff vs `origin/staging` = `package.json`, `package-lock.json`, this cycle doc, CLAUDE.md counts): package/lock changes disqualify the docs-only skip, so the **local demo-auth browser route** applies. Not auth-impacting (no login/session/cookie/guard code; `@supabase/ssr` is a patch bump and demo auth does not exercise it), so no signed-in staging check.
- Local demo-auth browser verification at `9d100a9`: production build (`npm run build`, Prisma Client 7.10.0) served with `DEMO_MODE=true` on a disposable local Postgres (`talib_deps`, `prisma db push` + seed). Admin (desktop) — `/admin`, students, invoices, employees, classes, payroll, admissions, employee-attendance, settings: all 200, lucide icons render, 0 console errors, 0 5xx, no API >2s; the Base UI `Catat Pembayaran` dialog opens and closes. Teacher (mobile) — `/teacher`, attendance, assessments: 200, 0 errors. Parent (mobile) — `/parent`, invoices, attendance, profile: 200, 0 errors. Prisma write through `@prisma/adapter-pg` 7.10 + `pg` 8.23: recording a Rp 50.000 cash payment → 201, invoice moves to `PARTIALLY_PAID`, `totalPaid` 50000. Kuitansi PDF → 200 `%PDF-`. Teacher → `/api/students` → 403. Visual check against design-system: shell, sidebar, status badge and tabular numbers unchanged.

## Ship Notes
- No migration, no env var. Prisma client/CLI move to 7.10.0 together; `prisma generate` runs in `npm run build` as before.
- `npm audit` reports 20 advisories (1 critical, 16 high) that this batch does not address; they need a separate look (likely transitive).
- Rollback: revert the squash commit.
