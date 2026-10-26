# Dibayar Sebagian card shows 0 while invoices are partly paid

## Context

An admin at An Nisaa' Sekolahku reported (WhatsApp, 2026-10-26) that the **Dibayar Sebagian** card on Keuangan → Tagihan reads 0, although several invoices have already received part of their payment. The page showed 155 tagihan, 119 Lunas, 11 Lewat Tempo, 0 Dibayar Sebagian and Piutang Rp 105.383.000 across 29 unpaid invoices.

Investigation (code read, 2026-10-26): the card counts invoices whose stored status is Dibayar Sebagian. Since cycle 2026-10-17-payment-link-reminders (D3) a partial payment on an invoice past its due date is stored as **Lewat Tempo**, so only a partial payment made *before* the due date ever shows as Dibayar Sebagian. Most of the school's partly paid invoices are past due, so they sit in Lewat Tempo and the card is 0. The card is wrong, the stored status is by design.

## Decisions

- **D1. The card counts money, not the stored status.** Dibayar Sebagian = still owing and already received some money, whatever the due date. An invoice that is past due and partly paid counts here and still counts in Lewat Tempo (the two cards answer different questions and may overlap).
- **D2. The stored status rule from D3 of the reminders cycle stays.** No data migration, no status change.
- **D3. No new filter option.** The status filter keeps its five questions (D12 of 2026-10-20-payment-link-expiry-display). Not in scope.

## Acceptance criteria

- [ ] An unpaid invoice past its due date with a partial payment counts in the Dibayar Sebagian card.
- [ ] A partial payment before the due date still counts.
- [ ] Paid, cancelled, draft and unpaid-with-no-payment invoices do not count.

## Verify flows

- Admin, Keuangan → Tagihan: record a partial payment on a past-due invoice. The Dibayar Sebagian card increases by one; Lewat Tempo is unchanged.
- Edge: reverse that payment. The card goes back down.

## Tasks

- [x] T1: stats count by money (`partiallyPaidWhere`, shared with the owing rule), tests.

## Implementation

- Plan: single small slice, done by the driver without fan-out (one route, one helper, three test files).
- T1: `lib/finance/invoice-owes.ts` (`partiallyPaidWhere`), `app/api/invoices/stats/route.ts` (`partiallyPaid` is its own count, no longer the PARTIALLY_PAID status group), tests in `invoices-stats`, `invoices-list-status-filter`. design-system: no UI change, the card and its label are untouched.

## Verification

- Gate: `npx tsc --noEmit` and `npm run lint` clean; `npx vitest run` 693 files passed / 2 skipped, 8193 tests passed; `verify-rls-coverage` 43/43, `verify-api-auth` 217/217; `DEMO_MODE=true` build ok.
- Playwright (local, production build, disposable Postgres 16, container Chromium via `executablePath`): `admin-manual-invoice-layout` + `admin` specs, 28 passed (includes the admin tagihan flows).
- Real query on Postgres: seeded 30 partly paid invoices plus two probe partials (one `OVERDUE`, one `PARTIALLY_PAID`) and four that must not count (unpaid overdue, paid, unpaid sent, cancelled with money). Money-based count 32; the old status-only count 31, missing exactly the past-due partial. Probe rows deleted.
- Report scenario reproduced locally: set every stored `PARTIALLY_PAID` row to `OVERDUE` past due (zero stored Dibayar Sebagian, 30 partly paid). `/api/invoices/stats` returns `partiallyPaid: 30` (old code: 0); the page card reads **Dibayar Sebagian 30**, Lewat Tempo 44, Piutang Rp 59.700.000, same as the stats call. design-system: no UI change, the card and its label are untouched.
- Not covered: reversing a partial payment on the live page (the count is derived from `totalPaid`, so it follows the reversal; covered by the query, not walked in the browser).

## Ship Notes

Branch `claude/funny-hopper-0r46jx` (assigned for this session, not `feat/*`). Not auth-impacting. Out of scope, noted: the status filter has no Dibayar Sebagian option (D12 of 2026-10-20-payment-link-expiry-display), so the card cannot be clicked through to its rows.
