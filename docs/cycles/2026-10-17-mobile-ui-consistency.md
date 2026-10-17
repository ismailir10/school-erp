# Mobile UI consistency pass (2026-10-17)

## Context

Request: "improve UI, make sure UI consistency, reusable components, less custom CSS; make sure the mobile version is good for all roles, review carefully, hard-test locally."

Facts from a local audit (production build, demo auth, disposable Postgres, Chromium at 390×844 touch, 56 routes across admin, teacher and parent, plus the create dialogs, nav drawer and row menu):

- **Teacher and parent portals are in good shape.** No sideways scroll, no controls under 36 px, headings and empty states consistent. Nothing to redesign.
- **No page scrolls sideways** on any role. The problems are inside the admin portal.
- **Hand-rolled leftovers are few.** Across `app/` + `components/` (outside `components/ui` and the deck/reactbits showpieces): 3 raw `<table>`, 3 raw `<button>` (month/day steppers), 1 `animate-pulse`, 4 `useIsMobile` branches. The codebase already follows the shadcn-first standard.
- **Admin on a phone, real defects:**
  1. Tables clip their cells with no way to see the rest: Users (role column cut to "Pe"), Roles (description), Holidays (names), Leave requests (date range), Work queue (job title), Academic years ("Sta…", "Kelola kela"), Admissions ("7 tah"), Guardians (children's names), Employees (position "Jaba…"). The documented mobile contract (≤3 columns + actions, the rest as a wrapped line under the name) is not applied on these lists.
  2. Tap targets under 44 px: text inputs and native selects 32 px, breadcrumb links 20 px, tab triggers 25 px, collapsible section headers 20 px, month steppers 32–34 px, class-calendar cells 54×35, journal template row buttons 28×44, week steppers 32×44. `Button` and the Radix-style `Select` already raise themselves on touch (`[@media(pointer:coarse)]:min-h-11`); `Input`, `NativeSelect`, `TabsTrigger`, `BreadcrumbLink` and the others do not.
  3. The filter bar stacks every dropdown full-width (3–4 rows on Kelas, Biaya, Guardians) and pushes the list below the fold.
  4. Employees list renders the staff code glued to the name ("Staf EnamE028").
  5. Two `PageHeader` components with different prop names (`description` vs `subtitle`) and slightly different wrapping; stat tiles come in three looks (dashboard/list `StatCard`, compact detail tiles, `Perlu ditangani`).
- Not a defect: `/teacher/slips/:id` measured 30 s in the sweep, but a re-request answers in 22 ms. It was a `networkidle` stall in the harness, not the app.

## Decisions

Asked and answered by the user (all four recommended options):

1. **Scope: shared components first.** Fix the primitives so every page inherits it, then patch the specific pages the audit found. No visual refresh: brand, colors and type scale stay.
2. **Tables: enforce the existing mobile contract.** Keep `DataTable`; each list shows at most 3 data columns + the actions menu below `md`, the other facts as a wrapped `DataTableMobileMeta` line. No card-list rewrite.
3. **Filters: two-column grid below `sm`.** Search full width; dropdowns two per row; reset beside them. No new pattern.
4. **Leave a guard behind.** One lean Playwright spec at 390 px.

Made while building:

- Touch targets follow the pattern already in `Button`: a `[@media(pointer:coarse)]:min-h-11` floor, so the desktop look (mouse) is unchanged.
- The two `PageHeader`s become one implementation; the portal one keeps its `subtitle` prop and delegates, so no caller changes.
- Work happens on the harness-assigned branch `claude/zealous-pasteur-j3y4nj` instead of `feat/<slug>` in a worktree (the session was started on it).

## Acceptance criteria

- [ ] At 390 px, admin, teacher and parent routes have no horizontal page scroll and no table whose cells are clipped (a table may scroll, but every list shows its identity, status and actions without scrolling).
- [ ] On a touch device every interactive control the audit flagged is ≥ 44 px tall (inputs, native selects, tabs, breadcrumb links, collapsible headers, steppers, calendar cells, journal template row buttons).
- [ ] On a mouse the controls look as before (heights unchanged).
- [ ] Filter bars on Kelas, Biaya, Guardians and the other `DataTableToolbar` lists use two dropdowns per row on a phone.
- [ ] The staff code on Employees no longer touches the name.
- [ ] One `PageHeader` layout implementation; every caller still renders the same title/description/actions.
- [ ] A Playwright spec sweeps the audited routes at 390 px for the three roles and fails on overflow, a sub-44 px control or a clipped table cell.
- [ ] Vitest, lint and the build are green; teacher and parent screens are visually unchanged.

## Verify flows

1. **Admin, phone.** `u_super_admin` at 390×844: open Users, Leave requests, Academic years, Guardians, Employees. Expect: name + status + actions visible without scrolling, extra facts wrapped under the name, filters two per row. Edge: Users with a long email. Error: Employees search that matches nothing shows "Tidak ada hasil yang cocok".
2. **Admin forms, phone.** Open Tambah Siswa and Tagihan Manual: inputs and selects are tall enough to tap; the sheet still scrolls with the docked footer.
3. **Teacher + parent, phone.** Walk `/teacher`, class attendance, journal entry, `/parent`, invoices: unchanged, controls still ≥ 44 px.
4. **Desktop sanity.** Admin at 1280 px: Students, Invoices, Fees: layout and heights identical to before.

## UX notes

Primary action per screen unchanged. No new copy except none. The staff code stays a small mono tag, on its own line below the name on a phone.

## Test seams

- Vitest (jsdom): `Input`/`NativeSelect`/`TabsTrigger` carry the coarse-pointer floor class; `DataTableToolbar` filter grid classes; `PageHeader` renders title, description/subtitle, badge and actions.
- Playwright `e2e/mobile-layout.spec.ts` (390 px): overflow, tap-target and clipped-table sweep.

## Non-goals

Card-list tables; a filter sheet; any color, type or brand change; desktop layout changes; the deck and reactbits showpieces; moving the admin to a bottom-nav shell.

## Assumptions

1. 44 px is the floor for touch (matches the existing `Button` rule and the better-accessibility skill).
2. "Mobile" means ≤ 767 px with a coarse pointer; tablets and desktop keep their current layout.
3. `DatePicker` already renders the platform picker on touch, so the US-style `mm/dd/yyyy` in headless Chrome is the emulated locale, not a bug.
4. Seeded duplicate guardian names are seed data, not a defect.

## Gate re-openers

None: no schema, dependency, auth, PII or production write.

## Tasks

- [x] **T1 — Touch-target floor in shared primitives.** `Input`, `NativeSelect`, `Textarea` (min height), `TabsTrigger`, `BreadcrumbLink`/breadcrumb list, collapsible/accordion triggers, `Checkbox`/`Switch`/radio hit areas, `DatePicker` trigger. accept: unit tests assert the floor class; mouse heights unchanged. (reuse: `Button`'s coarse pattern)
- [x] **T2 — `DataTableToolbar` two-column filters + one `PageHeader`.** accept: grid classes tested; callers unchanged. (deps: none; parallel with T1)
- [x] **T3 — Steppers and calendar.** Replace the hand-rolled `<button>` month/day steppers (employee attendance monthly, attendance calendar close, `WeekNavigator`) with `Button` icon sizes; raise class-calendar cells and journal template row buttons. accept: ≥ 44 px on touch. (deps: T1)
- [x] **T4 — Mobile table contract on the clipped lists.** Users, Roles, Holidays, Leave requests, Work queue, Academic years, Admissions, Guardians, Employees, Semesters: `priority: "low"` + `DataTableMobileMeta`; fix the Employees code spacing. accept: no clipped cell at 390 px. (parallel slices, one worker per page group)
- [x] **T5 — Stat tiles.** One compact variant of `StatCard` used by the detail pages' tile rows, so list and detail tiles share a source. accept: dashboard/list look unchanged; detail tiles use the component. (deps: none)
- [x] **T6 — Guard.** `e2e/mobile-layout.spec.ts` + standards note in `ui.md` (touch floor, toolbar grid). accept: spec green locally, fails on an injected regression. (deps: T1–T5)

## Implementation

- Plan: driver=claude-sonnet-5-5, workers=claude-sonnet-5-5 (T4 per-page slices, disjoint files, parallel); T1, T2, T3, T5 inline (small edits to shared primitives, each needs the whole picture of the others); T6 after T1–T5. No Opus-tier driver was available in this session; opencode-style small cycle, gated by the review below.

- T1: `components/ui/{input,native-select,input-group,tabs,accordion,async-combobox,breadcrumb}.tsx`, `components/admin/dossier-section.tsx`, test `components/ui/__tests__/touch-targets.test.tsx`. The coarse-pointer 44 px floor, same `[@media(pointer:coarse)]:min-h-11` pattern `Button`/`SelectTrigger` already use; breadcrumb links grow their hit area with an `::after` (layout unchanged); the collapsible section header's padding moved from the row onto the trigger so the whole 44 px row is tappable; `NativeSelect` text is 16 px below `md` (iOS zoom). Cross-checked against `design-system.html` (controls, tabs, breadcrumb, overlays): no token or look changes.
- T2: `components/ui/data-table-toolbar.tsx` (phone grid), `components/admin/page-header.tsx` (+`className`), `components/portal/page-header.tsx` (now delegates), tests in `data-table-toolbar.test.tsx`, `components/admin/__tests__/page-header.test.tsx`. design-system: filter-bar and page-header recipes unchanged above `sm`.
- T3: new `components/ui/period-stepper.tsx` (+ test) replaces eight hand-rolled month/week steppers (employee attendance monthly, employee detail attendance, class sessions calendar, admin journal monitoring/class/student); `size="icon"` / `"icon-sm"` replace the hand-copied `h-8 w-8 p-0 [@media(pointer:coarse)]:min-w-11` on data-table pagination, row actions, admissions row actions and the journal category accordion (so the same 44 px floor comes from `Button`, one place; icons are now the Button default 16 px instead of 14 px); `ClassSessionsCalendar` renders a day-by-day list below `md` (a 7-column grid is ~44 px per cell at 390 px; test added). design-system: button sizes and stepper pattern unchanged; the stepper is the standard `Button` icon.
- T5: new `components/ui/stat-tile.tsx` (+ test): one compact label-above-number tile (optional `href`, tone, size, mono figure). It replaces four hand-rolled copies: `RailStatTiles` (detail pages), the dashboard `QueueSummaryTiles`, `FinanceTiles` and the attendance `TrendPill`. That removes the `text-[10px]` arbitrary size (now `text-caption`) and the value-first/label-first split. `StatCard` stays the icon + count-up KPI card for list pages. design-system: stat tile recipe (caption label, tabular figure); finance tiles stack label over number instead of sitting inline.
- T4 (three workers, one per page group; I reviewed each diff and re-measured in the browser): HR lists (`employees`, `leave-requests`, `payroll`, `salary-components`), academic lists (`academic-years`, `semesters`, `guardians`, admissions `columns.tsx`), settings + queue lists (`users`, `roles`, `holidays`, `campuses`, `admin-work-queue`, journal `monitoring`). Pattern everywhere: secondary columns `priority: "low"`, the facts a phone needs repeated under the name with `DataTableMobileMeta`, identity cells `whitespace-normal`. Employees: the staff code had no gap from the name (the link is `inline-flex`, which swallows the space); it is now a margin on desktop and part of the phone meta line. Work queue: the action is an icon-only arrow below `md`. I added the pages the workers did not cover that the browser still flagged: class roster, payroll detail, fees components table, employee attendance (daily), plus 16px text on four date/month inputs and the teacher date-recovery input.
- Follow-ups to T1 from the browser pass: `Toggle` and `TabsTrigger` floors (tab strip wraps its triggers instead of a fixed `h-11` that left triggers at 37px), 44px for the dossier-section header's label (it wraps instead of truncating "Daftar Si…"), "Lihat semua", the invoice checkout link, roster name link, work-hours day chips. Back link on monthly employee attendance now uses the portal `BackLink`.
- T5 correction found by looking at the dashboard: `cn()`/tailwind-merge does not know our `text-display`/`text-h2` size tokens and drops them next to `text-foreground`, which silently shrank the tile figures. `StatTile` composes the size as a plain string and merges only the colour (test added). The same trap exists anywhere a size token and a colour meet in one `cn(...)`; not changed here (a global fix would alter other screens).
- T6: `e2e/mobile-layout.spec.ts` (51 routes: admin 35, teacher 9, parent 7) + `.claude/standards/ui.md` (touch targets, filter grid, calendar rule, new components). The spec caught real defects on its first runs (fees, class roster, payroll detail, teacher date input) and I confirmed it fails on an injected 20px button, a 12px field and a 900px element.

## Verification

_(filled in by verify-local below)_

## Ship Notes
