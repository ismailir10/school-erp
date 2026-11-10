# DOKU payment links last until the due date

## Context

An admin (Ais) asked why an invoice due **31 Mar 2027** shows "Link berlaku 9 Des 2026". A payment session's
expiry is the invoice's due date, clamped to at most 30 days from creation. The cap exists only because Xendit
rejects sessions over 31 days. DOKU documents no maximum: `payment_due_date` is minutes with "Max Length: 6"
(≤ 999,999 min ≈ 694 days); Payment Link offers a custom date with no upper bound; BCA VA expiry is up to 8
digits. Production and staging both run `PAYMENT_GATEWAY=doku`, and Xendit is to be deprecated.

Today a far-future invoice (SPP tahap, prepay) gets a link that dies after 30 days, the reconcile sweep clears
it, and the nightly heal mints a new one — a fresh gateway order every month, a dead WhatsApp link in between,
and an admin column that reads as "this bill stops being payable on the 9th".

## Decisions

- **D1 — The cap belongs to the gateway, not the policy.** Each adapter declares its longest session window;
  DOKU 365 days, Xendit stays 30 days. Reason: Xendit is still selectable (unset env → xendit) until it is
  removed; a global 365 would make Xendit reject every far-future session.
- **D2 — DOKU cap 365 days** (525,600 min, 6 digits). Covers any school-year invoice while still guarding a
  mistyped due year. Not 694 days: no invoice needs it and it sits on the field's edge.
- **D3 — No backfill.** Existing 30-day links expire and the nightly heal re-creates them with the new window.
  Admins can force it sooner with "Buat link baru". Rewriting live gateway orders is a production write for no
  user gain.
- **D4 — Accept the longer void exposure.** Voiding clears our link but does not cancel the DOKU order, so a
  voided invoice's order stays payable longer. That case is already caught by the "Perlu dicek" flag; cancelling
  orders at the gateway is a separate change.

## Acceptance criteria

- [ ] With DOKU, an invoice due in ≤ 365 days gets a link that expires at 23:59:59 WIB on its due date.
- [ ] With DOKU, a due date beyond 365 days is capped at 365 days from creation.
- [ ] With Xendit, the 30-day cap is unchanged.
- [ ] Floors are unchanged: due today → +1 day, overdue → +7 days.
- [ ] The DOKU `payment_due_date` sent for the longest window fits 6 digits.
- [ ] The admin invoice list "Link berlaku" for a newly created link on a far-future invoice equals its due date.

## Verify flows

1. Admin (`u_school_admin`) → Tagihan → an invoice due ~4 months out → create/replace its payment link →
   "Link berlaku" shows the due date at 23:59 WIB.
2. Edge: invoice due today → link expiry ≈ now + 24 h.
3. Error/edge: overdue invoice → link expiry ≈ now + 7 days.

## UX notes

No UI change. Main task (admin reads link validity) stays 0 taps; the column simply shows the due date.

## Test seams

- Unit: `resolveSessionExpiry` with an explicit cap (DOKU / Xendit / default).
- Unit: DOKU minutes conversion at the 365-day cap stays ≤ 6 digits.
- Unit: session builder passes the active gateway's cap.

## Non-goals

- Removing the Xendit adapter (its own cycle).
- Cancelling DOKU orders on void.
- Any change to the "Link berlaku" column copy.

## Assumptions

1. Parents pay by Virtual Account only (no QRIS — confirmed by the user). DOKU's VA channels honour a long
   `payment_due_date`; the docs state no limit (direct BCA VA expiry is up to 8 digits of minutes). A rejected session
   surfaces as `paymentLinkError` and the heal retries, so the failure is loud, not silent.
2. Scripts without a gateway (reseed, probes) keep the 30-day default.

## Gate re-openers

None. No schema change, no new dependency, no auth/PII change, no production write.

## Tasks

- [ ] T1 Per-gateway session cap — accept: `resolveSessionExpiry` takes a max window; each adapter declares
  its own (DOKU 365 d, Xendit 30 d); session builder passes the active gateway's; tests cover all three and the
  6-digit bound; stale "30 days" comments updated. (deps: none; reuse: `resolveSessionExpiry`, `getGateway`)

## Implementation

## Verification

## Ship Notes
