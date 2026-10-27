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
- Notifying parents when a day is marked.
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

- [ ] T1 Prisma model + additive migration + RLS for `StudentJournalDayMark` — accept: `verify-rls-coverage` passes (deps: none, reuse: `StudentJournalNote` RLS pattern)
- [ ] T2 Progress definition: ≥1 tick = lengkap, marked day = finished — accept: unit tests in `home-progress.test.ts` (deps: none, reuse: `getJournalProgress`)
- [ ] T3 Mark API (GET in class-grid payload, PUT/DELETE write route, audit, Zod) — accept: auth-matrix API test (deps: T1, reuse: `guards.ts`, `audit.ts`, `student-journal` validations)
- [ ] T4 Teacher entry page: button, dialog, banner; avatar/progress use new definition — accept: component test (deps: T2, T3)
- [ ] T5 Teacher home reads marks for "perlu diselesaikan" — accept: home test (deps: T2, T3)
- [ ] T6 Parent week + admin dossier: `WeekGrid` shows keterangan on marked dates; week routes return marks — accept: `week-grid.test.ts` + route tests (deps: T3)
- [ ] T7 Admin set/clear mark + roll-up uses the same definition — accept: admin API test, roll-up test (deps: T3)
- [ ] T8 README / `docs/uat/jobs/{teacher,parent}.md` / counts block; Playwright flow — accept: `audit-docs.sh` clean, e2e green (deps: T4-T7)

## Implementation

## Verification

## Ship Notes
