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
- [x] T5 Stress spec: a 320px teacher/parent pass, a truncated-essentials rule, and precise wrapped-number detection — accept: it fails on the pre-fix build and passes after T4.

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
- T5: `e2e/mobile-stress.spec.ts` now runs a table of passes: all roles at 360, plus teacher and parent at 320×640.
  - **Rule (b), wrapped numbers:** counts distinct line tops via `Range.getClientRects()` on the element's own text. That removes the false positive on square calendar cells.
  - **New rule (d), truncated essentials:** checked on seeded data before inflation. It covers bottom-nav labels (`nav[aria-label^="Navigasi utama"]`), roster names (`[data-testid=roster-row]`) and the item-description status lines.
  - **Against the pre-fix build:** all 5 passes fail, each on a real defect (about 63 s). Admin stat-card wraps, the employee-attendance "Terlambat" crossing, 7 truncated names at 360 and 19 at 320, the teacher progress line, the parent bill/invoice status lines and "Kehadiran" at 320. It also caught a truncated parent attendance status line, which T4's `line-clamp-3` covers.
- Verify round 1 (full gate + stress spec on the new build):
  - **My T2 change broke an existing spec.** `admin-manual-invoice-layout.spec.ts` failed at 390/320 because "Tagihan Manual" now lives in "Lainnya" on phones. The spec now opens through whichever control is visible and asserts focus returns to it ("Lainnya" on a phone). All 6 of its tests pass.
  - **The stress spec found one remaining crossing:** "TERLAMBAT" in the employee-attendance trend card's 3-up `StatTile` row, +6px. `StatTile` labels drop their wide tracking when the tile is narrower than 7rem (`@max-[7rem]:tracking-normal`), and the trend tiles' padding goes `px-3` → `px-2.5`.
- Verify round 2 (driver review of the 390px screenshots): everyday Rupiah figures ("Rp 55.825.000", 13 characters) fell into the smallest tier and rendered smaller than the counts beside them, inverting the hierarchy on a money page. `fluidFigureClass` gains a ≤14-character tier at 10.5cqi (14 × 0.6em × 10.5 ≈ 88% of the card), so those amounts are ~17% larger, and "Rp 1.234.567.890" keeps 9cqi. The test asserts both tiers.
- CI round 1: the CI `E2E` job failed only `mobile-stress` admin@360. "Terlambat" crossed its tile's padding by 3px on the runner (+6px pre-fix locally, 0 after round 1): the runner's font rendering is a few px wider. Root cause: the label fit with almost no slack. Narrow tiles (<7rem) now also step the label down to 10px (`@max-[7rem]:text-[0.625rem]`), ~7px of headroom on top of the dropped tracking. The other CI checks were green.

## Verification

- design-system cross-check: §11 Stat Cards (`.stat-label` uppercase caption on top, `.stat-value` 1.75rem bold tabular-nums below, currency in the mono face). T1's label row + full-width figure follows that structure; the fluid cap stays at `--text-display`. §14 Admin List recipe ("page header → primary action → …"): T2 keeps one visible primary action on a phone.

### Verified locally — 757db78f, 2026-10-30
- Route: other code (no auth, session or guard paths). Compared `origin/staging` f7822dda...757db78f: 25 files across `components/admin/{stat-card,stats-cards-row,detail-rail,guardians,dashboard/attendance-trend-chart}`, `components/ui/stat-tile`, `components/portal/{portal-bottom-nav,task-list}`, `app/admin/invoices/{invoices-client,[id]/page}`, `app/teacher/class-attendance`, `app/parent/{page,invoices/client}`, `lib/fluid-figure.ts`, tests, `e2e/{mobile-stress,admin-manual-invoice-layout}.spec.ts`.
- Gate (disposable Postgres):
  - `npm run lint` → exit 0.
  - `npx vitest run` → `Test Files 734 passed | 2 skipped (736)`, `Tests 8931 passed | 42 todo (8973)`.
  - Guards → RLS + API-auth OK.
  - `DEMO_MODE=true` build → exit 0.
  - `npx playwright test` → `268 passed (7.2m)`, 1 skipped. That includes all 5 `mobile-stress` passes (admin, teacher and parent at 360; teacher and parent at 320) and the 6 updated manual-invoice layout tests.
  - The stress spec failed all 5 passes against the pre-fix build, each on the defects in Context.
- App: production build, demo auth + disposable local Postgres.
- Walked:
  - `/admin/invoices` at 390: the header is "Lainnya" + "Buat Tagihan" on one row. The menu lists "Buat link baru (78) | Cek semua belum lunas | Pengingat WhatsApp | Tagihan Manual | Catat SPP di muka". Tagihan Manual opens its dialog, and on Escape focus returns to "Lainnya".
  - With inflated content, "12.345" and "Rp 1.234.567.890" fit their cards without wrapping, and the odd "Lewat tempo" card spans the row.
  - At 1440 the inline actions and display-size figures are as before.
  - Teacher class attendance at 320: full names, with the H/S/I/A row stacked below.
  - Parent home at 320: "2 lewat tempo" is visible, the amount sits under the title, and "Kehadiran" is in full in the nav.
- Driver probe, 64 of 67 routes × 320/360/390 with inflated content:
  - No page overflow anywhere.
  - At 360/390, no real defect. The remaining hits are inflated "12.345" in monthly-grid and calendar day cells, which no real day can hold (box-height false positives that the Playwright rule fixes), and a +1px URL in the WhatsApp template preview.
  - At 320, teacher and parent have no real defect.
- Console/network: 0 errors.
- Highlight: `docs/cycles/screenshots/admin-mobile-stress/invoices-390-before-after-stress-menu.png` (before · after · after with production-plus numbers · Lainnya open) and `parent-home-320-before-after.png`. Also `teacher-class-attendance-320.png`.
- Rounds: 2.
  - Round 1: the manual-invoice spec follows "Lainnya" on phones, and narrow tile labels drop their wide tracking.
  - Round 2: everyday Rupiah figures get a ≤14-character tier, so they are no smaller than the counts.
- Not checked: admin at 320px (desktop-first portal, not in the request). The probe still flags the dashboard count, invoice/payroll detail amounts and two filter labels there — see the follow-ups.

## Ship Notes

- **Migrations / env / dependencies:** none.
- **Visible changes on phones:**
  - Admin stat cards put the label and icon on one row with the figure below, sized to the card, and an odd last card spans the row.
  - The invoices header becomes "Lainnya" + "Buat Tagihan".
  - Teacher class attendance stacks the H/S/I/A row under the name in narrow rows.
  - Parent nav labels never truncate.
  - Bill and invoice status lines wrap.
- **Desktop:** unchanged apart from the stat-card icon now sitting in the label row.
- **Post-merge:** the Vercel staging deploy is `READY`. Open `/admin/invoices` and `/parent` on a phone. No auth impact.
- **Rollback:** revert the squash commit.
- **Follow-ups:**
  - Admin at 320px: dashboard KPI count, invoice/payroll detail amounts, and the classes/semesters filter labels.
  - Port the precise wrapped-number rule into the driver probe.
