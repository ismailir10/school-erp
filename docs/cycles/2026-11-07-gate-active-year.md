# Cycle: Gerbang ignores archived-year classes; session working-days tolerate legacy CSV

## Context
Chrome verification of the staging deploy `1a27cdc4` (#725) found that tapping a child on Gerbang (`/teacher/gate`)
fails. The owner asked to verify and adjust before promoting #721–#725 to main.

1. **500 `org_config_working_days_invalid_json`.** Staging `OrgConfig.workingDays` held the legacy CSV form
   `MON,TUE,WED,THU,FRI`. The session reconciler's parser only accepts a JSON array and throws on anything else.
   Payroll already parses both forms (`lib/payroll/working-days.ts` documents this historical drift). Prod stores
   JSON, so prod is not affected today. The staging row was corrected to JSON on 2026-11-07, but the parser stays
   brittle.
2. **409 "Belum ada sesi kelas hari ini" for a child who has a session.** Staging has two ACTIVE `DCARE` class
   sections: one in academic year 2024/2025 (ARCHIVED) and one in 2025/2026 (ACTIVE). Nine of the ten seeded children
   hold an ACTIVE enrollment in both. The Gerbang roster, the Beranda Gerbang count (#725) and the tap handler filter
   class sections by `status: ACTIVE` but not by academic year. The tap handler takes the first enrollment with no
   ordering, landed on the archived-year section, found no session, and returned 409. Beranda's class list already
   filters `academicYear: { status: "ACTIVE" }`; Gerbang is the odd one out. A real school can hit the same thing after
   a year roll-forward that leaves old enrollments ACTIVE.

## Decisions
- **Gerbang scope = classes in the ACTIVE academic year**, matching Beranda. This applies to the roster, the Beranda
  count and the tap handler, through the shared `lib/attendance/gate-summary.ts` scope.
- **A child with more than one placement:** the tap uses the placement whose class has a session today (respecting
  the existing arrive/pickup slot preference). Only if none has one does it fall back to reconciling the first
  placement, which keeps today's behaviour.
- **Session working-days parser accepts both forms.** It takes the JSON array or the legacy CSV and still reports
  unknown codes. It still throws on a value that is neither form, so a truly corrupt config fails loudly, as its
  docstring intends.
- No data migration. Archived-year enrollments are left as they are; Gerbang just stops looking at them.

## Acceptance criteria
- [x] Gerbang's list and the Beranda Gerbang count exclude children whose only ACTIVE enrollment is in a class of a
      non-ACTIVE academic year.
- [x] A child with ACTIVE enrollments in an archived-year class and an active-year class with a session today: tapping
      Masuk records arrival on the active-year session (no 409).
- [x] A child in two active-year placements, only one of which has a session today, lands on the one with the session.
- [x] `OrgConfig.workingDays = "MON,TUE,WED,THU,FRI"` no longer makes session reconcile throw. A value that is
      neither JSON nor CSV day codes still fails loudly.
- [x] `GET /api/teacher/gate` response shape and its auth/tenant checks are unchanged.

## Verify flows
1. Teacher → `/teacher/gate` → tap a child enrolled in both an archived-year and an active-year class (with a session
   today) → arrival recorded, count +1; Beranda row +1.
2. Pulang on the same child → pickup recorded with Orang tua.
3. Edge: a child whose only enrollment is in an archived-year class does not appear on Gerbang.
4. Error: a child in an active-year class with no session today and no reconcilable day → 409 with the existing copy.

## UX notes
No UI change. Main task tap count unchanged: 1 tap per child.

## Test seams
- Unit: `parseWorkingDays` in `lib/sessions/dates.ts` (JSON, CSV, garbage).
- Unit: the gate-summary roster scope (archived-year enrollment excluded).
- Route test for `POST /api/teacher/gate`: placement choice (archived vs active year; two active placements, one with
  a session).

## Non-goals
- Closing archived-year enrollments in data, and changing roll-forward behaviour.
- Other `reconcileSessions` callers.

## Assumptions
1. "Active academic year" means `AcademicYear.status = ACTIVE`, the same filter Beranda uses.

## Gate re-openers
None (no schema, no new route, no auth change; `app/api/**` touched, so a security reviewer runs).

## Tasks
- [x] T1 Active-year scope + session-aware placement choice in Gerbang (helper + POST) and the tolerant session
      working-days parser, with tests — accept: AC 1–5, task gate green.

## Implementation
- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5-5; T1 sequential (single slice).
- T1: lib/attendance/gate-summary.ts, app/api/teacher/gate/route.ts, lib/sessions/dates.ts (+ tests: lib/sessions/__tests__/dates.test.ts, lib/attendance/__tests__/gate-summary.test.ts, app/api/__tests__/teacher-gate.test.ts) — roster and tap scoped to ACTIVE academic year; POST fetches all placements (findMany by classSectionId) and picks the one with a session today, else reconciles the first; parseWorkingDays accepts JSON or legacy CSV.

## Verification

### Verified locally — c5ab4032, 2026-11-07
- Compared: `origin/staging...HEAD` (staging 1a27cdc4). Changed paths: `app/api/__tests__/teacher-gate.test.ts`, `app/api/teacher/gate/route.ts`, `docs/cycles/2026-11-07-gate-active-year.md`, `lib/attendance/__tests__/gate-summary.test.ts`, `lib/attendance/gate-summary.ts`, `lib/sessions/__tests__/dates.test.ts`, `lib/sessions/dates.ts`.
- Ship route: other code (no auth/session/cookie change; app/api touched -> security-reviewed in diff review).
- Gate `npm run lint` -> exit 0, no warnings (`--max-warnings=0`).
- Gate `npx vitest run` (no DEMO_MODE) -> Run 1: `Test Files  1 failed | 757 passed | 2 skipped (760)`, `Tests  1 failed | 9292 passed | 42 todo (9335)` (spp-prepay-dialog, "names the line limit instead of the component reasons at 20 lines"). Run 2 (full suite, machine loaded by a concurrent server/browser walk): `Test Files  2 failed | 756 passed | 2 skipped (760)`, `Tests  2 failed | 9291 passed | 42 todo (9335)` (spp-prepay-dialog same test + `app/pendaftaran/[token]/__tests__/client-validation.test.tsx` "blocks Lanjut on Ayah"). Both files re-run alone -> `Test Files  2 passed (2)`, `Tests  56 passed (56)`. Known jsdom load flakes; none touches this diff.
- Gate `bash scripts/verify-rls-coverage.sh` -> `RLS coverage OK: 51 / 51 tenant-scoped models have ENABLE + policy.`
- Gate `bash scripts/verify-api-auth.sh` -> `API auth coverage OK: 239 / 239 routes have session helper or @public sentinel.`
- Gate `DEMO_MODE=true NEXTAUTH_SECRET=local-dummy npm run build` -> succeeded (route table printed, exit 0).
- Gate `npx playwright test` -> NOT RUN: every spec fails at launch with `browserType.launch: Executable doesn't exist at .../ms-playwright/chromium_headless_shell-1248/...` (installed Playwright wants build 1248; cache holds 1243/1254). Summary line of the failed attempt: `7 passed (11.3m)`, 25 did not run, remainder failed at browser launch (not a product result). Needs `npx playwright install chromium` (download) then re-run. Not deferred to CI.
- App: production build on http://localhost:3000, demo auth (`u_teacher`) + disposable local Postgres (postgres:15, seed). Phone 390x844.
- Walked (u_teacher): /teacher Gerbang row "0 dari 85 sudah masuk" -> /teacher/gate; error case: Saturday, no session, non-working day -> Masuk tap on Ahmad Zafran Hidayat (TKIT A) POST 409 "Belum ada sesi kelas hari ini" (existing copy). Seed has no sessions for 2026-11-07 (a Saturday) so the disposable DB OrgConfig.workingDays was set to the legacy CSV `MON,TUE,WED,THU,FRI,SAT` (this also exercises the tolerant parser): Masuk tap on the same child -> POST 200, toast "Ahmad Zafran Hidayat masuk", count "Sudah masuk 1 dari 85" (+1); Pulang tap on the same child -> POST 200 (pickup recorded, row shows time 15.19, "Sudah pulang 1 dari 85"; no Orang tua picker appeared); /teacher -> "1 dari 85 sudah masuk · 1 pulang". The seed has a single ACTIVE academic year, so archived-year edge and two-placement choice are covered by unit/route tests only, not walked.
- Console/network: /api/teacher/gate GET 200 x2, POST 409 (expected), 200 x2. Console errors are local-env only: `/_vercel/insights` and `/_vercel/speed-insights` script 404, `manifest.webmanifest` syntax error.
- Screenshots: /tmp/gate-beranda-phone.png (phone). Highlight: n/a (no UI change).
- Design-system: no frontend file changed.
- Rounds: 1, no fixes. Not checked: Playwright suite (above); archived-year placement in a live browser.

## Ship Notes
- No migration, no env var.
- Staging `OrgConfig.workingDays` was normalised to JSON on 2026-11-07 (prod already JSON); the parser now also tolerates legacy CSV.
- Post-merge: Chrome re-check of Gerbang arrive/pickup on staging.
- Rollback: revert the merge commit.
