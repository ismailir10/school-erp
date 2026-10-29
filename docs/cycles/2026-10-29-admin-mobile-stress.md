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

- [x] T1 Stat-card family: `StatCard` fluid figure + icon row, `StatsCardsRow` orphan span, and the same treatment for
      `StatTile`/rail tiles if they share the defect; dashboard + invoice-detail amounts; employee-attendance
      "Terlambat" — accept: tests; the stress probe is clean on those pages. (parallel)
- [x] T2 Invoices phone header: primary + "Lainnya" menu below `sm` — accept: tests; every action works. (parallel)
- [x] T3 `e2e/mobile-stress.spec.ts` — accept: it passes after T1/T2 and fails with T1 reverted. (parallel, finalised
      after T1)

- [x] T4 Small phones (320px), teacher and parent: class-attendance names never truncate, the nav labels fit, and the bill/invoice/progress status lines wrap instead of truncating — accept: tests; the 320 stress pass is clean. (added after the owner asked to check small phones)
- [ ] T5 Stress spec: a 320px teacher/parent pass, a truncated-essentials rule, and precise wrapped-number detection — accept: it fails on the pre-fix build and passes after T4.

## Implementation

- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5-5. T1, T2 and T3 run in parallel on disjoint files. The driver built and ran the 62-route stress probe that scoped the spec; T3 ports its rules into Playwright.
- T3: `e2e/mobile-stress.spec.ts`. 360×780 with touch, one context per role, 15 pages (8 admin + invoice detail, 2 teacher, 3 parent). For each page: networkidle, then wait 1.8 s (CountUp runs 0.9 s and then swaps in plain text), inflate the figures, measure. Rules: (a) no page overflow; (b) no number taller than 1.6 line-heights; (c) no text past a bordered card's padded edge. `expect.soft` per page, about 46 s. Against the pre-fix build it fails on exactly the defects in Context: 6 admin list pages, the dashboard, invoice detail and employee attendance. Teacher and parent pass.
- T2: `app/admin/invoices/invoices-client.tsx` defines the secondary actions once (`{key,label,icon,onSelect,disabled}`, gated as before). They render inline in a `hidden sm:contents` wrapper, and below `sm` in a "Lainnya" `DropdownMenu` with the same icons, labels, "(N)" counts, disabled states and handlers. No JS viewport detection. "Buat Tagihan" stays the visible primary. 9 tests cover the menu contents, role gating, its absence when there is nothing secondary, and each item triggering the same handler. `PendingLinkBreakdownPopover` ("Coba lagi link (N)", shown only when links failed) stays inline: it is a popover with its own fetch.
- T1: `lib/fluid-figure.ts` (`fluidFigureClass(len, cap)` → `text-[length:clamp(0.75rem,Ncqi,cap)]`; buckets ≤4/≤6/≤10/longer → 38/24/15/9 cqi, sized at ~0.6em per mono character to stay under ~91% of the card). `StatCard` puts label and icon on one row and the figure full-width in an `@container`, `whitespace-nowrap tabular-nums`; the old `length>8 → text-h2` branch is gone. `StatsCardsRow` spans an odd last card on phones (`max-lg:[&>*:last-child:nth-child(odd)]:col-span-2`). `StatTile` mono figures get the same fluid treatment, which also fixes the dashboard finance tiles. `RailTile` gains `mono`. Invoice-detail amounts are nowrap/`shrink-0`. The compiled CSS was checked with `@tailwindcss/node`, and `cn()` keeps the clamp class next to a text colour (test added). The worker checked the fit arithmetically; the driver checks it in the browser during verify.
- T4 (added on the owner's request to check small phones; the driver's 320/375 probe and contact sheet found it):
  - **Class attendance:** the list is an `@container`. Below 20rem the row stacks: the full name (2-line clamp, no truncate) sits above a 4-column grid of 44px H/S/I/A radios.
  - **`PortalBottomNav`:** labels are `whitespace-nowrap` with fluid `clamp(0.625rem,3.4vw,0.75rem)` and no truncate, so "Kehadiran" fits at 320.
  - **Shared `TaskRow`:** an opt-in `stackMeta` drops the amount under the title in a body narrower than 15rem, and the description is now `line-clamp-3` instead of truncating. The parent bill row and invoice list opt in, so "2 lewat tempo" and due dates stay visible. Teacher home inherits the wrap.
  - **Compiled:** `@max-[20rem]`/`@max-[15rem]` compile to `@container (width < …)`.

## Verification

- design-system cross-check: §11 Stat Cards (`.stat-label` uppercase caption on top, `.stat-value` 1.75rem bold tabular-nums below, currency in the mono face). T1's label row + full-width figure follows that structure; the fluid cap stays at `--text-display`. §14 Admin List recipe ("page header → primary action → …"): T2 keeps one visible primary action on a phone.

## Ship Notes
