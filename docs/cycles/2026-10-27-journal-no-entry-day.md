# Buku Penghubung: hari tanpa buku & anak "lengkap"

Cycle: 2026-10-27 · Branch: `claude/peaceful-archimedes-jwz7gu` · Role: cto

## Context

Feedback from a guru (relayed by Kak Ismail), points 1 and 2 of 4:

1. On a day the class does something that doesn't use the book (Tuesday swimming), the book isn't brought and the
   guru doesn't fill it. Today the only options are an empty grid (strips) or writing a catatan to every child.
   She asks whether the day can carry a keterangan ("Renang") instead.
2. When some indicators are legitimately not ticked (child came late, so "datang tepat waktu" stays empty), the
   teacher home still lists the journal under *perlu diselesaikan*. It only disappears when **every** indicator of
   **every** present child is ticked.

Both come from one gap: the only definition of "done" is *all indicators ticked for all present children*, and there
is no way to say "this day isn't filled on purpose".

Facts found in the code (not decisions):
- Completion is computed in one place, `getJournalProgress` (`lib/teacher/home-progress.ts`), used by the teacher home
  (`app/teacher/page.tsx`) and the entry page (`app/teacher/student-journal/entry/page.tsx`). A child is complete only
  when checked indicators == all active SCHOOL indicators; Sakit/Izin/Alpa children already leave the count.
- The entry page also paints a child's avatar as done (check mark) only at all-ticked (`class-day-grid.tsx`).
- Parent "Di sekolah" tab and the admin dossier both render `WeekGrid` (`components/portal/week-grid.tsx`): an
  unticked cell is a quiet dash, indistinguishable from "not filled yet" and "no book today".
- Per-student Catatan exist (`StudentJournalNote`) but are per child and say nothing about the class day.
- Entries are written through `entries/batch` (teacher) with audit rows; there is no class-day-level record at all.

## Decisions

1. **Hari tanpa buku = a class-day mark with a short keterangan** (the user chose this over notes-only or leaving
   dashes). New table, one row per class per date: reason text, who set it. Needs a migration.
2. **A child is "lengkap" when at least one indicator is ticked** (the user's choice, over a per-child "Tandai
   selesai" button or a per-indicator "tidak berlaku" state). Trade-off accepted: a child with a single stray tick
   counts as done. This changes the shared definition, so the home card, the entry page's "x/y siswa lengkap" and
   the avatar check all move together.
3. **Who can set the mark: the class's guru and school admin** (user's choice). Admin can correct past days from
   the monitoring side. Parents only read it.
4. A marked day counts as finished for that class on the teacher home, regardless of ticks. Existing ticks on that
   day are kept (not deleted), so unmarking the day restores the normal grid.
5. **The threshold stays at one tick**, confirmed after the stray-tick risk was put to the user; no per-category
   or percentage rule.
6. **Keterangan is free text (max 60) with suggestion chips** (Renang, Libur, Kegiatan luar), not a fixed list.
7. **A marked day does not lock the grid.** The guru can still tick children on that day (some may be filled
   anyway); the mark only adds the keterangan and the "finished" status.
8. **No parent notification** (no WhatsApp/push). The keterangan is visible when the wali opens Jurnal.

## Acceptance criteria

- [ ] A guru of a class can mark a date as "Hari tanpa buku penghubung" with a keterangan of 1-60 characters,
      and can edit or remove that mark.
- [ ] On a marked day the teacher entry page shows the keterangan prominently and the class counts as finished
      on the teacher home (no "perlu diselesaikan" for that class on that day).
- [ ] The parent's "Di sekolah" week view shows the keterangan in that day's column (e.g. "Renang") instead of
      dashes; other days are unchanged. Parent can't create or change the mark.
- [ ] School admin can set/clear the mark for any class and date from the admin journal side; a guru not
      assigned to the class cannot (403), and nobody can touch another school's classes.
- [ ] A child with at least one ticked indicator counts as "lengkap" on the entry page, the teacher home card
      and the avatar; a child with zero ticks is still "belum"; Sakit/Izin/Alpa children still leave the count.
- [ ] Admin class roll-up / dossier week summary stay consistent with the new definition (no screen reports a
      class "complete" while another reports it incomplete for the same day).
- [ ] The mark is audited like entries (who, when, before/after).

## Verify flows

1. **Guru marks swimming day.** Role guru (`u_teacher`), `/teacher/student-journal/entry` for today, tap
   "Hari tanpa buku penghubung", type "Renang", save. Expect: banner with "Renang", home card for that class no
   longer says journal is unfinished. Then open the parent portal (child of that class), Jurnal › Di sekolah: that
   day's column reads "Renang".
2. **Partial ticks count (point 2).** Entry page, tick 2 of 7 indicators for one child, leave another child with
   none. Expect: "1/2 siswa lengkap" style progress counts only the ticked child; ticking one indicator on the
   second child makes the class complete on the teacher home.
