# Talib design system and portal consistency

## Context

The November design-system cycles established Talib's token source of truth and mapped Figma's visual principles to the UI standard. On staging `b68b6153`, common controls still used a translucent keyboard focus indicator, several surfaces encoded the same job differently, and long mobile summaries competed with daily work. This cycle audits every signed-in page, then fixes shared patterns in waves while preserving the brand, permissions, calculations, and role-specific workflows. The September full E2E report is older than the design-system cycles and is historical context only.

## Spec

- Audit the route inventory on seeded Chromium at 390 and 1440 px and the teacher and parent portals at 320 px. Verify full admin, school admin, a read-only finance role, teacher, and single- and multi-child parent views where they affect content and actions.
- Reuse existing primitives for focus, cards, stats, alerts, page headers, and overlays. Compare default and exceptional states with the catalog and Talib's visual principles. Target 4.5:1 for normal text and 3:1 for meaningful controls, icons, and keyboard focus. Keep the 44 px touch floor.
- On Tagihan, fit the create action, search, and filters in the first phone viewport. Expose all totals in the collapsed Ringkasan tagihan disclosure. Keep the desktop totals expanded and the dashboard action region within the first 1440×900 viewport.
- Preserve student-detail contact, attention jumps, and finance context. Align teacher and parent home patterns, preserve child-aware navigation, and verify a visible current destination and full navigation labels at 320 px.
- Exercise representative workflows, error recovery, keyboard and forced colors, and reduced motion. Capture before and after states and record outstanding findings and their disposition.

## Tasks

- [x] Inventory routes and compare code, styles, and tests against Talib's standards.
- [x] Improve focus, form contrast, overlays, surfaces, stat tones, and alert announcements. Sync and guard the catalog.
- [x] Adopt the patterns in admin finance and student detail, the two portal homes, and matching controls found in the scan.
- [x] Finish browser comparisons, workflow checks, and repository gates. Fix confirmed regressions and record results.

## Implementation

- Plan: driver=gpt-6.1-sol, workers=gpt-6.1-sol low for shared surfaces and inherited model for token and portal slices. The independent slices ran in parallel. The driver integrated admin workflows and ran the sequential browser and test gates.

Browser baselines use an immutable archive of `b68b6153`. The table maps all 71 page files to Talib's existing recipes. Nested records use disposable fixture IDs.

| Portal | Recipe | Routes relative to the portal |
|---|---|---|
| Admin | Dashboard and settings placement | `/`, `settings` |
| Admin | R1 operational list | `employee-attendance`, `employees`, `classes`, `guardians`, `invoices`, `payments`, `report-cards`, `student-attendance`, `student-journal/monitoring`, `students` |
| Admin | R1 configuration list | `salary-components`, `academic-years`, `fees`, `semesters`, `sentra`, `settings/{campuses,holidays,roles,users}` |
| Admin | R2 detail | `employees/[id]`, `payroll/[id]`, `classes/[id]`, `enrollments/[id]`, `guardians/[id]`, `invoices/[id]`, `sentra/rotations/[id]`, `student-journal/{classes/[id],students/[id]}`, `students/[id]`. Students, classes, guardians and employees use dossier composition where appropriate. |
| Admin | R3 embedded configuration and editors | `report-cards/templates`, `semesters/[id]/{import,objectives,themes}`, `settings/{pendaftaran,pengingat-whatsapp,work-hours}`, `student-journal` |
| Admin | R5 workflow queue | `admissions`, `leave-requests`, `payroll`, `work-queue` |
| Admin | R6 operations and monitoring | `employee-attendance/{daily,monthly}`, `assessments`. The monthly matrix has a dedicated horizontal scroll region. |
| Admin | Exceptions | `design-system` catalog, `enrollments` compatibility redirect to Pendaftaran |
| Teacher | R4 home and account | `/`, `attendance`, `profile`, `slips`, `slips/[id]` |
| Teacher | R5/R6 classroom workflows | `assessments`, `assessments/center/[center]`, `assessments/weekly`, `class-attendance`, `gate`, `student-journal`, `student-journal/entry`, `student-journal/students/[id]`, `sessions/[id]` |
| Teacher | Exception | `sessions` compatibility redirect to the pickup section on Beranda |
| Parent | R4 household and read-only detail | `/`, `profile`, `invoices`, `perkembangan`, `reports`, `attendance`, `perkembangan/[studentId]`, `student-journal` |

### Findings and changes

