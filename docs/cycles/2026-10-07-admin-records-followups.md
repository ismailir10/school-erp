# Admin records follow-ups — decisions, audit trail, academic years, raport, receipts, leave, error copy

## Context
The rest of the 2026-10-07 UAT backlog. It is not covered by cycles 1–5 (#610–#614). These are smaller issues, each one an inconsistent record or a missing guard an admin would trip over:

- **ADM-6** Converting an enrolment form into a student leaves the linked Admission in its old status. The pipeline then shows the child as still "Dikunjungi". "Terima" and "Tolak" on the enrolment form and admissions list fire with no confirm.
- **Audit gaps (DOC-6 follow-up)** Leave approve/reject, student withdraw/graduate and both convert routes write no audit row. The activity feed and any later investigation cannot see them.
- **ADM-13** Academic years can overlap, and the server accepts an end date before the start. An archived year shows the raw "ARCHIVED" status.
- **ADM-14** "Simpan & Terbitkan" on a raport publishes to parents with no confirm. Height and weight errors are English zod text. The parent enrolment form accepts 9999 cm.
- **ADM-15** Class names are unique only case-sensitively ("TK A" and "tk a" coexist). CSV exports have no UTF-8 BOM, so Excel garbles "Ā/é" names.
- **FINX-9** "Catat Pembayaran" has no payment date, so a transfer received yesterday is recorded as today. Admins cannot download the kuitansi that parents can.
- **HR-14** The HR attendance CSV's "Total Hari" omits Izin days.
- **Leave** The employee page shows the annual entitlement as "Saldo Cuti", not what is left. Annual/permission leave can start in the past. A one-letter reject reason is accepted.
- **STR-15** A parent's children list is cached for 60 s and never invalidated, so a newly linked child is missing after the admin links them.
- **STR-17** Admin forms show the raw "Forbidden" text on a 403.

The user asked for an uninterrupted multi-hour UAT-and-fix session ("work 5 hours straight, dont stop"). That is the authorization for running this cycle without stopping at the Spec gate.

## Spec
- [ ] ADM-6: converting an enrolment form sets the linked Admission to ADMITTED, unless it is CANCELLED. "Terima" and "Tolak" on the enrolment-form page and "Terima" on the admissions list ask for confirmation first.
- [ ] Audit: `recordAudit` rows are written inside the business transaction. This covers enrolment convert, admission convert, leave approve, leave reject, student withdraw and student graduate. The dashboard activity feed recognises them.
- [ ] ADM-13: creating or editing an academic year whose dates overlap a non-archived year is a 409 with an inline error on the start date that names the other year. The server rejects end < start. ARCHIVED shows as "Diarsipkan".
- [ ] ADM-14: "Simpan & Terbitkan" asks for confirmation. Height and weight errors are Indonesian and bounded (height ≤ 250 cm, weight ≤ 200 kg). The enrolment form caps the same values.
- [ ] ADM-15: class names are unique per tenant, year and campus regardless of case, on both create and rename. Every CSV export starts with a UTF-8 BOM.
- [ ] FINX-9: "Catat Pembayaran" has a "Tanggal bayar" date (default today, no future dates), stored as `paidAt`. Admins with payment rights can download the kuitansi PDF from the invoice page.
- [ ] HR-14: "Total Hari" in the HR attendance CSV counts Hadir + Terlambat + Izin.
- [ ] Leave: the employee page shows the remaining leave ("sisa X dari Y hari"). Annual and permission leave cannot start before today (sick leave can). The reject reason must be at least 5 characters.
- [ ] STR-15: every guardian-link write invalidates the parent children cache.
- [ ] STR-17: the shared client error helper maps 401/403/5xx without a readable message to Indonesian copy.

### Non-goals
- No schema migration, no new dependency.
- No strict NIK/NISN/KK/phone/bank-account format validation (CORE-8, HRX-2). Existing production rows may not conform, and every edit form would start failing on untouched fields. This needs a data audit first.
- No COMMITTING billing-run cancel (STR-10). It needs a design for in-flight invoice creation.
- No Arabic PDF font (STR-6, an asset decision) and no proxy/auth changes (PAR-13, X-19).

### Assumptions
1. "Overlap" ignores ARCHIVED years and compares inclusive date ranges.
2. The admin kuitansi uses the same PDF as the parent one, gated by `payments.record` on admin roles.
3. `paidAt` for a back-dated payment is stored as 00:00 Asia/Jakarta of the chosen date. Today's date keeps the current timestamp.

## Tasks
- [ ] **T1 — Decisions + audit rows.** `app/api/enrollments/[id]/convert/route.ts`, `app/api/admissions/[id]/convert/route.ts`, `app/api/leave/requests/[id]/approve/route.ts`, `app/api/leave/requests/[id]/reject/route.ts`, `app/api/students/[id]/withdraw/route.ts`, `app/admin/enrollments/[id]/page.tsx`, `app/admin/admissions/page.tsx` (+ tests). ADM-6 plus audit rows (graduate is in T8). Independent.
- [ ] **T2 — Academic years.** `app/api/academic-years/route.ts`, `app/api/academic-years/[id]/route.ts`, `lib/validations/academic-year*.ts`, `components/ui/status-badge.tsx`, `app/admin/academic-years/**` (+ tests). ADM-13. Independent.
- [ ] **T3 — Raport + enrolment bounds.** `app/admin/report-cards/raport-editor.tsx`, `lib/validations/raport.ts`, `lib/enrollment/submit-validation.ts` (+ tests). ADM-14. Independent.
- [ ] **T4 — Class names + CSV.** `app/api/admin/classes/route.ts` (POST), `lib/students/export.ts`, the five CSV export routes (`attendance/export`, `student-attendance/export`, `students/export`, `payments/export`, `payroll/[id]/export/bsi`) (+ tests). ADM-15 (create), BOM, HR-14. Independent.
- [ ] **T5 — Payment date + admin kuitansi.** `lib/validations/invoice.ts`, `app/api/invoices/[id]/payments/route.ts`, `app/admin/invoices/[id]/page.tsx`, new `app/api/invoices/[id]/pdf/route.ts`, `app/api/guardian/invoices/[id]/pdf/route.ts`, new shared receipt-data builder under `lib/pdf/` (+ tests). FINX-9. Independent.
- [ ] **T6 — Leave + employee balance.** `lib/validations/leave.ts`, `app/api/leave/requests/route.ts`, `app/api/employees/[id]/route.ts`, `app/admin/(hr)/employees/[id]/page.tsx`, `app/admin/(hr)/leave-requests/page.tsx`, `components/teacher/leave-sheet.tsx` (+ tests). Leave items. Independent.
- [ ] **T7 — Error copy + parent cache.** `lib/api/client-errors.ts`, `lib/parent-helpers.ts`, `app/api/students/[id]/guardians/**`, `app/api/guardians/[id]/route.ts`, `lib/guardians/primary.ts` (+ tests). STR-17, STR-15 (exports `invalidateParentChildren()`; T1 calls it in both convert routes). Independent.
- [ ] **T8 — After #614 merges.** `app/api/students/[id]/graduate/route.ts` audit, `app/api/admin/classes/[id]/route.ts` rename uniqueness, `app/api/students/route.ts` cache invalidation, `lib/dashboard/activity-feed.ts` recognising T1's audit pairs. Depends on T1, T4, T7 and the #614 merge.
- [ ] **T9 — End-of-cycle gate, verification, Ship Notes.** Depends on T1–T8.

## Implementation
- Subagent plan: driver=claude-opus-5-5, dirty-work=claude-sonnet-5-5; [T1], [T2+T3], [T4+T6], [T5], [T7] in parallel on disjoint files; T8 and T9 sequential by the driver after #614 merges. The driver reviews each diff and commits per task.
- T1 (ADM-6, audit): converting an enrolment form moves the linked Admission (a String status) from INQUIRY / VISIT_SCHEDULED / VISITED to ADMITTED in the same locked update that links `studentId`; ADMITTED and CANCELLED never regress. `recordAudit(entry, tx)` rows ride the business transaction: `EnrollmentApplication.convert`, `Admission.convert` (after `{studentId}`), `LeaveRequest.approve` (PENDING → APPROVED, days), `LeaveRequest.reject` (PENDING → REJECTED, reason; the reject claim + audit + re-read now share one transaction, a lost race is still 409), `Student.withdraw` (date, reason). Refused and lost-race paths write none. Enrolment page: Terima and Tolak (destructive) go through a ConfirmDialog; Tolak tells staff to make sure the family is informed (the route sends no notification). Admissions list: the step into ADMITTED confirms first; other steps stay one click.
- T2 (ADM-13): POST and PUT `/api/academic-years` refuse an inclusive overlap with another non-ARCHIVED year in the tenant (409, `startDate` field error "Rentang tanggal bertumpuk dengan tahun ajaran <nama>."). PUT checks the effective range (body, else stored), excludes itself, and checks only when dates change or an archived year is revived, so a rename or archive never trips on legacy overlapping rows. `createAcademicYearSchema` / `updateAcademicYearSchema` reject end < start; the form schema reuses the create schema. StatusBadge renders ARCHIVED as neutral "Diarsipkan".
- T3 (ADM-14): "Simpan & Terbitkan" opens a ConfirmDialog ("Terbitkan rapor <nama>?" — "Orang tua akan langsung bisa melihat rapor ini."). Height/weight inputs carry `max`, `save()` validates through the shared `raportMeasurementSchema` (inline FieldError + toast, no PUT, blank → null, never NaN); the raport schema now says "Harus berupa angka" / "Harus lebih dari 0" / "Tinggi maksimal 250 cm" (was 300) / "Berat maksimal 200 kg". The parent enrolment form caps the same values.
- T4 (ADM-15 create, BOM, HR-14): new `lib/classes/name-clash.ts` `findClassNameClash(db, {tenantId, academicYearId, campusId, name, excludeId?})` (trimmed, `mode: "insensitive"`); POST `/api/admin/classes` refuses a case-insensitive clash with the existing 409 copy (shared `CLASS_NAME_CLASH_MESSAGE`, also used by the P2002 catch) and reuses an existing class track case-insensitively ("tk a" → "TK A"). `CSV_BOM` (`lib/students/export.ts`) prefixes the attendance, student-attendance, students and payments CSVs. Not the BSI payroll file: it is a bank upload with a machine-read header, where a BOM would corrupt the first column (a test pins that). HR attendance "Total Hari" = Hadir + Terlambat + Izin.
- T7 (STR-17, STR-15): `readApiError` maps a 403/401 with a missing or single-word body ("Forbidden") to "Anda tidak memiliki izin untuk tindakan ini." / "Sesi Anda berakhir. Silakan masuk kembali.", and a machine-word or stock "Internal Server Error" 5xx to "Terjadi kendala di server. Coba lagi sebentar lagi."; real Indonesian sentences and field errors pass through. Deviation: an empty-body 5xx keeps the caller's own Indonesian fallback (it names the failed action); the generic copy fills in only when no fallback exists. New `invalidateParentChildren()` (`revalidateTag("parent-children", { expire: 0 })`) runs after successful guardian-link and parent-contact writes in `students/[id]/guardians/**` and `guardians/[id]` (never inside a transaction; not on 4xx). `lib/guardians/primary.ts` is unchanged — it runs inside transactions, so its callers invalidate.

## Verification
- Frontend diffs checked against `.claude/standards/design-system.html` (ConfirmDialog for publish/decisions, inline FieldError, neutral muted status pill); no new colours.
- T2+T3: `npx vitest run app/api/__tests__/academic-years-overlap.test.ts lib/validations/__tests__/{raport-measurement,academic-year}.test.ts components/ui/__tests__/status-badge.test.tsx lib/enrollment/submit-validation.test.ts app/admin/report-cards app/api/__tests__/predictable-input-errors.test.ts` → all passed (the one red in that run, `form-api-roundtrip` › record payment, belonged to T5's in-flight `lib/validations/invoice.ts` edit).
- T1: `npx vitest run "app/api/students/[id]/withdraw" "app/api/enrollments/[id]/convert" "app/api/admissions/[id]/convert" app/api/__tests__/leave-reject.test.ts app/api/__tests__/leave-approve app/api/__tests__/admin-queue-hr-boundaries.test.ts app/admin/enrollments app/admin/admissions` → 11 files, 122 passed.
- T4: `npx vitest run app/api/__tests__/csv-export-bom.test.ts app/api/__tests__/admin-classes-unique-per-campus.test.ts lib/classes lib/students app/api/students app/api/__tests__/attendance-export-validation.test.ts app/api/__tests__/payments-auth.test.ts` → 17 files, 199 passed.
- T7: `npx vitest run guardian client-errors` → 17 files, 168 passed; `npx vitest run guardians client-errors parent-helpers` → 14 files, 149 passed.

## Ship Notes
