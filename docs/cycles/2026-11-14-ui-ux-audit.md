# UI/UX audit, then the five P1 fixes (UX-R1, R2, R3, R9, R12)

## Context

The user asked for a comprehensive UI/UX audit of the admin, teacher and parent portals, judged against our own standards, "don't make me think" and cross-page consistency. The output is a roadmap Codex and other harnesses can pick up. Each item points at the problem and says how to re-verify it before fixing. Two examples set the bar:
- **The Sentra "Kampus" dropdown** feels off: the popup covers its own field, and the admin is asked for something the app should know.
- **Names should open their record.** On an invoice, the student's name should open the student, without searching the Siswa page.

The audit shipped first in this cycle (T0) as `docs/uat/reports/2026-11-14-ui-ux-audit.md`. The user then asked for one big cycle to fix the most impactful items: the five P1s.

Inputs from the report (major findings) that this cycle fixes:
- **Names that go nowhere (UX-R2).**
  - The admin invoice and payment lists send the student's name to the invoice.
  - The invoice detail never links to the student or the wali.
  - Class names on student, guardian and attendance views are plain text.
  - Employee names are plain on staff daily and monthly attendance, approvals, payroll and the class detail.
  - Guardian-list child names and the journal-student header are plain text.
  - Teacher roster names (class attendance, weekly and center assessments) lead nowhere.
- **Campus (UX-R1).** The admin header shows "Semua kampus (2)" as plain text that looks like a control. Sentra asks for a campus inside a dropdown and silently defaults to the first one. The three staff-attendance pages each ask again and forget the choice on the next page.
- **Dropdown (UX-R3).** Every shared dropdown (90 call sites) opens on top of its own field. On staging, campus options all start with the same long school prefix, so the distinguishing word comes last.
- **Parent pay (UX-R9).** Once a link exists, "Bayar sekarang" is the last element of a sheet taller than a phone screen. Before that, parents must tap "Buat link pembayaran" first: 4 taps plus a scroll.
- **Small bugs (UX-R12).**
  - The teacher check-in sheet title says "Anda di luar area kampus" when the location could not be read.
  - The journal-student page highlights "Pengaturan" in the sidebar.
  - Two "KB / Kelompok Bermain" journal rows can't be told apart.
  - Two admin routes have no route-level loading skeleton.
  - The payroll delta reads "Rp -118.182vs periode lalu".

## Decisions

1. **No campus switcher; remove the header campus line.** The user judged a switcher unnecessary, so the static campus text leaves the admin header (the academic-year line stays). Pages that need a campus keep their own control, made obvious:
   - **Sentra:** data is per campus, so the control stays. It becomes a segmented choice (one tap, both campuses visible) instead of a dropdown, and is hidden when the school has one campus.
   - **Staff attendance (today, daily, monthly):** the chosen campus travels with the user between the three pages through the address, so it is no longer forgotten. The control is hidden with one campus.
