# Admin on a phone — stat cards that fit any number, a sane invoices header, a mobile stress test

## Context

The product owner sent a production screenshot of `/admin/invoices` on a phone (~390px) and asked to "make sure to
stress test the mobile version". On screen:
- Four rows of ragged action buttons.
- KPI cards whose mono numbers are huge, with "Rp 178.137.600" running into the card edge.
- "Lewat Tempo" alone on its row.
- Cards so tall that the invoice list starts far below the fold.

Production runs `main`, which predates the last two cycles; the defect is also on `staging`.

Facts (measured, not guessed). A new mobile stress probe visited 62 of the 67 admin/teacher/parent routes, and every
dynamic route it could reach through a link. It ran at 390 and 360px with touch, first on the seed, then with content
inflated to production-plus sizes (every "Rp …" → "Rp 1.234.567.890", every small count → "12.345"):
- **No page scrolls sideways at either width.** The seed's short numbers hide the problem: the defect is
  data-dependent.
- **With inflated content:**
  - `StatCard` numbers wrap mid-number ("12.34 / 5") on 11 admin list pages: admissions, employee attendance,
    employees, enrollments, guardians, payments, payroll, semesters, student attendance, journal monitoring and
    students.
  - The icon sits in a column beside the number and steals ~40px of a ~150px card.
  - Counts stay at display size whatever the card width. Strings over 8 characters drop to `text-h2`, which still
    overflows at production amounts.
  - The dashboard and invoice-detail Rupiah amounts wrap across lines.
  - On employee attendance, the "Terlambat" label crosses its card's padding.
- **`/admin/invoices` is the only page whose header actions wrap:** 6 actions in 4 rows, 200px. Every other admin
  page's actions fit in one 44px row.
- **Odd card counts leave an orphan:** with `StatsCardsRow` at 2 columns on a phone, 5 cards leave the last one alone.
- Teacher and parent portals pass. The only hits are two tiny day cells that will never hold "12.345".

## Decisions

Taken on the product owner's behalf ("proceed with your best judgement").

1. **KPI numbers size themselves from the card, not the viewport.** The card becomes a CSS container and the figure
   scales with container-query units, capped at the display size. It never wraps (`whitespace-nowrap`) and stays
   `tabular-nums`. This holds for any value length and any grid, not just today's data.
2. **The icon moves to the label row** (label left, icon right), so the figure gets the full card width.
3. **An odd last card spans both columns on a phone** (`StatsCardsRow`), so there is no orphan.
4. **Invoices header on a phone:** the primary "Buat Tagihan" stays visible, and the other actions move into a
   "Lainnya" menu below `sm`. Tablet and desktop are unchanged. Page-local, because no other page needs it.
5. **The mobile stress test becomes permanent.** A Playwright spec visits the stat-card and money-heavy pages across
   the three portals at 360px with touch, inflates content after render, and fails on page overflow, wrapped
   numbers, or text crossing a card's padding. It has one context per portal, keeping the suite lean.

## Acceptance criteria

- [ ] At 360 and 390px, no stat-card figure wraps or crosses its card's padding, with seed data or with inflated
      values ("Rp 1.234.567.890", "12.345").
- [ ] Stat-card icons sit on the label row, and an odd last card spans both columns on a phone.
- [ ] Desktop (1440) stat cards look the same as before: display-size figures, icon top-right.
- [ ] On a phone, `/admin/invoices` shows one primary action plus "Lainnya", and every action in the menu works.
      At `sm` and up, all actions show inline as today.
- [ ] The dashboard and invoice-detail amounts and the employee-attendance "Terlambat" card pass the stress probe.
- [ ] `e2e/mobile-stress.spec.ts` passes. It fails if a stat-card fix is reverted (checked by hand once).
- [ ] The full gate is green.

## Verify flows

1. Admin, 390px: invoices → one primary action + Lainnya, opening the menu → every item (Pengingat WhatsApp, Tagihan
   Manual, Catat SPP di muka, Buat link baru, Cek semua belum lunas) opens what it opened before.
2. Admin, 360px with inflated values: invoices, students, payments, dashboard → no wrapped figure, no edge collision.
3. Admin, 1440: invoices and dashboard look unchanged (before/after screenshots).
4. Edge: an odd number of cards (invoices: 5 count cards) → the last spans the row.
5. Error case: open Lainnya → choose an action → its dialog opens → Batal → back to the page with the menu closed.

## UX notes

The menu label is "Lainnya" (as in the teacher bottom nav). Items keep their current labels and icons. Figures stay
mono (`font-currency`) on admin, per `globals.css`.

## Test seams

- Vitest: `StatCard` (nowrap and container classes, icon in the label row), `StatsCardsRow` (odd-last span class), and
  the invoices header (menu holds the secondary actions below `sm`).
- Playwright: `e2e/mobile-stress.spec.ts` (new) plus the existing suite.

## Non-goals

- Merging `StatCard`/`StatTile`.
- Redesigning admin for phones beyond these defects.
- Compact Rupiah ("Rp 178,1 jt") on cards: full figures stay; the fluid size handles them.

## Assumptions

1. Container-query units (`cqi`) are acceptable. They are supported in every browser Talib targets (Safari ≥16,
   Chrome ≥105).
2. A full figure at ~15px in a half-width phone card is readable.

## Gate re-openers

None.

## Tasks

- [ ] T1 Stat-card family: `StatCard` fluid figure + icon row, `StatsCardsRow` orphan span, and the same treatment for
      `StatTile`/rail tiles if they share the defect; dashboard + invoice-detail amounts; employee-attendance
      "Terlambat" — accept: tests; the stress probe is clean on those pages. (parallel)
- [ ] T2 Invoices phone header: primary + "Lainnya" menu below `sm` — accept: tests; every action works. (parallel)
- [ ] T3 `e2e/mobile-stress.spec.ts` — accept: it passes after T1/T2 and fails with T1 reverted. (parallel, finalised
      after T1)

## Implementation

## Verification

## Ship Notes
