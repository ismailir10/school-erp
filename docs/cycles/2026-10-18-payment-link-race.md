# Preserve payment links replaced during a gateway check

## Context

Promotion review reproduced an A → B → C race in the invoice replacement route: two admins check link A, one stores B during the other gateway check, and the second request adopts and clears unchecked B before creating C. The user authorized this narrow fix, staging verification, and promotion to main once green.

## Spec

- Preserve a link that changes while a replacement request checks the gateway. Return the concurrent winner as `REPLACED` with `created: false`, without clearing it or creating another link.
- Compare both session ID and URL; either changing identifies a replacement. The initial route read bounds the check even when reconciliation internally reads a newer link.
- A concurrently cleared link still uses the shared claim-protected creation helper. Paid/cancelled outcomes, permissions, tenant scope, gateway errors, audit behavior, and later compare-and-swap races keep their existing behavior.
- Verify the race at the API seam, including equal URL/different session and equal session/different URL. Run the task gate and full local verification before shipping.

## Tasks

- [x] T1: Add failing replacement-identity regressions, preserve the concurrent winner in the route, and verify the narrow fix.

## Implementation

- Plan: driver=gpt-6, workers=inherited agent; T1 sequential in the delegated payment worker; environment setup and verification preparation parallel in separate workers. One atomic fix task, no unrelated cleanup.
- T1: `app/api/invoices/[id]/replace-payment-link/route.ts` now returns a concurrent replacement when either its session ID or URL changed during the gateway check. `app/api/__tests__/invoice-replace-payment-link.test.ts` adds three regressions covering both identity fields changing and either field changing alone. Implementation, focused regressions, spec/security review, and build/lint/full Vitest gates complete; local E2E complete; the fixed staging deployment smoke remains pending.

## Verification

- Baseline reproduction: actual route source executed with deterministic DB/gateway stubs checks A, clears B, creates C, and returns HTTP 200 (`/private/tmp/promotion-payment-replacement-race.cjs`).
- Failing-first deterministic regression: `/private/tmp/promotion-payment-replacement-regression.cjs` executed the actual route source; before the guard it failed `The concurrent replacement must not be cleared` because the CAS targeted B. After the guard it returned B with `created: false`, with no clear and no third creation.
- Focused API suite: `npx vitest run --project node app/api/__tests__/invoice-replace-payment-link.test.ts` passed: `Test Files 1 passed (1)`, `Tests 32 passed (32)`, duration 436 ms.
- `git diff --check`: passed.
- Independent spec and security reviewers: clean; no remaining findings in the narrow fix.
- Build and lint: passed. Full Vitest: `644 passed | 2 skipped` files; `7635 passed | 42 todo` tests.
- Documentation audit: passed. RLS coverage: `43/43`. API-auth guard: `216/216`.
- Local Playwright E2E: `241 passed (4.3m)`, exit 0, no skips, retries, or flaky tests. Freshly seeded disposable local Postgres, bundled Node 24.19, Chromium 1248, one worker. Hook self-test: `32 passed, 0 failed`. Documentation audit: `13 OK, 1 existing ADR warning, 0 fail`.
- Baseline staging browser verification at `5f4f770` (before this fix), using normal Chrome UI:
  - Signed in as SUPER_ADMIN Ismail and created Bilal's fixture `INV-2026-0071` (`cmvclspbb000007jq9dvnungr`), period `Verifikasi race 18 Oktober 2026`, due 16 October, Rp100,000. Link creation produced a real staging DOKU URL; forced replacement produced a different URL.
  - Recorded Rp25,000 manually. The invoice remained OVERDUE with Rp75,000 remaining, and its background relink produced a different URL.
  - Reminder queue showed 112 eligible invoices, all with links (so no `Buat link dulu` fixture). The fixture's WhatsApp draft contained Rp75,000 and the DOKU link. Opened the draft only; the queue and invoice detail both showed `Diingatkan baru saja`, attributed to Ismail.
  - Signed in as GUARDIAN Nurul (`rightjet`). The parent saw OVERDUE, the partial-payment receipt, and Rp75,000 remaining. `Minta link baru` preserved the same working checkout URL and Rp75,000 remaining; the success toast read `Link pembayaran masih berlaku. Silakan ketuk Bayar sekarang.` The checkout had never been opened.
  - Screenshots: `/private/tmp/payment-race-verification/partial-payment.png`, `/private/tmp/payment-race-verification/reminder-queue.png`, `/private/tmp/payment-race-verification/parent-link.png`.
  - SCHOOL_ADMIN was covered by permission tests; no signed-in SCHOOL_ADMIN browser pass is claimed. Raw browser network access was declined; these checks used ordinary UI only.
- Fixed staging deployment replacement smoke: pending deployment; the baseline staging pass does not verify the new guard.

### Verified locally — a2c00328, 2026-10-18

- Diff: `origin/staging...HEAD`, base `5f4f770021d97f022f03ec8b0651b1a007265978` → runtime `a2c00328232754f2a5abfa775e907321bc35b0e3`. Changed paths: `CLAUDE.md`, `app/api/invoices/[id]/replace-payment-link/route.ts`, `app/api/__tests__/invoice-replace-payment-link.test.ts`, `docs/cycles/2026-10-18-payment-link-race.md`.
- Classification: other code — payment concurrency only; no auth, dependency, session, or UI changes. This later evidence-only documentation commit does not change the verified runtime.
- Gate: `npm run lint`, `npx vitest run`, RLS/API-auth guards, `DEMO_MODE=true NEXTAUTH_SECRET=local-dummy npm run build`, `npx playwright test` → build/lint exit 0; `644 passed | 2 skipped` test files, `7635 passed | 42 todo` tests; RLS `43/43`; API-auth `216/216`; E2E `241 passed (4.3m)`, no retries/flaky/skips. `bash scripts/test-hooks.sh` → `32 passed, 0 failed`; docs audit → `13 OK, 1 existing ADR warning, 0 fail`.
- App: production build, demo auth + disposable local Postgres; Chromium 1248, one worker, Node 24.19.0.
- Walked: full automated local E2E suite passed. Edge/error: the 32 focused API cases passed, including concurrent replacement before/after the fresh read, either identity field changing, cleared-link recovery, paid invoices, gateway errors, and access/tenant guards. Actual-source race regression failed before the fix and passed afterward with no third checkout.
- Console/network: no broad clean claim; raw staging network inspection was declined. Automated E2E passed; manual staging evidence above used ordinary UI only.
- Screenshots: baseline staging evidence listed above; no UI change in this fix.
- Highlight: n/a (no UI change).
- Rounds: 1 — preserve the concurrent winner by comparing both session ID and URL; no runtime changes after the recorded passing gates.
- Not checked: fixed staging deployment smoke awaits merge/deployment. The baseline reminder queue had no missing-link fixture (all 112 eligible invoices already held links); no signed-in SCHOOL_ADMIN or raw network pass is claimed.

## Ship Notes

- No migration, dependency, environment variable, or permission changes.
- Ship the fix through a PR to staging after local E2E is green; verify the deployed replacement flow signed in as SUPER_ADMIN and the parent invoice as GUARDIAN. Then create the staging → main promotion and merge it as a merge commit only when its head is green. Keep the deployment verification label until that check passes.
- Rollback: revert the fix commit through a PR; this restores the previously reproduced replacement race.