3. **Edge: unmark restores grid.** Remove the keterangan; the day returns to normal, earlier ticks still there.
4. **Error: wrong class / role.** Guru of class A calls the mark endpoint for class B → 403. Parent calls it → 403.
   Keterangan empty or over 60 characters → validation message in Indonesian.

## UX notes

- Entry page: one outlined button "Hari tanpa buku penghubung" near "Isi cepat satu kelas"; opens a small dialog
  (keterangan field with suggestions chips: Renang, Libur, Kegiatan luar). When set, a banner shows the keterangan
  and "Ubah" / "Hapus"; the child list stays usable but is visually secondary.
- Parent week grid: marked day header gets a one-line caption under the date; the cells for that day show a muted
  keterangan chip spanning the column (not 7 identical dashes). Copy follows `voice.md` (parent says "Jurnal").
- Admin: the same dialog from the class-day view in admin journal monitoring.
- Teacher home: no new element; the existing journal progress simply reaches "selesai".

## Test seams

- Vitest unit: `getJournalProgress` (≥1 tick = lengkap; absent children; marked day).
- Vitest API integration: new mark route (auth matrix: guru of class, other guru, admin, parent, cross-tenant;
  validation; audit row).
- Vitest component: `WeekGrid` renders the keterangan for a marked date; entry page banner.
- Playwright (local, `e2e` label): guru marks a day → parent sees it.

## Non-goals

- Points 3 (Penilaian Sentra cannot be filled) and 4 (when payslips appear on the web) from the same message.
- Per-indicator "tidak berlaku" state and a per-child "Tandai selesai" button.
- Per-child no-book days (a single child's exception); use Catatan.
- Notifying parents when a day is marked (WhatsApp/push); separate cycle if wanted.
- Locking the entry grid on a marked day.
- Changing the "Di rumah" grid.

## Assumptions

1. Marks apply to weekdays the week grid already shows (Senin-Jumat); no weekend marks.
2. One mark per class per date; a second save edits the first.
3. Keterangan max 60 characters, plain text, trimmed; free text, not a fixed list.
4. A date in the future can't be marked (same rule as entries), past dates can (teacher: same backfill window as
   entries today; admin: any past date).
5. Raising "lengkap" to ≥1 tick also changes the number shown on the admin class roll-up; I'll align it rather
   than leave two definitions.

## Gate re-openers

