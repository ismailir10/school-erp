# "Today" from the UTC clock: four server-side sites that give the wrong day before 07:00 WIB

## Context

Vercel functions run in UTC; the school runs on Asia/Jakarta (UTC+7, no DST). Between 00:00 and 06:59 WIB the UTC date is still *yesterday*, so any server code that derives "today", "this month" or "this year" from `new Date()` getters answers for the wrong day. #607 and #638 fixed the **display** half of this class (`formatDate`). This cycle is the **logic** half: places where the wrong day feeds a query, a validation or a balance. `lib/attendance/timezone.ts` already has `getTodayInTimezone` / `getYmdInTimezone` and their boundary tests (00:30, 06:30, month and year rollover); the sites below simply do not use them.

A read-only sweep of `app/api`, `lib` and the server pages (every `toISOString().slice`, `getFullYear/getMonth/getDate`, `setUTCHours`, `Date.now()` pattern) classified ~60 hits. Most are safe (pure YMD-string arithmetic, already Jakarta-aware, or real instants). **Four are real**, each re-read in the code before this Spec:

1. `lib/validations/attendance.ts:62-64` — the "no more than 30 days ahead" cap on `attendanceOverrideSchema` takes `today` as `new Date().setUTCHours(0,0,0,0)`. At 00:00-06:59 WIB "today" is yesterday, so an admin entering PRESENT/LATE/HALF_DAY/ABSENT exactly 30 Jakarta days ahead is rejected. Boundary case only; nothing wrong is saved.
2. `lib/leave/balance.ts:22-24` — `balancePeriodStart()` is `` `${now.getFullYear()}-01-01` ``. On **1 Jan, 00:00-06:59 WIB** the year is still the old one, so the balance period starts a year early. The leave balance GET, submit and approve (`approve/route.ts:90`) then count last year's approved leave against this year's allowance. This is the only one that can change a real decision (an approval).
3. `app/api/attendance/my`, `.../monthly`, `.../export` and `app/api/employees/[id]/attendance` default `month`/`year` from `new Date().getMonth()/getFullYear()` when the params are absent. On the 1st at 00:00-06:59 WIB a caller that sends no params gets last month's attendance or CSV (last year's on 1 Jan). The in-repo UI sends explicit params from the browser clock, so this bites bookmarks, scripts and the CSV link.
4. `lib/parent-activity.ts:29-31` — the attendance cutoff `sinceYmd` comes from the UTC date, so the "last 30 days" window is 31 days at 00:00-06:59 WIB. Cosmetic, but it is a one-liner and `lib/parent-helpers.ts` already does it right.

No UAT report covers these (they are time-of-day dependent and a browser walk would not hit the window). Not touched: `lib/student/age.ts` and `lib/academic-period.ts` (display-only / fallback-only, left as noted follow-ups), the dead `mondayOfWeek` helper in `lib/parent-helpers.ts`, and the dev-only `app/api/admin/seed` route.

## Spec

- [ ] `attendanceOverrideSchema` computes "today" with `getTodayInTimezone("Asia/Jakarta")`. At 03:00 WIB, a date exactly 30 Jakarta days ahead is accepted and 31 days ahead is rejected, for PRESENT; LEAVE/SICK/PERMISSION still bypass the cap.
- [ ] `balancePeriodStart(now)` returns the Jakarta year's `-01-01`. At 2026-12-31T20:00Z (03:00 WIB on 1 Jan 2027) it returns `2027-01-01`; at 2026-06-15T10:00Z it returns `2026-01-01`; at 2027-01-01T05:00Z (12:00 WIB) it returns `2027-01-01`; at 2026-12-31T16:00Z (23:00 WIB on 31 Dec) it still returns `2026-01-01`. The `now: Date = new Date()` signature is kept so all callers are unchanged.
- [ ] A small shared helper `getMonthYearInTimezone(d, timezone)` (returns `{ month, year }`) lives next to `getYmdInTimezone`, with boundary tests (00:30 WIB on the 1st, 1 Jan, 23:30 WIB on the last day).
- [ ] The four attendance routes use that helper for their default month/year. With no params at 2026-09-30T20:00Z (03:00 WIB, 1 Oct) each queries October, not September; explicit `?month=&year=` behaves exactly as before; the export route keeps its 400 for invalid input.
- [ ] `getStudentRecentActivity` derives `sinceYmd` with `getYmdInTimezone(sinceDate, "Asia/Jakarta")`, so the window is exactly `days` Jakarta days.
- [ ] Every new test is **red on the current code and green on the fix** (verified by running it before the change). No test uses a wall-clock dependency: all use `vi.useFakeTimers()` + `setSystemTime`.
- [ ] No markup, copy, schema, dependency, auth or response-shape change; `design-system` tokens are untouched (no `.tsx` edited).

**Non-goals**
- `lib/student/age.ts`, `lib/admission/age.ts`, `lib/academic-period.ts` `getCurrentPeriod`: display-only or fallback-only, and the period one needs a trace of what it is stored into. Listed in Ship Notes as follow-ups.
- Client components (`"use client"`) that use the browser clock; the browser is on WIB.
- Removing the dead `mondayOfWeek` / `countAttendanceThisWeek` in `lib/parent-helpers.ts` (covered by an existing suite; separate cleanup).
- No migration, no new dependency, no change to who may call these routes.

