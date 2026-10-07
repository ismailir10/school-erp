# Admin dates in WIB, not UTC

## Context

Admin screens show timestamps on the UTC calendar day, so anything created between 00:00 and 06:59 WIB (17:00–23:59 UTC) appears dated the day before. Found during the 2026-10-07 staging walk of the enrollment-documents release: an inquiry created at 05:04 WIB on 7 Oct showed "6 Okt 2026" in `/admin/admissions` (Tanggal column and the date under Sumber), and the student converted from it at 05:15 WIB showed "Dibuat 6 Okt 2026" and "Formulir Pendaftaran 6 Okt 2026" on its dossier. The parent portal showed the correct "7 Oktober 2026".

Root cause is in `lib/format.ts`. `formatDate` / `formatDateShort` accept either a `YYYY-MM-DD` date or an ISO timestamp, but for a timestamp they cut the string at `"T"` — the UTC date — and format that, with no `timeZone`. Many callers make it worse by pre-truncating (`createdAt.split("T")[0]`, `submittedAt.slice(0, 10)`) before calling. `formatTime` / `formatDateTime` already pin `DISPLAY_TIME_ZONE = "Asia/Jakarta"` (cycle TCH-1); the date-only formatters were never brought along. A sweep found 18 display sites affected (admissions, enrollments, students list + dossier, users, report-card publish date, invoices, payments, leave requests, employees, journal monitoring/history, class teachers), plus a handful of "today" defaults computed from the UTC or browser clock.

Separately, three places print a birth date as raw ISO ("Bekasi, 2022-03-15"): the parent form's Tinjau step and both data blocks of `EnrollmentApplicationView` (child + parents) on the admin/student pages.

No UAT report covers these screens within 60 days. This was found in passing; it is not caused by the pending staging → main promotion.

## Spec

- [ ] `formatDate` and `formatDateShort` treat a full ISO timestamp as an instant and format it on the Asia/Jakarta calendar day. `2026-10-06T22:04:00.000Z` → `7 Okt 2026`.
- [ ] Date-only input is unchanged: `formatDateShort("2026-10-06")` → `6 Okt 2026` under process TZ `UTC`, `Asia/Jakarta` and `America/Los_Angeles`. UTC-midnight values (`2026-10-06T00:00:00.000Z`, how `@db.Date` / date-like `DateTime` columns serialize) also stay on `6 Okt`.
- [ ] Output is identical across process time zones for every input (SSR on Vercel runs UTC; browsers run WIB).
- [ ] No call site pre-truncates a timestamp before formatting. The nine `.split("T")[0]` / `.slice(0, 10)` display sites pass the raw timestamp instead, and the class-detail teachers table formats `createdAt` through `formatDateShort` instead of a raw `slice(0, 10)`.
- [ ] `/admin/admissions` Tanggal + Sumber date, `/admin/enrollments` list, `/admin/students` list "Dibuat", dossier JEJAK "Dibuat", "Formulir Pendaftaran" badge and "dikirim …" all show the WIB day.
- [ ] "Today" defaults that feed admin inputs use the Jakarta day via the existing `getTodayInTimezone` (`lib/attendance/timezone.ts`): `/admin/assessments` default week/day, the employee date-picker `max` on list + detail pages, and the students page `max` (also removes an SSR/browser hydration mismatch).
- [ ] Birth dates render as `15 Mar 2022` on the parent form's Tinjau step and in `EnrollmentApplicationView` (child and both parents); empty values still show "—".
- [ ] Vitest: new `formatDate` / `formatDateShort` cases in `lib/__tests__/format.test.ts`, modelled on the existing TCH-1 block — a 17:00–23:59Z timestamp lands on the next WIB day, date-only input never shifts, output stable across three process TZs.

**Non-goals**
- Month/year pickers that default from the browser-local clock (`classes/[id]`, employee-attendance monthly, payroll, student kehadiran, invoice due-date defaults). The browser is already WIB in practice; low risk, separate cleanup.
- `pick-default-year.ts` UTC-midnight comparisons (edge case, correct for stored values).
- Parent and teacher portals — already correct on the screens checked.
- Any data migration. Stored values are right; only display is wrong.

**Assumptions**
1. Every `DateTime` value that represents a calendar date (due dates, semester/holiday dates, `@db.Date`) is stored at UTC midnight. Under that assumption the new instant-aware path cannot move them: UTC midnight is 07:00 WIB on the same day. If some column stores Jakarta midnight (17:00Z the day before), it is currently shown a day early and will now be correct.
2. A string containing `"T"` is a timestamp; anything else is a `YYYY-MM-DD` date. This is the same heuristic the functions already use, so no caller changes meaning.
3. Fixing the two shared formatters (instead of adding a new `formatTimestampDate`) is the right call: it also fixes the eight sites that pass a raw timestamp without truncating, and a new export would leave the next caller free to pick the wrong one.
4. Birth dates use the short form (`15 Mar 2022`), matching the dossier's Data Anak section.

