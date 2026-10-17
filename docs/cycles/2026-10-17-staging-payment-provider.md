# Verify stored checkout links with their owning gateway

## Context

Post-merge verification of #666 at staging commit `c229995e` found an overdue parent invoice whose **Minta link baru** action returned the same Xendit checkout with a "still valid" toast, but that checkout displayed "This session has expired". Staging's active gateway is DOKU sandbox; the legacy Xendit sandbox health probe also succeeds. Other existing fixtures hold the synthetic `demo.xendit.local` hostname. A current-provider poll cannot establish the validity of an older provider's link.

This is a fix-forward continuation of the user's authorization to fix, merge and verify #666. No new product decisions, credentials, schema or production writes are required. Existing UAT reports are possibly stale relative to #666; this directly observed staging failure is the input.

## Spec

### Decisions

- Determine the polling provider from an explicit allowlist of stored checkout hostnames. Never fetch a stored URL directly. Unknown stored hosts are unverifiable and preserved; creation still uses the active provider.
- Support Xendit's legacy invoice identifier format through the legacy status endpoint, while preserving current session polling.
- Only confirmed gateway expiry clears a genuine link. Failed or unavailable checks preserve the link and return a retry error instead of asserting it is valid.
- Outside demo mode, the exact synthetic `demo.xendit.local` and `demo.doku.local` hosts are locally known to be unusable and may be retired through the existing guarded expiry processor. Demo-mode fixtures retain their current behavior.
- New links continue to use the environment's active gateway and the shared claim. No historical payment or channel backfill.

### Acceptance criteria

- [ ] An expired legacy Xendit link on DOKU staging is replaced with a working active-gateway sandbox checkout; the overdue balance remains owed. (Local regressions pass; signed-in staging pending.)
- [x] A confirmed live legacy link is preserved; a settled legacy payment is reconciled without creating another link.
- [x] An unavailable check preserves genuine stored state and shows a retry error, never a "still valid" success.
- [x] Synthetic fixture links can be replaced outside demo mode, while hostname lookalikes cannot select another provider or trigger synthetic expiry.
- [x] Existing creation-claim and expiry comparison guards remain intact.

### Verify flows

1. Parent: open the observed overdue legacy invoice, request a link, open the sandbox checkout without paying, and request again; expect a payable checkout and reuse of its current live URL.
2. Parent edge/error: unit-level unavailable provider, missing session ID and hostname lookalikes; expect no clearing or duplicate creation and a calm retry response.
3. Admin: invoices list, check outstanding statuses, create missing links, then inspect a detail/history; expect bounded results and correct remaining counts.

### UX notes

Existing actions and app-owned retry messages remain. No visual redesign; design-system reference unchanged.

### Test seams

Adapter normalization, provider resolution, shared reconciliation and the guardian replacement route. Existing whole-suite/production checks and required CI cover integration; signed-in staging confirms the live provider transition.

### Non-goals

Production promotion, settlement, credential changes, direct database fixture changes, historical backfills and registration-fee migration.

### Assumptions

Both legacy Xendit and active DOKU sandbox credentials remain healthy. A hosted checkout is sufficient verification; no payment is authorized or submitted.

### Gate re-openers

None. Any need for schema, credentials or production writes requires reconsidering this scope.

## Tasks

- [x] T1 Resolve stored checkout provider, normalize legacy status, retire synthetic links safely, and fail honestly on unavailable verification; add focused regressions.
- [x] T2 Complete local gates, independent review and the ship hand-off; required CI and post-merge signed-in checks are recorded separately below.

## Implementation

- Plan: driver=gpt-6; `review_routes` implements the narrow payment slice and regressions; `review_payments` independently reviews provider/expiry safety; driver owns the cycle, final gate, merge and browser verification.
- `link-provider.ts` and `registry.ts`: exact HTTPS host allowlist chooses the owner of a stored link; no request is made to that URL. Unknown hosts fail verification without mutation.
- `reconcile.ts`, `webhook-processor.ts`: poll the owner, retire exact synthetic hosts outside demo mode, and carry the observed URL into expiry processing so a replacement installed before processing survives. Existing URL/session comparison writes remain.
- `xendit/client.ts`: legacy 24-hex invoice IDs use the fixed `/v2/invoices` API; current IDs retain `/sessions`. Credit only reported paid amount; both polls retain the 10-second bound.
- Guardian replacement route: unavailable, failed and throttled checks return the existing retry experience instead of asserting a live link.
- `session.ts`: a check timestamp exactly equal to the creator's clock can be claimed; future creation leases remain excluded.
- Regressions cover provider transitions, legacy statuses, synthetic and hostile hosts, failed-check retries, the exact-millisecond claim boundary and URL-only replacement races. Independent payment review found no remaining blocker.

## Verification

- Compared with staging base `c229995ea92446048595b5c976a73b2b13dc9357`. This is other backend code plus a guardian mutation response change; conservatively retain the signed-in staging gate. No frontend source or authentication changes. The exact verified code commit is recorded in the evidence-only follow-up commit.
- Production build passed on Node 24.15. A first sandboxed build cached a local port-binding error; deleting this task's generated `.next` cache and rebuilding with local port permission passed without source/config changes.
- Full Vitest: **637 files passed, 2 skipped; 7,460 tests passed, 42 todo**, 204.76 seconds. Logs: `/private/tmp/pr666-followup-vitest.log`.
- Source ESLint: **0 warnings**, excluding generated Prisma output. Build typecheck and separate worker typecheck passed.
- Driver reran **5 real PostgreSQL cases** on explicit disposable localhost URLs: original concurrent claims, exact-time acquisition and pre-processing URL replacement protection. No staging/production database writes. Log: `/private/tmp/pr666-postgres-followup-driver.log`.
- Production browser, localhost + seeded disposable database + demo auth: overdue no-link invoice created a link (HTTP 200), kept its overdue status/balance, and later reused the same verified link. An immediate throttled ask showed the calm retry error and preserved the link. Admin bulk create returned `created:25, failed:0, remaining:55` (80→55); refresh returned `checked:1, updated:0, failed:0, remaining:0`. No console errors; design-system layout unchanged.
- Docs audit **13 OK / 1 existing ADR-age warning / 0 failures**; API auth **213/213**; RLS **43/43**; hook tests **32/32**; vendored workflow sync passed; soft-skip delta **26→26 = 0**.
- Playwright: original #666 local full run passed 240 tests (one retry), and required CI passed before its merge. This follow-up defers the full Playwright suite to its required **E2E** CI check; local focused browser flows above passed. No new test skips.
- Original #666 staging admin check on `c229995e`: refresh `checked:50, updated:2, failed:0`; create `created:1, failed:0, remaining:0`. A pre-existing gateway settlement reconciled and displayed **Virtual Account BCA** in both ledger and invoice history. Parent legacy checkout remained expired; its failure is why this follow-up exists.
- Required CI and signed-in staging verification for this follow-up remain pending. Keep `needs-staging-verify` on #666 and the follow-up until the final staging walk passes.

## Ship Notes

- Target staging only. Follow-up to #666's failed signed-in legacy-link check.
- No schema, dependencies, environment changes or production writes.
- After merge and exact-commit READY deployment: configured parent Google account → overdue legacy Xendit invoice → request replacement → open DOKU sandbox checkout without paying → verify URL reuse; also replace an exact synthetic fixture. Configured admin Google account → bulk status check and missing-link create → verify counts and the stored channel label. No direct staging database writes.
- Rollback: revert this follow-up through a PR. Keep the original staging-verification label while unresolved.
