# Security hardening after the October 2026 Next.js advisory

## Context

The user asked for a security review after a recent incident. The review was a read-only audit. One driver handled triage and three dirty-tier subagents covered API authorization across all 216 routes, auth/proxy/webhooks/secrets, and supply chain/CI. It also ran the Supabase security advisors on prod and staging.

**The incident that applies to us.** On 2026-10-14 Next.js shipped an out-of-band patch for three flaws. Production and staging both ran `next@16.4.0` and `react@19.3.0`, which are inside every affected range.

| Advisory | Affected | Our exposure |
|---|---|---|
| GHSA-673q-mjm6-r5xr: RCE via `use cache` (React GHSA-xqc2-xf4c-x3h3) | 16.0.0–16.4.0 | Not reachable. No `cacheComponents`, no `use cache` |
| CVE-2026-96889 / GHSA-2464-fhr4-w9xw: RCE via SVG in sharp/librsvg | ≤16.4.0 | Not reachable. `sharp` is already 0.35.5, no `dangerouslyAllowSVG`, and the only `next/og` image is static and edge-runtime |
| GHSA-p3m5-59mp-jv5r: DoS via Server Actions | ≤16.4.0 | Not reachable. No `"use server"` in the tree |

Vercel's guidance is to upgrade even when a flaw is unreachable, and two of the three advisories never reached the npm audit feed. Upgrade to `next@16.4.2` / `react@19.3.1`.

**Supply chain.** The lockfile has none of the Shai-Hulud / ChainDrop / tensorlake / MALFEX packages and no Sept-2025 chalk/debug bad versions. Every `resolved` URL is registry.npmjs.org. Only five packages have install scripts, all expected: prisma, @prisma/engines, esbuild, unrs-resolver, fsevents. None was published after 2026-09-22. CI has no `pull_request_target`, no script injection, and no write-back.

**Supabase advisors.** RLS shows clean on both projects. Prod has leaked-password protection disabled. Staging has the same, plus insufficient MFA options. Staging `auth.identities` holds 3 `email`-provider identities (latest 2026-04-25) next to 12 `google` ones. Email/password signup is therefore enabled on at least staging, even though the UI only offers Google.

**Findings fixed in this cycle** (each one traced in the code by the driver):

1. **Demo auth had no deploy guard (high, conditional).** With `DEMO_MODE=true`, `getSession` and `proxy.ts` accept an unsigned `school-erp-session=<userId>` cookie, and `/api/auth/users` publicly lists every user id. One copied env var on Vercel would hand anyone SUPER_ADMIN access.
2. **Any Supabase provider could claim an email (high, conditional).** `getSession` resolves and auto-provisions a User from the auth email alone. If email signup is on and confirmations are off, a direct `signUp` with the public anon key for a teacher's or parent's email gets their account.
3. **Unscoped attendance read (medium).** `GET /api/student-attendance/[id]` checked only the tenant, so any teacher or guardian could read any child's record.
4. **Revoked guardians kept read access (medium).** Invoice, receipt, report-card PDF and parent-portal loaders did not filter `StudentGuardian.status = ACTIVE`.
5. **Privilege escalation via employee create (medium).** `employees.create` alone could mint a `SCHOOL_ADMIN` login, bypassing the HR-1 escalation guard.
6. **Non-constant-time bearer compare (low)** on both crons and `doku/probe`.

## Decisions

- **Demo auth is refused when `VERCEL` is set**, not when `NODE_ENV=production`. Playwright runs against `next start`, where NODE_ENV is production, while Vercel always sets `VERCEL`. `lib/storage/index.ts` already uses this rule for the demo disk backend. `scripts/vercel-build.sh` also fails the build on `DEMO_MODE=true`, so the misconfiguration is loud and is not half-applied (the payment clients read DEMO_MODE too).
- **Google-only is enforced on `app_metadata.provider`** (the account's *first* provider), not on `providers.includes("google")`. Supabase auto-links a later Google login to a pre-registered email account, so an "includes" check would let an attacker who registered first keep a working password. Failing closed locks that email out until an operator deletes the rogue auth user, which is the right failure.
- The rest of the review's findings are hardening with no live exploit path. They are listed under Non-goals and Ship Notes for follow-up cycles rather than widening this PR.

## Acceptance criteria

- `package.json` pins `next@16.4.2`, `react@19.3.1`, `react-dom@^19.3.1`, `eslint-config-next@16.4.2`. The lockfile agrees.
- `DEMO_MODE=true` with `VERCEL=1`: `getSession` uses Supabase, the proxy ignores the demo cookie, `/api/auth/users` returns 404, `/api/auth/login` returns 403, and the auth rate limit stays on. The Vercel build fails.
- `DEMO_MODE=true` without `VERCEL` (local dev, local Playwright, CI) behaves exactly as before.
- A Supabase user whose `app_metadata.provider` is not `google` gets no session and no auto-provisioned User. The OAuth callback sends it to `/?error=access_denied`.
- A teacher can `GET /api/student-attendance/[id]` only for a class they teach, a guardian never can, and admins keep access.
- INACTIVE guardian links grant no invoice, receipt, report-card or parent-portal data.
- A caller lacking any SCHOOL_ADMIN default permission cannot create (or re-role) an employee as SCHOOL_ADMIN.
- Cron and probe bearer checks use a constant-time compare and still fail closed when the secret is unset.

## Verify flows

- Admin, teacher and parent sign-in (demo auth, local) still reach their dashboards. Covered by the Playwright auth-shell, attendance, teacher-daily and parent-invoice specs.

## Non-goals

- Admin routes that check only `isAdminRole` and not the custom-role permission (students export, config/*, academic setup). This is a consistency fix across about 20 routes and gets its own cycle.
- Teacher CENTER assessment writes not enforcing enrollment or age group, and `promotions` POST with no zod schema.
- Moving rate limiting to a shared store, and adding a captcha on `/daftar`.
- CI hardening: `permissions: contents: read`, SHA-pinned actions, a branch restriction on the `production` environment, and moving `shadcn` to devDependencies.
- Promoting the CSP from Report-Only to enforcing.

## Tasks

- [x] T1 Upgrade next/react to the patched releases
- [x] T2 Demo-auth deploy guard (`lib/security/demo-mode.ts`, auth, proxy, auth routes, rate limit, vercel-build)
- [x] T3 Google-only provider guard in `getSession` and the OAuth callback
- [x] T4 Authz fixes: attendance GET scope, ACTIVE guardian links, SCHOOL_ADMIN escalation guard, constant-time bearer compare

## Implementation

- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5 (audit fan-out ×3, T4 implementation); T1–T3 inline by the driver (auth-sensitive and small), T4 delegated in parallel.

## Verification

## Ship Notes