**Assumptions I'm making**
1. The school timezone is the constant `"Asia/Jakarta"`, as in the existing fixes (`app/admin/page.tsx`, `lib/parent-helpers.ts`, `app/api/admin/classes/route.ts`). Some routes read `orgConfig.timezone`; these four do not, and I do not add that lookup.
2. Defaulting month/year to the **Jakarta** month is the intended meaning of "current month" for a school in Indonesia.
3. `leaveRequest.startDate` is a `YYYY-MM-DD` string (the existing code compares it with `gte: "2026-01-01"`), so comparing it with the Jakarta-year string is consistent.
4. Docs-only classification does not apply (runtime `.ts` changes, API routes), so `/ship` uses its local route; the local browser/Postgres route cannot run in this sandbox, so the four CI checks gate the merge (recorded below). No `app/api` route changes its auth or response shape, so no signed-in staging check.

## Tasks

- [x] **T1 — Override cap uses the Jakarta day.** `lib/validations/attendance.ts`; extend `lib/validations/__tests__/attendance.test.ts`. *Accept:* the 30/31-day cases at 03:00 WIB fail before and pass after. *Depends on:* nothing.
- [x] **T2 — Leave balance period uses the Jakarta year.** `lib/leave/balance.ts`; new `lib/leave/__tests__/balance.test.ts`. *Accept:* the 1 Jan 03:00 WIB case fails before and passes after; the mid-year and later-in-day cases pass both ways. *Depends on:* nothing.
- [x] **T3 — Shared month/year helper + four routes.** Add `getMonthYearInTimezone` to `lib/attendance/timezone.ts` (+ cases in `lib/attendance/__tests__/timezone.test.ts`); use it in `app/api/attendance/my/route.ts`, `app/api/attendance/monthly/route.ts`, `app/api/employees/[id]/attendance/route.ts`, `app/api/attendance/export/route.ts`; add a no-params-on-the-1st case to the existing route tests (`attendance-my.test.ts`, `attendance-export-validation.test.ts`, a `monthly` and an `employees/[id]/attendance` case where a suite exists, otherwise one new small suite). *Accept:* each route queries October at 2026-09-30T20:00Z with no params, and explicit params are untouched. *Depends on:* nothing (order only).
- [x] **T4 — Parent activity window.** `lib/parent-activity.ts`; test for the `studentAttendance` `date.gte` argument at 03:00 WIB. *Accept:* the cutoff is exactly 30 Jakarta days back. *Depends on:* nothing.
- [ ] **T5 — Bookkeeping.** Implementation / Verification / Ship Notes, `bash scripts/audit-docs.sh --write`, `bash scripts/audit-docs.sh`. *Depends on:* T1-T4.

## Implementation

- Subagent plan: driver=claude-sonnet-5-5, dirty-work=Explore agent (read-only) for the triage sweep that produced the four sites; tasks [T1,T2,T3,T4] inline, sequential. Reason: each task is a few lines plus a red-first test, in different files but one shared helper (T3), so a per-task subagent would cost more context than the edit. An independent read-only reviewer agent runs on the final diff.
- Task 1: Override cap uses the Jakarta day — `lib/validations/attendance.ts` (+ import of `getTodayInTimezone`), `lib/validations/__tests__/attendance.test.ts` — `today` is now the Jakarta calendar day at UTC midnight; the 03:00 WIB "30 ahead accepted / 31 rejected" case was red before and is green now, the 12:00 and 23:30 WIB cases and the LEAVE/SICK/PERMISSION bypass pass both ways.
- Task 2: Leave balance period uses the Jakarta year — `lib/leave/balance.ts`, new `lib/leave/__tests__/balance.test.ts` — `balancePeriodStart` reads the year from `getYmdInTimezone(now, "Asia/Jakarta")`; the 17:00Z and 20:00Z 31-Dec cases (00:00 and 03:00 WIB on 1 Jan) were red before, 16:59Z / 05:00Z / mid-year pass both ways. `app/api/leave`, `app/api/employees`, `lib/leave` suites: 21 tests green.
- Task 3: Shared month/year helper + four routes — `lib/attendance/timezone.ts` (new `getMonthYearInTimezone(d, tz)` → `{ month, year }` numbers), `lib/attendance/__tests__/timezone.test.ts` (+5 cases), `app/api/attendance/my/route.ts`, `app/api/attendance/monthly/route.ts`, `app/api/employees/[id]/attendance/route.ts`, `app/api/attendance/export/route.ts` (default month/year from the helper; export keeps its 400 validation), new `app/api/__tests__/attendance-default-month.test.ts` — one `describe.each` over the four routes × (03:00 WIB on the 1st, 03:00 WIB on 1 Jan, 23:30 WIB on the 30th, explicit params): the 8 in-window cases were red before (September/December returned), the 8 others passed both ways. Existing `attendance-my`, `attendance-export-validation`, `staff-attendance-scoping` and `lib/attendance` suites: 104 tests green with the new suite.
- Task 4: Parent activity window — `lib/parent-activity.ts` (`sinceYmd` from `getYmdInTimezone(sinceDate, "Asia/Jakarta")`; the three `createdAt` filters still use the instant), new `lib/__tests__/parent-activity-window.test.ts` — at 03:00 WIB on 15 Oct the attendance and journal-entry cutoff was `2026-09-14` (31 days) before and is `2026-09-15` now; the 12:00 WIB, 23:30 WIB and instant-filter cases pass both ways; custom `days: 7` covered. `app/api/parent` and `app/api/parents` suites green.

## Verification

## Ship Notes