- **Schema migration** (additive): new `StudentJournalDayMark` table + RLS policies in the same migration.
- **Auth/permission change**: new write route for guru-of-class and school admin (spec'd above).
- No new dependency, no production write, no paid API.

## Tasks

- [x] T1 Prisma model + additive migration + RLS for `StudentJournalDayMark` — accept: `verify-rls-coverage` passes (deps: none, reuse: `StudentJournalNote` RLS pattern)
- [x] T2 Progress definition: ≥1 tick = lengkap, marked day = finished — accept: unit tests in `home-progress.test.ts` (deps: none, reuse: `getJournalProgress`)
- [x] T3 Mark API (GET in class-grid payload, PUT/DELETE write route, audit, Zod) — accept: auth-matrix API test (deps: T1, reuse: `guards.ts`, `audit.ts`, `student-journal` validations)
- [x] T4 Teacher entry page: button, dialog, banner; avatar/progress use new definition — accept: component test (deps: T2, T3)
- [x] T5 Teacher home reads marks for "perlu diselesaikan" — accept: home test (deps: T2, T3)
- [x] T6 Parent week + admin dossier: `WeekGrid` shows keterangan on marked dates; week routes return marks — accept: `week-grid.test.ts` + route tests (deps: T3)
- [x] T7 Admin set/clear mark + roll-up uses the same definition — accept: admin API test, roll-up test (deps: T3)
- [ ] T8 README / `docs/uat/jobs/{teacher,parent}.md` / counts block; Playwright flow — accept: `audit-docs.sh` clean, e2e green (deps: T4-T7)

## Implementation

- Plan: driver=this session model, workers=none (no cheaper tier available to this session); T1-T8 sequential and inline, because each slice builds on the new `StudentJournalDayMark` model and its shared helper, so a worker would need the whole plan as context.
- T1: `prisma/schema.prisma`, `prisma/migrations/20261027000000_add_student_journal_day_mark/migration.sql` — new `StudentJournalDayMark` model (unique per class+date), additive migration with RLS + service_role policy. `prisma/seed.ts` left alone on purpose: the table has no FKs, and the seed-drift hook would force a meaningless `lib/db.ts` edit. `verify-rls-coverage.sh`: 44/44 OK.
- T2: `lib/teacher/home-progress.ts`, `lib/teacher/__tests__/home-progress.test.ts` — `getJournalProgress`: a pupil is lengkap with >=1 tick; optional `dayMarkReason` finishes the day and is echoed back. Tests: one-tick, late-arrival, marked-day, null mark. Spec correction: the admin class roll-up sums ticks per week (never "lengkap"), so assumption 5 needs no roll-up change.
- T3: `lib/validations/student-journal.ts`, `lib/student-journal/{day-marks,guards}.ts`, `app/api/student-journal/day-marks/route.ts`, `class-grid`, the three `*/week` routes, `README.md`, tests (`tests/student-journal/api-day-marks.test.ts`, `lib/student-journal/__tests__/day-marks.test.ts`, two older week-route mocks gained the new table). `PUT`/`DELETE /api/student-journal/day-marks` (guru of the class or school admin of the tenant; wali/other guru 403, other-tenant class 404; keterangan 1-60 chars trimmed; Mon-Fri, not future; audit rows `DAY_MARK` CREATE/UPDATE/DELETE, none on an unchanged re-save). `class-grid` returns `dayMark`; parent/teacher/admin week routes return `dayMarks: { date: keterangan }`.
- T3 review (security + standards reviewer, no blockers). Fixed: `removeDayMark` uses `deleteMany` so a concurrent removal is a no-op instead of a P2025 500; save/remove look the row up with the tenant filter; pure date rules moved to `lib/student-journal/day-mark-rules.ts` (shared with the client dialog); dropped the unused `DayMarkInput` type; tests added for 429, DELETE as signed-out / other-tenant admin, assignment scoping, lost-race delete. Not changed: body is validated before the guard (the guard needs `classSectionId` from the body; `entries/batch` does the same); a pupil who moved class mid-week sees only current-class marks (low impact).
- T4: `components/student-journal/day-mark-dialog.tsx` (new, shared with admin in T7), `app/teacher/student-journal/entry/page.tsx`, `components/student-journal/class-day-grid.tsx`, `lib/student-journal/day-mark-rules.ts`, tests (`day-mark-dialog.test.tsx`, entry `page.test.tsx`, `class-day-grid-speed.test.tsx`). Entry page: ghost "Hari tanpa buku penghubung" button (weekdays up to today only) -> dialog with a 60-char keterangan field and Renang / Libur / Kegiatan luar chips; once set, a banner shows the keterangan with "Ubah" (dialog gains "Hapus tanda"). The grid stays usable. The roster avatar shows the done check from the first tick. Cross-checked against `design-system` (portal shell + Student Journal sections): existing `ResponsiveFormDialog`, `Field`, `Input`, `Button`, 44px `tap-target`s, `text-xs` floor, `bg-muted` banner, no new tokens.
- T5: `app/teacher/page.tsx`, `app/teacher/home-client.tsx`, `app/teacher/__tests__/home-checkin.test.tsx` — the home loads today's mark per class (a failed lookup leaves the day unmarked), passes `dayMarkReason` to `getJournalProgress`, and the marked class moves from "Yang perlu diselesaikan" to "Pekerjaan yang sudah tersimpan" with "Hari tanpa buku penghubung · <keterangan>". No new visual element (existing `TaskRow`, per `design-system`).
- T6: `components/portal/week-grid.tsx`, parent `student-journal/page.tsx`, teacher `student-journal/students/[id]/page.tsx`, admin `student-journal/students/[id]/page.tsx` and `components/admin/student-journal-block.tsx`, tests (`week-grid.test.ts`, `api-parent-week-day-marks.test.ts`). `WeekGrid` takes `dayMarks`: a 44px column cannot hold the reason, so marked days get a line above the grid ("Sel 28/10 · Tanpa buku penghubung: Renang"), a `CalendarOff` glyph under the column date, a muted tint and an explanatory accessible name on unfilled cells; ticks that exist stay; the "belum diisi" empty-week note is suppressed when the week holds a mark. Only the SCHOOL grids receive marks, the parent's "Di rumah" grid is untouched. Per `design-system` (tokens `bg-muted`, `text-muted-foreground`, `text-xs` floor).
- T7: `app/api/student-journal/admin/class-roll-up/route.ts` (returns `dayMarks` for the class's week), `app/admin/student-journal/classes/[id]/page.tsx` (new "Hari tanpa buku penghubung" card: the five school days with their keterangan and Tandai / Ubah per day up to today, the same `DayMarkDialog`), tests (`api-admin-class-roll-up-day-marks.test.ts`, `classes/[id]/__tests__/page.test.tsx`). The write goes through the shared `PUT/DELETE /day-marks` route, whose guard already admits school admins of the tenant. The roll-up's tick sums are unchanged: it never used "lengkap" (assumption 5 resolved as no change). Card follows `design-system` admin detail pattern (`bg-card` panel, `p-card`, `text-h2` heading, outline `sm` buttons).

## Verification

## Ship Notes