## Tasks

- [x] **T1 — WIB-aware `formatDate` / `formatDateShort`.** `lib/format.ts`: for timestamp input, parse as an instant and format with `timeZone: DISPLAY_TIME_ZONE`; date-only path unchanged; move `DISPLAY_TIME_ZONE` above its first use. Tests in `lib/__tests__/format.test.ts`. *Accept:* new tests pass; the full suite is green.
- [x] **T2 — Stop pre-truncating timestamps (depends on T1).** Pass raw timestamps at `components/admin/admissions/columns.tsx` (×2), `app/admin/enrollments/page.tsx`, `app/admin/students/page.tsx`, `components/admin/students/detail/rail-content.tsx`, `app/admin/students/[id]/page.tsx`, `components/admin/student-enrollment-application-block.tsx`, `app/admin/settings/users/page.tsx`, `components/admin/student-academics-block.tsx`; `components/admin/classes/detail/teachers-section.tsx` uses `formatDateShort`. *Accept:* `grep` finds no `formatDate*(…split("T")[0])` or `formatDate*(…slice(0, 10))` left in `app/admin` / `components/admin`; affected component tests are green.
- [x] **T3 — Jakarta "today" defaults (independent).** `app/admin/assessments/page.tsx` `todayYmd`, `app/admin/(hr)/employees/page.tsx` + `[id]/page.tsx` date `max`, `app/admin/students/page.tsx` date `max` → `getTodayInTimezone(DISPLAY_TIME_ZONE)`. *Accept:* no `toISOString().slice(0, 10)` / `split("T")[0]` / zoneless `toLocaleDateString("en-CA")` "today" left in those files.
- [x] **T4 — Human-readable birth dates (independent).** `app/pendaftaran/[token]/client.tsx` Tinjau row and `components/admin/enrollment-application-view.tsx` child + parent rows format `dateOfBirth` with `formatDateShort`, guarding empty values. *Accept:* "Bekasi, 15 Mar 2022"; an empty birth date still renders "—"; existing view/form tests green.

## Implementation