2. **"Names are doors" rule, adopted and generalised by the user.** Wherever the UI names a student, guardian, class, employee or invoice (table cell, detail header, fact, card), that name opens the entity's own page, as long as the viewer can open it. In a list, the row's own subject is the identity link. On invoice and payment lists the invoice number becomes the identity (opens the invoice) and the student name opens the student. This is written into `.claude/standards/ui.md` so future work follows it.
3. **Links never dead-end on a permission.** An employee name links only for viewers with HR access. A default school admin sees plain text on the class detail instead of a link that bounces them.
4. **Links never nest.** Where a whole row or card is already a link, it is restructured so the name and the row's own action are separate targets, each at least 44 px on touch. One exception: the parent invoices "other children" row stays a single link, because its job is switching child and a second target would confuse it.
5. **One pinned "Bayar" button (user's choice).** The invoice sheet gets a pinned footer with one button, "Bayar Rp 450.000".
   - **Link already exists:** the button opens checkout, as today.
   - **No link yet:** one tap creates it and goes straight to checkout in the same tab. A browser blocks a new tab opened after a network wait, so this path stays in the tab, and the gateway's return page brings the parent back.
   - **"Buat link pembayaran" / "Minta link baru"** survive only as error recovery, next to the school contact.
6. **Dropdowns open below their field.** The shared default changes once, for every call site. Campus option labels drop the prefix that all of a school's campus names share ("An Nisaa' Sekolahku …"). The prefix is computed from the list itself: no schema change, and nothing changes for schools whose names don't share one.
7. **One cycle, one PR.** The work continues on this session's branch and PR [ismailir10/school-erp#739](https://github.com/ismailir10/school-erp/pull/739), instead of a fresh `feat/*` worktree. The harness pins this session to that branch.
8. **The pay flow gets a staging check after merge.** The real payment gateway can't run locally, so the PR carries `needs-staging-verify`. The success, return and error states are covered by unit tests with the gateway mocked, and by the local error path.

## Acceptance criteria

- [ ] The admin header no longer shows a campus line; the academic-year line still shows.
- [ ] On Sentra with two campuses, both campus names are visible as one segmented choice, the current one is marked, and switching is one tap. With one campus there is no control.
- [ ] On staff attendance, a campus picked on one of the three pages is still picked after moving to either of the others through their own links.
- [ ] Every shared dropdown opens below its field, and the field stays readable while it is open.
- [ ] Campus option labels show only the distinguishing part when all campus names share a prefix ("Metland Cibitung", "Taman Aster").
- [ ] On the invoice and payment lists, the invoice number opens the invoice and the student name opens the student.
- [ ] The invoice detail links the student name and the wali name to their pages.
- [ ] Class names on student list, student detail (header, Kelas saat ini, Riwayat Kelas), guardian children, and student attendance open the class.
- [ ] Guardian-list child names and the journal-student page header open the student.
- [ ] Employee names on staff daily, monthly, pending approvals, payroll detail, class teachers, and wali kelas open the employee for a viewer with HR access, and are plain text otherwise.
- [ ] Teacher class-attendance, weekly-assessment and center-assessment names open that child's journal week, and the H/S/I/A controls keep working.
- [ ] Parent profile child cards: the child's name opens Perkembangan, and the rest of the card keeps its link to Kehadiran.
- [ ] The parent invoice sheet always shows one "Bayar Rp …" button pinned at the bottom without scrolling, at 390×844.
- [ ] With no payment link, one tap on "Bayar" creates the link and goes to checkout.
- [ ] If link creation fails, the parent sees why plus a "Coba lagi" path, and sees the school contact when it is configured.
- [ ] The teacher check-in sheet title reads "Lokasi tidak terbaca" when the location could not be read, and "Anda di luar area kampus" only with a measured distance.
- [ ] The journal-student and journal-class pages highlight "Buku Penghubung" in the sidebar.
- [ ] Journal monitoring rows show each class's campus.
- [ ] Staff daily attendance and Sentra rotation detail show their own loading skeletons.
- [ ] The payroll delta reads "Rp -118.182 vs periode lalu".
- [ ] `ui.md` states the "names are doors" rule.
- [ ] The parent and teacher jobs files match the new behaviour.

## Verify flows

1. **Admin finance, `u_school_admin`, desktop.** `/admin/invoices` → tap an invoice number → the invoice opens. Back, tap the student name → the student opens. On the invoice detail, tap the student, then go back and tap the wali → each opens. Repeat on `/admin/payments`.
2. **Academic and HR links, `u_school_admin` then `u_super_admin`.**
   - Student detail → tap the class → the class opens.
   - Class detail as `u_school_admin`: teacher and wali names are plain text. **Edge case.**
   - Class detail as `u_super_admin`: the same names open the employee.
   - Staff daily and monthly as `u_super_admin` → tap a name → the employee opens.
3. **Campus, `u_school_admin`, desktop and 390 px.**
   - The header shows the year only.
   - `/admin/sentra` → the two-campus segmented choice → tap the other campus → its sentra load.
   - Any dropdown opens below its field.
   - `u_super_admin` on staff monthly → pick Taman Aster → open Harian → still Taman Aster.
4. **Parent pay, `u_rightjet`, 390×844.**
   - Tagihan → an unpaid invoice → "Bayar Rp …" is visible at the bottom without scrolling.
   - Tap it: locally the gateway has no key, so creation fails → an error message plus "Coba lagi" and the contact box. **Error case.**
   - The success path (link created → same-tab navigation) is covered by unit tests with the gateway mocked, and by the staging check.
5. **Teacher, `u_teacher`, 390 px.**
   - Class attendance → tap a child's name → their journal week opens. Back, tap "S" on a child → still marks Sakit.
   - Check-in with no location → the sheet title reads "Lokasi tidak terbaca".

## UX notes

- **Tap counts.** Each main task gets shorter, and none gets longer:
  - Reaching the student from an invoice: about 4 taps plus a search → **1 tap**.
  - Reaching the class from a student: 3 taps (sidebar, list, row) → **1 tap**.
  - Parent paying from home with no link yet: 4 taps plus a scroll → **3 taps** (tile, invoice, Bayar).
  - Switching campus on Sentra: 2 taps (open, pick) → **1 tap**.
- **Link styling** follows the existing `DataTableLinkCell` look:
  - names in normal text weight: foreground colour, underline on hover and focus, visible focus ring;
  - names inside muted meta lines: stay muted, underline on hover and focus;
  - every link is at least 44 px tall on touch.
- **Pinned pay footer.** It sits under the scrolling body and keeps the sheet header visible. One primary button, with the amount in its label. Secondary recovery actions are ghost buttons under it, shown only after a failure.
- **Sentra campus control:** a segmented toggle with the short campus names, placed where the dropdown was, with the same "Kampus" label.
- Copy follows `voice.md`: "Bayar Rp 450.000", "Lokasi tidak terbaca", "Coba lagi".

## Test seams

- **Vitest:**
  - the campus-label shortening helper (shared prefix, no prefix, one campus, word boundary);
  - the entity-href helper, including the HR permission rule;
  - the invoice and payment list tests, updated: the invoice-number link goes to the invoice, the student link goes to the student;
  - invoice-detail links;
  - invoice-sheet button states: ready, no link, creating, failed;
  - check-in title by state;
  - admin-nav active item for journal student and class routes;
  - the payroll delta text.
- **e2e (local Playwright):**
  - `sentra.spec.ts` updated to the segmented choice;
  - one assertion added to an existing admin finance spec (the student link from the invoice list);
  - one to `parent.spec.ts` (the Bayar button is in the viewport on the invoice sheet);
  - the suite stays lean, with no new spec files.

## Non-goals

- A global campus switcher or any per-user preference storage. The user declined it.
- The P2/P3 roadmap items: UX-R4 list shape, R5 primary actions, R6 undo, R7 defaults, R8 colours and words, R10 parent context, R11 journal row behaviour, and R3c (unifying native and shadcn selects).
- New permissions or role changes; the school contact number configuration (already env-driven).
- Linking names inside hover cards that touch screens can't reach (admissions "Saudara terdeteksi"). Recorded for UX-R4.

## Assumptions

1. "Remove it" means removing the header campus text, not removing campus choice from Sentra, since Sentra data is per campus. Staff attendance keeps its "Semua Kampus" filter, now carried between its three pages.
2. The academic-year line stays in the header.
3. The gateway's return page after checkout already brings the parent back to Tagihan with the result. If build finds otherwise, the no-link path opens checkout in a new tab opened inside the tap instead.
4. Teacher roster names open `/teacher/student-journal/students/[id]` (the child's week), the only student page teachers have.
5. Parent child names open Perkembangan for that child.
6. Short campus labels apply wherever a campus is an option or a toggle. Detail fields and the campus settings page keep the full name.

## Gate re-openers

None: no schema migration, no new dependency, no new permission or PII exposure. Links reuse existing pages and their existing guards. Several `app/api` responses gain an id field that the list already relates to (student id on payments and student rows, class id on student rows, campus name on journal monitoring rows), with no change to who can call them. The pay flow is not auth-impacting, but it does reach the payment gateway, so it is marked for a staging check (Decision 8).

## Tasks

T0 is done. T1, T2, T3, T7 and T8 are independent and can run in parallel. T4, T5 and T6 depend on T3 and can run in parallel with each other.

- [x] **T0** — Audit and roadmap report. Accept: report and screenshots committed (e0a788d9).
- [x] **T1** — Dropdown opens below its field, plus the campus short-label helper, applied to campus options. Accept: helper Vitest; dropdowns open below at 1440 and 390. Reuse: `components/ui/select.tsx`, `lib/format.ts`.
- [ ] **T2** — Remove the header campus line; Sentra segmented campus choice; staff-attendance campus carried between its pages; controls hidden with one campus. Accept: verify flow 3; `sentra.spec.ts` updated. Deps: T1 (short labels).
- [x] **T3** — The "names are doors" rule in `ui.md`, and an entity-link helper (hrefs plus the HR rule). Accept: helper Vitest; `ui.md` section.
- [ ] **T4** — Finance links: invoice list (number = identity, student link), payments, invoice-detail student and wali, guardian-detail invoice rows. Accept: verify flow 1; list tests updated. Deps: T3.
- [ ] **T5** — Academic links:
  - students list class;
  - student detail header, Kelas saat ini and Riwayat Kelas;
  - guardian children list (row restructured);
  - guardians-list children;
  - student-attendance class;
  - journal-student header to the student.
  
  Accept: verify flow 2 (academic part). Deps: T3.
- [ ] **T6** — HR and portal links: staff daily, monthly and approvals; payroll detail; class teachers and wali kelas (HR-gated); teacher rosters (class attendance, weekly, center); parent profile cards. Accept: verify flows 2 and 5. Deps: T3.
- [ ] **T7** — Parent pinned "Bayar Rp …" footer, one-tap create-and-go, failure recovery; update `docs/uat/jobs/parent.md`. Accept: verify flow 4; sheet tests.
- [x] **T8** — Small bugs:
  - check-in title by state (update `docs/uat/jobs/teacher.md`);
  - journal sidebar active item;
  - monitoring campus sub-line;
  - two `loading.tsx`;
  - payroll delta space.
  
  Accept: their Vitest and verify flow 5.

## Implementation

- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5.
  - **Wave A (parallel):** W1 = T1 then T2, sequential because they share the campus files. W2 = T3. W3 = T7. W4 = T8, except the payroll space, which moves to T6 because T6 already edits that file.
  - **Wave B (parallel, after T2 and T3):** W5 = T4, W6 = T5, W7 = T6.
  - **Shared tree:** workers edit disjoint files and never commit. They run only targeted Vitest and ESLint. The driver runs tsc, the build and the full Vitest suite, reviews each diff, and commits one task at a time.
  - **Reviews:** a Sonnet reviewer covers standards, spec and security on the `app/api` diffs (T4, T5, T8).
- T3: `.claude/standards/ui.md` gains a "Names are doors" section. New `lib/entity-links.ts` (`entityHref`) and `components/entity-link.tsx` (`EntityLink`): a null href renders plain text, and the 44 px touch target is opt-in. `data-table-link-cell.tsx` exports its underline and touch classes so both link components look the same.
- T1: `components/ui/select.tsx` now defaults `alignItemWithTrigger` to false, so dropdowns open below their field. New `campusShortLabels()` in `lib/format.ts` strips the leading whole words that every campus name shares. Applied to the campus options in employees (filter, create and edit), the classes filter and create dialog, and the teacher Gerbang page.
- T8: Five fixes:
  - **Check-in sheet:** the title reads "Lokasi tidak terbaca" when there is no location (`app/teacher/home-client.tsx`), and JTBD-TEACHER-HOME-03 is updated.
  - **Sidebar:** `config/admin-nav.ts` gives Buku Penghubung an `alsoMatch` for the journal students and classes routes. The alias breadcrumb now takes its label from `SEGMENT_LABELS`.
  - **Monitoring:** the journal monitoring API returns `campusName`, and the page shows "program · short campus".
  - **Skeletons:** route `loading.tsx` added for staff daily and for the Sentra rotation, which is a grid page, so it uses the root shape.
  - **Payroll spacing:** moved to T6.
- T0 plan: the driver (Opus) wrote the rubric and the agent brief, and did synthesis, screenshot review and ranking. The dirty-work tier did the sweeps: five Haiku browser agents (by user request) and one Sonnet code sweep. Three Sonnet fact-finders fed the spec for T1–T8.

## Verification

### T0 (audit)

- Build: `origin/staging` @ `a0afa580`, `DEMO_MODE=true npm run build` (needed `NODE_OPTIONS=--max-old-space-size=6144`) + `npm run start`, local Postgres 16, `prisma db push` + `prisma db seed`.
- Sweep: 69 routes, all 200. Zero app console errors and failed requests (local `/_vercel/*` excluded). Zero horizontal overflow at 390 px. Slowest page about 2 s.
- Lead-reviewer checks:
  - **Seen on screenshots:** the Sentra select over its trigger, the static header campus text, the staff-attendance picker over the grid, invoice-detail names unlinked, the admissions duplicate "Belum bayar", the parent sheet, the check-in title.
  - **Read in code:** `invoices-client.tsx` student cell links to the invoice; `select.tsx` `alignItemWithTrigger = true`; `app/admin/layout.tsx` static campus text; `lib/admin/header-context.ts` has no per-user scope.
- design-system: the findings are judged against `.claude/standards/design-system.html`. T1–T8 verification records the design-system check per screen.

## Ship Notes

- T0: report, cycle doc and 10 PNGs (340 KB) in PR [ismailir10/school-erp#739](https://github.com/ismailir10/school-erp/pull/739).
