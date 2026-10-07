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
- [ ] **T1 — Student lifecycle + duplicates (API).** `app/api/students/route.ts` (POST only), `app/api/students/[id]/route.ts`, `app/api/students/[id]/enroll/route.ts`, `app/api/admin/classes/[id]/enrollments/route.ts`, `app/api/students/[id]/graduate/route.ts` (+ tests). ADM-1 (API), ADM-2 (API), ADM-10, CORE-13 copy, X-9. Independent.
- [ ] **T2 — Student pages.** `app/admin/students/**` (page, detail page, dialogs) and student components it owns (+ tests). ADM-1 (UI), ADM-2 (UI), ADM-3, ADM-4, CORE-13 (UI). Depends on T1's response shapes (409 codes listed in this doc): `STUDENT_NOT_ACTIVE`, `NIS_TAKEN` (field `nis`), `DUPLICATE_STUDENT` (retry with `confirmDuplicate: true`).
- [ ] **T3 — Classes.** `app/api/admin/classes/[id]/route.ts`, `lib/classes/health.ts`, `components/admin/class-section-picker.tsx`, `app/admin/classes/**` (+ tests). ADM-5, CORE-20, CORE-21. Independent.
- [ ] **T4 — Small admin polish.** `components/admin/guardian-edit-dialog.tsx`, `app/admin/settings/users/page.tsx`, `components/ui/calendar.tsx`, `components/ui/date-picker.tsx`, `lib/dashboard/activity-feed.ts` (+ tests). CORE-11, ADM-16, ADM-8, DOC-6. Independent.
- [ ] **T5 — End-of-cycle gate, verification, Ship Notes.** Depends on T1–T4.

## Implementation

## Verification

## Ship Notes
