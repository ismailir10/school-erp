# Make the nightly cron jobs actually run (2026-10-16)

## Context

A parent paid invoice INV-2026-0121 (Galendra) through DOKU on 8 Oct 2026. DOKU emailed them a PAID receipt, but on
16 Oct the admin invoice list still showed **Link Dibuat** with the full balance outstanding. The admin team asked why,
and the worry is that other paid invoices are sitting unpaid in Talib too.

Three paths can credit a DOKU payment, and all three missed this one:

1. **DOKU's notification.** `docs/runbooks/payments-gateway.md` records that no DOKU notification has ever verified
   for this merchant account. This is a DOKU Back Office configuration question, outside this cycle.
2. **The daily reconcile sweep** (`/api/cron/reconcile-payments`, 00:30 UTC). It polls DOKU for every outstanding
   invoice that has a payment link and credits anything settled. It is the designed safety net for exactly this case.
   **It has never run.** Vercel Cron invokes the configured path with an HTTP `GET` (Vercel docs, "Manage cron jobs":
   every example is a `GET` handler), but both cron route handlers export only `POST`. Next.js answers 405 before
   any of our code runs. The tests call `POST` directly, so they stay green.
   - The sibling `/api/cron/finance-maintenance` (01:00 UTC: SENT → OVERDUE past due, WebhookEvent 90-day purge) has
     the same defect. Corroborating evidence: INV-2026-0121 was due 15 Oct, and on 16 Oct it still shows SENT rather than OVERDUE.
3. **An admin pressing "Cek status pembayaran"** on the invoice detail page. It works, but nobody knew to press it.

Fixing (2) turns every missed DOKU payment into one that is credited by the next morning, with no admin action.

## Decisions

- **Switch both cron routes to `GET`; drop `POST`.** The user approved "make the nightly jobs run". Nothing calls
  `POST`: the `vercel-cron/` User-Agent check already rejects anything but Vercel Cron, and no script, runbook step
  or workflow invokes it. Keeping a dead verb would just be a second entry point to test.
- **Add a guard test that ties `vercel.json` to the code.** For every `crons[].path`, the route module must export
  `GET`. This is the regression that actually happened, and the test catches it for any future cron too.
- **Keep the existing auth unchanged:** Bearer `CRON_SECRET` plus the `vercel-cron/` User-Agent, both fail-closed.
  Vercel sends both on a scheduled invocation.
- **The "check right away when the parent comes back" option is a separate cycle**, on the user's call.

## Acceptance criteria

- [x] `GET /api/cron/reconcile-payments` with Vercel's headers runs the sweep and returns the JSON tally (it returned 405 before).
- [x] `GET /api/cron/finance-maintenance` with Vercel's headers runs and returns its counts (it returned 405 before).
- [x] Both routes still answer 500 without `CRON_SECRET`, 401 on a wrong token and 403 on a non-Vercel User-Agent,
      touching the database in none of those cases.
- [x] A test fails if any `vercel.json` cron path points at a route that does not export `GET`.
- [x] Both routes build as dynamic (never statically cached).

## Verify flows

1. **Scheduled call.** On a local production build: `curl` `GET /api/cron/reconcile-payments` with `Authorization:
   Bearer $CRON_SECRET` and `User-Agent: vercel-cron/1.0` → 200 with `scanned`/`updated`/`tally`.
2. **Same for maintenance.** `GET /api/cron/finance-maintenance` → 200 with `webhookPurged`/`overduePromoted`.
3. **Error case.** Same `GET` with a wrong bearer token → 401. A browser-like User-Agent → 403.
4. **Edge case.** `POST` to either route → 405 (the verb is gone, and nothing calls it).

## Test seams

- Route-handler tests for both crons, invoked as `GET` (the existing suites, converted).
- A config-to-code guard test reading `vercel.json`.

## Non-goals

- Polling DOKU when the parent returns from checkout. That is a candidate next cycle.
- Fixing DOKU's notification delivery (a DOKU Back Office setting) or the webhook's `eventId` collision.
- An alert when a cron fails or credits payments.
- Moving off the Hobby plan's once-a-day cron limit.

## Assumptions

- Vercel Cron's request carries `Authorization: Bearer <CRON_SECRET>` and a `vercel-cron/…` User-Agent. The docs say
  so, and the routes already assumed it.
- `CRON_SECRET` is set on the production project. If it is not, the fixed route answers 500 and logs "CRON_SECRET not
  set". The post-promotion check below will show this.

## Gate re-openers

None. No schema, no dependency, no auth change: the same checks run on a different HTTP verb. It writes to
production only by doing what the crons were always meant to do.

## Tasks

- [x] **T1 — Cron routes answer `GET`.** Rename the handlers, convert both suites to `GET`, add the `vercel.json`
      guard test, update the runbook's verb. Accept: the guard test fails on the old code and passes on the new;
      Vitest green.

## Implementation

- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5 (exploration only: the DOKU payment-path map behind ## Context); T1 inline (why: a verb rename in two handlers plus test conversion, smaller than a worker brief).
- T1: `app/api/cron/reconcile-payments/route.ts`, `app/api/cron/finance-maintenance/route.ts` export `GET` instead of `POST`, with the auth checks and body unchanged and a docblock line on why. `app/api/__tests__/{cron-reconcile-payments,finance-maintenance}.test.ts` invoke `GET`. The new `app/api/__tests__/vercel-cron-methods.test.ts` reads `vercel.json` and imports each `crons[].path` route, asserting it exports `GET`. `docs/runbooks/payments-gateway.md` names the verb.

## Verification

### Verified locally on 2026-10-16, base `d597681f`

- **Reproduced first.** On the unmodified routes, `vercel-cron-methods.test.ts` fails for both crons: `expected 'undefined' to be 'function'` (no `GET` export). After T1 it passes.
- **Full gate.**
  - `npm run lint` is clean.
  - `verify-rls-coverage.sh` reports `43 / 43`. `verify-api-auth.sh` reports `209 / 209`.
  - `npx vitest run` reports `Test Files 621 passed | 2 skipped (623)`, `Tests 7225 passed | 42 todo`.
  - `DEMO_MODE=true npm run build` exits 0 and lists both `ƒ /api/cron/finance-maintenance` and `ƒ /api/cron/reconcile-payments`, so both are dynamic and never prerendered.
  - Playwright did not run: the diff touches no user flow (no page, component or user-facing API), and nothing in `e2e/` calls these routes.
- **Verify flows**, run against `DEMO_MODE=true npm run start` with `CRON_SECRET` set, on a disposable local Postgres 16 that was pushed and seeded. Docker has no daemon in this container, so the database ran as a local cluster on port 54329.
  1. `GET /api/cron/reconcile-payments` with `Authorization: Bearer …` and `User-Agent: vercel-cron/1.0` returns `{"scanned":1,"cappedAtLimit":false,"updated":0,"tally":{"NO_CHANGE":1},…}` [200].
  2. `GET /api/cron/finance-maintenance` with the same headers returns `{"webhookPurged":0,"overduePromoted":0,…}` [200].
  3. A wrong token returns `{"error":"Unauthorized"}` [401] on both routes. A `Mozilla/5.0` User-Agent returns `{"error":"Forbidden"}` [403] on both.
  4. `POST` returns [405] on both. That is the response Vercel's `GET` received before this change.
- **design-system:** n/a. No frontend file is touched.

## Ship Notes
