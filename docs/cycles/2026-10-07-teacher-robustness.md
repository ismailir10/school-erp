# Teacher portal robustness — stale roster saves, offline dead-ends, lost assessment work, sentra access

## Context
A fresh persona UAT on 2026-10-07 (Bu Sari, 390×844 touch, slow-3G and offline, local production build on a disposable Postgres) re-walked every teacher job. The daily flows are fast (no page over 4 s, no API over 2 s), but the run found data-loss and dead-end paths that the 2026-09-29 fix cycles did not reach:

- **TCHX-1 (major)** Saving the session roster (`/teacher/sessions/[id]`) POSTs every row's status from the snapshot loaded when the page opened, so a status corrected meanwhile on `/teacher/class-attendance` is silently reverted. The same save also creates a row for every untouched student.
- **TCHX-2 (major)** "Ajukan cuti" freezes on "Mengirim…" when the network drops: no try/catch, both buttons stay disabled forever.
- **TCHX-3 (major)** The sentra (center) assessment page has no unsaved-changes guard; tapping a nav tab discards an activity + every level picked.
- **TCHX-4 / TCHX-15 / X-18 (major)** Class attendance shows raw API/English errors ("Unauthorized", "Failed to fetch") with a "Coba lagi" that can never succeed after the session expires, and a 403 reads as "Periksa koneksi".
- **TCHX-5 (major)** A sentra-only teacher (no class assignment) sees "Belum ditugaskan ke kelas" on `/teacher/assessments` and no sentra tiles, although the center page itself works for her.
- **TCHX-6 (major, seed)** The seed marks one student WITHDRAWN without withdrawing the enrollment, which the real withdraw routes always do; the teacher rosters then disagree with the assessment page.
- **TCHX-7 (major)** Journal "Isi cepat satu kelas" pre-selects children who are Sakit/Izin/Alpa today, ticking "Datang di sekolah tepat waktu" for absent kids.
- Minors: TCH-5 (weekly chips + hint shown while no IKTP), TCH-6 (center empty state repeats itself, "Coba lagi" useless), TCH-8 (journal content jumps when "Jurnal tersimpan" appears), TCH-10 (names truncated in class attendance), TCH-11 (bar says "Semua siswa sudah dicatat" while counts say "belum"), TCH-15 (session status control looks like text, cycle order differs from class attendance), TCH-16 (slip footer says "An Nisaa' ERP"), TCHX-8 (masuk/pulang accepted for absent kids and a mistap cannot be undone), TCHX-10 (slip banner "akan tersedia setelah tanggal 5" shown on the 7th), TCHX-12 (center date accepts future dates), TCHX-16 (long note silently truncated), TCHX-17 (journal taps lost if the tab closes within the 500 ms coalescing window).

Report source: persona agent run on `origin/staging @ bb6941a`, kept in this cycle (no separate report file). The user asked for an uninterrupted multi-hour UAT-and-fix session ("work 5 hours straight, dont stop"), which is the authorization for running this cycle without stopping at the Spec gate.

## Spec
- [ ] TCHX-1: the session roster save sends only rows that differ from the last saved state; an untouched row never overwrites a status written elsewhere. Saving with no change is a no-op with a friendly message.
- [ ] TCHX-8: "Ketuk masuk/pulang" is not offered for Sakit/Izin/Alpa rows; a recorded masuk/pulang time can be cleared before saving.
- [ ] TCH-15: the session status control is a visible button and cycles in the class-attendance order Hadir → Sakit → Izin → Alpa.
- [ ] TCHX-2: the leave sheet (submit and cancel) recovers from a network failure: buttons re-enable and an Indonesian toast explains.
- [ ] TCHX-4/TCHX-15/X-18: class attendance never shows raw API or browser error text. 401 → "Sesi Anda berakhir. Masuk lagi untuk menyimpan." with a sign-in link; 403 → a permission message; network failure → "Koneksi terputus…". The same mapping is a shared helper with unit tests.
- [ ] TCH-11: the bulk bar and the counts read from the same state, so they never contradict each other. TCH-10: names wrap to two lines instead of an ellipsis.
- [ ] TCHX-3: the center assessment page warns before leaving with unsaved picks (reuses `useUnsavedChangesGuard`). TCHX-12: its date input cannot pick a future date. TCH-6: the no-week state says it once and offers no useless retry.
- [ ] TCHX-5: a teacher with no class assignment still sees the sentra tiles on `/teacher/assessments`.
- [ ] TCHX-7: the journal class bulk sheet pre-selects only children not marked Sakit/Izin/Alpa today, and says how many were left out.
- [ ] TCH-8: the journal save status line reserves its height. TCHX-17: pending journal writes flush on `pagehide`/`visibilitychange:hidden`. TCHX-16: pasting past 2000 characters tells the teacher the note was cut.
- [ ] TCH-5: the weekly assessment hides the level chips and hint while the week has no IKTP.
- [ ] TCH-16: the slip footer names Talib. TCHX-10: the slip banner no longer promises a date that has passed.
- [ ] TCHX-6: the seed withdraws the WITHDRAWN fixture's enrollments, matching the real withdraw routes.

### Non-goals
- No schema migration, no new dependency, no change to the attendance API contract beyond what the client sends.
- No teacher profile editing (TCH-14), no reason field on S/I/A (X-8), no pickup visibility for parents (X-17) — feature work for a later cycle.
- No change to the weekly assessment refresh model (TCHX-9).

### Assumptions
1. "Last saved state" for the roster = the rows as loaded or as last saved successfully in this page (the existing `rosterKey` baseline).
2. Clearing a masuk/pulang time before saving sends `null`, which the API already accepts.
3. A teacher with no class assignment may still assess every sentra (the center page already allows it; only the index hid it).

## Tasks
- [ ] **T1 — Session roster: dirty-only save, masuk/pulang rules, status control.** `app/teacher/sessions/[id]/client.tsx` (+ tests). TCHX-1, TCHX-8, TCH-15. Independent.
- [ ] **T2 — Class attendance errors + consistency.** New `lib/teacher/fetch-error-copy.ts` (+ unit test), `app/teacher/class-attendance/page.tsx` (+ tests). TCHX-4/15/X-18, TCH-10, TCH-11. Independent.
- [ ] **T3 — Leave sheet + assessments.** `components/teacher/leave-sheet.tsx`, `app/teacher/assessments/page.tsx`, `app/teacher/assessments/center/[center]/client.tsx`, `app/teacher/assessments/weekly/client.tsx` (+ tests). TCHX-2, TCHX-3, TCHX-5, TCHX-12, TCH-6, TCH-5. Independent.
- [ ] **T4 — Journal.** `components/student-journal/class-bulk-sheet.tsx`, `app/teacher/student-journal/entry/page.tsx`, `lib/student-journal/coalesce-writes.ts`, `components/student-journal/note-compose-dialog.tsx` (+ tests). TCHX-7, TCH-8, TCHX-17, TCHX-16. Independent.
- [ ] **T5 — Slips + seed.** `app/teacher/slips/**`, `prisma/seed.ts`. TCH-16, TCHX-10, TCHX-6. Independent.
- [ ] **T6 — End-of-cycle gate, browser verification, Ship Notes.** Depends on T1–T5.

## Implementation

## Verification

## Ship Notes
