# Admin core guards — student lifecycle, duplicate NIS, class capacity, enrolment order, list state

## Context
The 2026-10-07 admin persona UAT (Ibu Nur at 1440×900 and 390 px, disposable local Postgres) re-walked students, guardians, classes, admissions, academic setup, attendance, journal monitoring, report cards and settings. Pages are fast (1.2–3.0 s cold, no API over 2 s) and many earlier findings are fixed, but several core flows still corrupt data or lose work:

- **ADM-1 (major)** A withdrawn ("Keluar") student can be enrolled into a class: the header still offers "Daftarkan ke Kelas", the enroll APIs never check `Student.status`, and the result is `Student.status = WITHDRAWN` with an ACTIVE enrollment that inflates class counts, attendance recap and journal monitoring. There is also no way to bring a withdrawn student back. Related CORE-13: "Luluskan" is offered without an active enrolment and its error uses the loanword "enrollment".
- **ADM-2 (major)** A duplicate NIS and an identical student (same name + date of birth) are saved silently.
- **ADM-3 (major)** Editing "Data Anak" on the student page has no unsaved-changes guard — clicking any sidebar link silently discards the edits — and a double click on "Simpan Perubahan" sends two PUTs.
- **ADM-4 (major)** Students list search, filters and page reset when coming back from a detail page.
- **ADM-5 (major)** A class's capacity can be lowered below its current roster ("2/1").
- **ADM-10 (minor)** The enrol dialog first demands an age-override reason, then says the student is already enrolled.
- **CORE-20 / CORE-21** Full classes are selectable in the enrol picker (the server then refuses); a brand-new empty class shows health "Kritis".
- **CORE-11 / ADM-16 / ADM-8 / DOC-6 (minor)** The create-guardian dialog shows the edit-only email hint; the users page offers self-deactivation only to reject it; the date picker's month/year labels and navigation are English and its year list starts at 1926; the dashboard activity feed whitelists audit names the app never writes.
- **X-9 (minor)** Single-student enrol is rate-limited to 5/min per IP, shared by every admin behind the school NAT.

The user asked for an uninterrupted multi-hour UAT-and-fix session ("work 5 hours straight, dont stop"), which is the authorization for running this cycle without stopping at the Spec gate.

## Spec
- [ ] ADM-1: both enroll APIs (`/api/students/[id]/enroll`, `/api/admin/classes/[id]/enrollments`) refuse a student whose status is not ACTIVE with 409 "Siswa berstatus <Keluar/Lulus/Tidak Aktif> tidak bisa didaftarkan ke kelas. Aktifkan kembali dulu."; the student header shows "Daftarkan ke Kelas" only for ACTIVE students; a WITHDRAWN student gets "Aktifkan kembali" (confirm) that sets status ACTIVE and clears the withdrawal date/reason. CORE-13: "Luluskan" shows only with an active enrolment; the graduate error says "kelas aktif".
- [ ] ADM-2: creating (or editing to) a NIS already used by another student in the tenant is a 409 with an inline field error; an identical name + date of birth returns a 409 the dialog shows as a confirm ("Siswa dengan nama dan tanggal lahir yang sama sudah ada …") with "Tetap simpan" (re-POST with `confirmDuplicate: true`).
- [ ] ADM-3: the student "Data Anak" edit uses the existing unsaved-changes guard; save is disabled while a request is in flight.
- [ ] ADM-4: students list search, status filter and page live in the URL (`?q=&status=&page=`) and are restored on Back.
- [ ] ADM-5: lowering capacity below the current ACTIVE roster is a 409 with an inline message naming the roster size.
- [ ] ADM-10: the enroll route checks "already enrolled" before the age-fit override. CORE-20: full classes are disabled in the enrol picker with "Penuh". CORE-21: a class with no students shows a neutral "Belum ada siswa" health, not "Kritis".
- [ ] CORE-11: the create-guardian dialog does not show the edit-only email hint. ADM-16: the own row on Pengguna has no "Nonaktifkan". ADM-8: the date picker's month/year selects, navigation and "today" labels are Indonesian; the year list covers a sensible range (current year − 20 … + 5 unless the caller sets bounds). DOC-6: the activity feed recognises the audit actions the app writes (`class.enrollment.add` etc.).
- [ ] X-9: the single-student enrol limit is keyed per user (not per IP) and allows 30/min.

### Non-goals
- No schema migration, no new dependency. No change to `lib/validations/**` (owned by the open api-integrity PR) — NIK/NISN/KK/phone format validation (CORE-8) waits for that to merge. No change to the enrollment-form convert route (ADM-6, same reason).
- No redesign of guardians/classes lists' state (ADM-4 is scoped to students; the pattern can be reused later).

### Assumptions
1. NIS uniqueness is per tenant and ignores empty NIS.
2. "Aktifkan kembali" restores the student only; enrolments are re-created through "Daftarkan ke Kelas" as usual.