| Severity | Source and affected users | Resolution and check |
|---|---|---|
| High | `app/globals.css` and shared form controls. Brand-fill focus indicators were often further reduced to 50% opacity. Interactive form borders shared a decorative token at 1.29:1 on white. | Use solid 2 px focus outlines with forced-color and invalid treatment. Separate `--input` from `--border`. The new input token measures 3.29:1 or more against sampled light surfaces. Guard rendered keyboard focus and Escape in `e2e/design-system.spec.ts`. |
| High | Portal tabs, gate controls, dossier navigation and menu search used box-shadow-only outlines. Edge-clipped rows and controls could lose their indicator. | Adopt the shared outline and use inset focus at clipped edges. Inspect keyboard traversal and forced colors. |
| Medium | Raw teal ink in the wizard stepper, reminder link, admin dashboard links and parent attendance glyphs had low contrast. Stat warnings used blue numbers with amber icons. | Use readable teal ink and consistent semantic pairs. Test primary-text and state contrasts. |
| Medium | `Alert`, dashboard, finance and portal callouts used different treatments for similar messages. Absolute actions could crowd narrow alerts. Overlay shadows and motion differed by primitive. | Align purpose, slots, announcement urgency, overlay elevation, and motion. Preserve contextual card density and use existing sections and status components. Test alert variants and reduced motion. |
| Medium | Admin Tagihan placed up to eight metrics ahead of search. Student detail repeated its balance in the desktop rail. | Fold metrics on phones, preserve all figures and retry, and keep the detailed balance and due date in Keuangan. Protect first-screen contact and the dashboard action region with existing tests. |
| Medium | Parent and teacher homes and Lainnya duplicated component anatomy. Gerbang and Sesi left no current tab, and the smallest nav labels shrank below 12 px. | Adopt shared header, cards, alert, and drawer. Keep each role's destinations, preserve child context, and use Beranda for nested teacher tasks. Check rendered label ranges and drawer focus return. |
| Medium | Parent Kehadiran at 320 px. The absolutely positioned status label escaped the weekly grid and widened the viewport by 5 px. | Contain the labels within their status cells, limit scrolling to the grid, and fit all five days with a narrower Status column below 375 px. |
| Medium | `.claude/standards/design-system.html` overrode production tokens through Tweaks, and parity ignored missing tokens and aliases. | Remove overrides, sync examples and public copy, require the documented token families, and compare aliases. |

## Verification

### Verified locally — 2026-11-13

- App: production webpack build, demo auth, and disposable local PostgreSQL. The baseline was `b68b6153`.
- Checked the `design-system` reference, `ui.md`, `patterns.md`, `portal.md`, `colors.md`, and `voice.md` for matching rules and intentional exceptions.
- Baseline Chromium sweep against disposable PostgreSQL completed 291 visits across all 71 routes. Coverage included 96 full-admin, 96 school-admin, 14 read-only finance, 45 teacher, 24 multi-child parent, and 16 single-child parent visits. Permission denials and compatibility redirects were exercised. The single-child Perkembangan index supplied the authorized detail path for the final sweep.
- The first post-change visual comparison covered 26 representative views. Keyboard Lainnya opened to the first link, restored focus on Escape, and preserved the selected child. At 320 px, both navs had five 64×64 px targets and 12 px labels. Kehadiran, the longest label, measured 57.84 px. Gerbang and Sesi had one active Beranda owner. Parent child tabs, teacher gate actions, and attendance radios retained a solid 2 px outline in forced colors.
- The invoice layout tests passed at 390 and 1440 px. A forced summary failure recovered without clearing search or closing the disclosure. Focus and reduced-motion browser coverage passed after correcting the test to expect the inset focus indicator in the dialog scroll area.
- Documentation audit, reference byte parity, full lint, RLS coverage (51 of 51), API auth coverage (239 of 239), and `git diff --check` passed. The final production build and TypeScript passed using webpack and cached production fonts. The default Turbopack build hit a font-fetch panic in this environment.
- Final full Vitest run passed 9,389 tests across 765 files, with 2 skipped files and 42 existing todos. The first run surfaced changed invoice, dossier, and focus expectations and local worker timeouts. The corrected suites passed in isolation and in the final full run.
- The final Chromium sweep covered the same 291 visits and all 71 routes. Four cold-start or redirect timing exceptions cleared on isolated retry. There were no unexpected HTTP errors, unhandled browser exceptions, sideways document overflow, clipped portal nav labels, or missing current portal destinations in the measured views. The authorized single-child detail rendered at both widths.
- Playwright full suite passed all 296 tests in 9.5 minutes on a fresh disposable database. An initial run overlapped the browser audit and hit a local Prisma transaction timeout. The isolated retry cleared it without a code or timeout change.
- All 13 focused final-build Playwright tests passed. They covered invoice search, disclosure and retry, dashboard hierarchy, first-screen family contact, forced-color form focus and reduced motion, teacher roster save and Buku Penghubung persistence, parent child navigation, and the 320 px attendance grid.
- Final focused screenshots show the dashboard action region ending at y=780 in the 900 px viewport and its queue figures sharing a baseline. At 390 px, Tagihan search and filters precede loaded results in the first viewport. At 320 px, parent Kehadiran measured 320 px document width and a 272 px weekly table with all five days visible.
- Before and after screenshots show [Tagihan at 390 px](screenshots/2026-11-13-design-system/invoices-390-before-after.png), [parent Kehadiran at 320 px](screenshots/2026-11-13-design-system/parent-attendance-320-before-after.png), [teacher and parent homes](screenshots/2026-11-13-design-system/portal-homes-before-after.png), and [the dashboard](screenshots/2026-11-13-design-system/dashboard-before-after.png). The dashboard shows before above. The other comparisons show before on the left.
- Review rounds fixed compressed dashboard spacing, a wrapped Hijri date suffix, and the 320 px attendance overflow. The audit used seeded Chromium and sampled exceptional states in the named workflows. The catalog logged report-only notices for remote font styles during the offline sweep.

## Ship Notes

The change is frontend-only and has no schema migration or new environment variables. Preview-smoke the admin invoice disclosure, student finance jump, teacher gate tab, and a parent child switch. Roll back by reverting the feature commits.