- Subagent plan: driver=claude-opus-5-5, dirty-work=claude-sonnet-5-5; tasks [T1→T2] sequential (T2 needs T1's formatter), T3 and T4 independent but run sequentially in one implementer because they share this worktree's index and gates.
- **T1** — `lib/format.ts`: `DISPLAY_TIME_ZONE` moved above first use; new private `parseTimestamp` (null for date-only/unparseable); `formatDate` formats timestamps with `timeZone: DISPLAY_TIME_ZONE`, date-only path unchanged; `formatDateShort` delegates to `formatDate`. `lib/__tests__/format.test.ts`: 7 new cases (rollover, 16:59:59Z/17:00:00Z boundary, UTC-midnight, date-only, caller options, unparseable fallback, three process TZs). Review (feature-dev:code-reviewer): no issues >=80 confidence. Noted at ~40: a zoneless `T` string (`2026-10-06T22:04:00`) parses in the process zone; no caller in the repo passes one (Prisma JSON always ends in `Z`), so left as-is.
- **T2** — nine display sites now pass the raw timestamp: `components/admin/admissions/columns.tsx` (x2), `app/admin/enrollments/page.tsx`, `app/admin/students/page.tsx`, `components/admin/students/detail/rail-content.tsx`, `app/admin/students/[id]/page.tsx`, `components/admin/student-enrollment-application-block.tsx`, `app/admin/settings/users/page.tsx`, `components/admin/student-academics-block.tsx`; `components/admin/classes/detail/teachers-section.tsx` now uses `formatDateShort` from `@/lib/format` ("Tgl Ditugaskan" reads "6 Okt 2026", was raw `2026-10-06`; roster keeps the local raw-slice `formatDate`). Review: no issues >=80. Reviewer noted three parent-portal sites that still pre-truncate (`app/parent/report-cards-list.tsx:96`, `app/parent/invoices/invoice-detail-sheet.tsx:308,339`) — outside this cycle's scope (parent portal is a non-goal); candidate follow-up.
- **T3** — `app/admin/assessments/page.tsx` (`todayYmd`), `app/admin/(hr)/employees/page.tsx` + `[id]/page.tsx` (DatePicker `max`), `app/admin/students/page.tsx` (DatePicker `max`) now use `getTodayInTimezone(DISPLAY_TIME_ZONE)`. `lib/attendance/timezone.ts` has no imports so it is client-safe; the assessments API computes its own default as the Jakarta day, so page and API agree. Review: no issues >=80. The employee-detail month/year picker seeded from `new Date()` is a stated non-goal.
- **T4** — `components/admin/enrollment-application-view.tsx`: new `dateV` (child + both parents' `dateOfBirth`; `v()` first so empty stays "—"; only `YYYY-MM-DD` is formatted, anything else — an older free-text value — passes through instead of "Invalid Date"). `app/pendaftaran/[token]/client.tsx`: `reviewDate` on the Tinjau row, same guard. Tests: new `components/admin/__tests__/enrollment-application-view.test.tsx` (3 birth dates, empty -> "—", free-text passthrough) and one Tinjau case in `app/pendaftaran/[token]/__tests__/client.test.tsx`. Review: no issues >=80. Noted ~35: a hand-crafted API submit of `2022-13-45` passes the shape-only `ISO_DATE_REGEX` and would render "Invalid Date"; a browser date input cannot produce it, out of scope.

## Verification

- Frontend diff checked against `design-system`: only the date string passed to `formatDateShort` changed; no markup, class or token changes.
- `npm run build` — exit 0 (T1, T2, T3, T4 states; no "Failed to compile" / "Type error").
- `npx vitest run` — final state (T4): `Test Files  496 passed | 2 skipped (498)` / `Tests  4666 passed | 42 todo (4708)`. T1-T3 states: 495 passed | 2 skipped, 4663 passed | 42 todo.
- `npx vitest run lib/__tests__/format.test.ts` — 28 passed (7 new date cases).
- `npm run lint` — `✖ 55 problems (0 errors, 55 warnings)`, all pre-existing.
- Acceptance grep: no `formatDate*(…split("T")[0])` / `…slice(0, 10))` left in `app/admin` / `components/admin`; no `toISOString().slice(0, 10)` / `split("T")[0]` / zoneless `toLocaleDateString("en-CA")` "today" left in the four T3 files.
- Playwright: driver runs local suite against disposable Postgres after build (see driver verification).
- Disk note: the last build ran with 456 MiB free (below the 1.2 GB floor the driver set; the check printed but did not gate the chained command). It completed; no further builds were attempted.
- **Driver re-verification (source SHA `273a69c6`, route = demo-auth browser + disposable local Postgres).** Diff classified as "other code changes" (display formatting, no auth/session/cookie/dependency touch) → local route, no `needs-staging-verify`.
  - `npx vitest run` re-run independently: `Test Files  496 passed | 2 skipped (498)` / `Tests  4666 passed | 42 todo (4708)`.
  - `DEMO_MODE=true npm run build` against `postgresql://e2e@localhost:55432/talib_dates` (schema via `prisma db push`, `prisma db seed`; Datasource confirmed `localhost:55432` before writing): exit 0, 0 "Type error"/"Failed to compile".
  - Playwright (local, production build, Chromium): targeted cross-module set covering every changed screen — `admin-admission-convert-parity`, `admin-classes`, `admin-dashboard`, `admin-students-full-crud`, `daftar-public`, `enrollment-application`, `enrollment-docs-followups`, `enrollment-documents`, `enrollment-signature-handover` → `37 passed (38.4s)`. Full suite left to the required CI `Playwright E2E` check (local disk too tight for all 38 specs' artifacts). Note: the repo's Playwright expects `chromium_headless_shell-1234`; only `-1243` was installed and the disk could not fit a download, so a temporary symlink was used for the run.
  - Browser walk (Chrome, local server, `school-erp-session=u_super_admin`), with the machine clock at ~23:48 UTC 6 Oct = 06:48 WIB 7 Oct: `/admin/admissions` rows created `2026-10-06T23:47Z` show "7 Okt 2026" in Tanggal and under Sumber; `/admin/enrollments` Dikirim "7 Okt 2026"; a student backdated to `createdAt = submittedAt = 2026-10-06T22:15Z` shows JEJAK "Dibuat 7 Okt 2026", badge "Formulir Pendaftaran 7 Okt 2026", "dikirim 7 Okt 2026", birth date "Bekasi, 15 Mar 2021", empty parent birth dates "—"; `/admin/assessments` requested `week=2026-10-07&day=2026-10-07` (old code would send the UTC day `2026-10-06`). 0 console errors (no hydration warnings) on every page visited.

## Ship Notes

- **Migrations:** none. No schema or data change; stored values were always right, only display moved.
- **Env vars:** none.
- **Behaviour change to eyeball:** timestamps now read on the Asia/Jakarta calendar day everywhere `formatDate` / `formatDateShort` receive an ISO timestamp (admin, parent, teacher). Date-only (`YYYY-MM-DD`) and UTC-midnight values are unchanged. "Tgl Ditugaskan" on class detail now reads "6 Okt 2026" instead of raw `2026-10-06`.
- **Known gap (follow-up):** three parent-portal sites still pre-truncate before formatting and show the UTC day for 00:00-06:59 WIB timestamps: `app/parent/report-cards-list.tsx:96`, `app/parent/invoices/invoice-detail-sheet.tsx:308,339`. Parent portal was a stated non-goal. Also not covered: a zoneless `T` string (no `Z`/offset) is parsed in the process zone; no caller passes one.
- **Rollback:** revert the four commits; nothing else to undo.