## Tasks
- [x] **T1 — Student lifecycle + duplicates (API).** `app/api/students/route.ts` (POST only), `app/api/students/[id]/route.ts`, `app/api/students/[id]/enroll/route.ts`, `app/api/admin/classes/[id]/enrollments/route.ts`, `app/api/students/[id]/graduate/route.ts` (+ tests). ADM-1 (API), ADM-2 (API), ADM-10, CORE-13 copy, X-9. Independent.
- [ ] **T2 — Student pages.** `app/admin/students/**` (page, detail page, dialogs) and student components it owns (+ tests). ADM-1 (UI), ADM-2 (UI), ADM-3, ADM-4, CORE-13 (UI). Depends on T1's response shapes (409 codes listed in this doc): `STUDENT_NOT_ACTIVE`, `NIS_TAKEN` (field `nis`), `DUPLICATE_STUDENT` (retry with `confirmDuplicate: true`).
- [x] **T3 — Classes.** `app/api/admin/classes/[id]/route.ts`, `lib/classes/health.ts`, `components/admin/class-section-picker.tsx`, `app/admin/classes/**` (+ tests). ADM-5, CORE-20, CORE-21. Independent.
- [x] **T4 — Small admin polish.** `components/admin/guardian-edit-dialog.tsx`, `app/admin/settings/users/page.tsx`, `components/ui/calendar.tsx`, `components/ui/date-picker.tsx`, `lib/dashboard/activity-feed.ts` (+ tests). CORE-11, ADM-16, ADM-8, DOC-6. Independent.
- [ ] **T5 — End-of-cycle gate, verification, Ship Notes.** Depends on T1–T4.

## Implementation
- Subagent plan: driver=claude-opus-5-5, dirty-work=claude-sonnet-5-5; tasks [T1,T2,T3,T4] parallel (disjoint files; T2 codes against the 409 contract written in this doc), T5 sequential by the driver, who reviews each diff and commits per task.
- T3 (ADM-5, CORE-20, CORE-21): `PUT/PATCH /api/admin/classes/[id]` counts ACTIVE enrolments under the same `pg_advisory_xact_lock(hashtext(classId))` the enrol routes take and refuses a capacity below it (409, message + `field`/`errors[]` so the Ubah Kelas dialog shows it inline on Kapasitas); only when capacity actually changes, so renaming an already-overfull class still works. `ClassSectionCombobox` shows full classes disabled with "Penuh" (new opt-in `isItemDisabled` on `AsyncCombobox`; the billing multi-picker is unchanged). `computeHealthBadge` returns "Belum ada siswa" for an empty class (neutral pill via StatusBadge's fallback). Tests: capacity guard route, picker, health, classes client (81).

- T1 (ADM-1 API, ADM-2 API, ADM-10, CORE-13, X-9): new `lib/students/guards.ts` (`STUDENT_STATUS_LABEL`, `studentNotActiveResponse`, `findStudentConflict`). Both enrol routes refuse a non-ACTIVE student with 409 `STUDENT_NOT_ACTIVE` ("Siswa berstatus Keluar tidak bisa didaftarkan ke kelas. Aktifkan kembali dulu.") before any age check or write; both run the stream "already enrolled" pre-check before the age override (the in-transaction check stays for races). PUT `status: ACTIVE` on a WITHDRAWN student clears `withdrawalDate`/`withdrawalReason` (no enrolment re-created). POST /api/students returns 409 `NIS_TAKEN` (`field: "nis"`) for a NIS used by any other tenant student, and 409 `DUPLICATE_STUDENT` (`existingId`) for the same trimmed name + birth date unless the body carries `confirmDuplicate: true` (which never bypasses a taken NIS); PUT checks NIS when it changes. The single-student enrol limit is per user, 30/min, with an Indonesian message. Graduate and promote errors say "belum terdaftar di kelas aktif" (driver fixed promote). Tests: 18 files, 203 passed.

- T4 (CORE-11, ADM-16, ADM-8, DOC-6): the guardian form shows the "Kosongkan untuk mempertahankan…" hint only when a stored email exists (create mode no longer). Pengguna fetches `/api/auth/me` and hides "Nonaktifkan" on the signed-in user's own row (falls back to showing it if the lookup fails; the API still refuses). `Calendar` defaults to the date-fns `id` locale with Indonesian labels ("Pilih bulan", "Pilih tahun", "Bulan sebelumnya/berikutnya", "Hari ini, …"); `DatePicker`'s year window is current year −20…+5 (was −100…+10, the 1926 list), still widened by `min`/`max` and the selected value — all 25 callers checked. `lib/dashboard/activity-feed.ts` now whitelists the audit pairs the app actually writes (`class.enrollment.add/remove`, `Payment.record/reverse`, `Invoice.void`, `ReportCardEntry.publish/unpublish`, `class.create`, leave/payroll cancel, employee deactivate/restore) with relation-aware target names via a pure `describeAuditEntry`. Leave approve/reject, withdraw/graduate and admission convert write no audit rows yet, so they cannot appear (noted for a follow-up). Tests: 6 files, 62 passed.

## Verification
- Frontend diffs checked against `.claude/standards/design-system.html` (neutral muted pill, disabled combobox rows, inline field errors); no new colours.
- T3: `npx vitest run app/api/__tests__/admin-classes-capacity-guard.test.ts components/admin/__tests__/class-section-picker.test.tsx lib/classes/__tests__/health.test.ts app/admin/classes components/ui/__tests__/async-combobox.test.tsx app/api/__tests__/admin-classes-historical-roster.test.ts` → 8 files, 81 passed. T1: `npx vitest run app/api/__tests__/{enroll,class-enrollments-add,enrollment-doors-parity,students-enroll-promote-year-guard,students-update-put,student-lifecycle-validation,students-employees-authz}.test.ts app/api/students app/api/admin/classes` → 18 files, 203 passed. T4: `npx vitest run components/ui/__tests__/calendar.test.tsx components/ui/__tests__/date-picker.test.tsx components/admin/__tests__/guardian-edit-dialog.test.tsx app/admin/settings/users lib/dashboard/__tests__/activity-feed.test.ts` → 62 passed. Full gate at T5.

## Ship Notes
