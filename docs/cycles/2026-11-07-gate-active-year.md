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
- [ ] Gerbang's list and the Beranda Gerbang count exclude children whose only ACTIVE enrollment is in a class of a
      non-ACTIVE academic year.
- [ ] A child with ACTIVE enrollments in an archived-year class and an active-year class with a session today: tapping
      Masuk records arrival on the active-year session (no 409).
- [ ] A child in two active-year placements, only one of which has a session today, lands on the one with the session.
- [ ] `OrgConfig.workingDays = "MON,TUE,WED,THU,FRI"` no longer makes session reconcile throw. A value that is
      neither JSON nor CSV day codes still fails loudly.
- [ ] `GET /api/teacher/gate` response shape and its auth/tenant checks are unchanged.

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
- [ ] T1 Active-year scope + session-aware placement choice in Gerbang (helper + POST) and the tolerant session
      working-days parser, with tests — accept: AC 1–5, task gate green.

## Implementation
- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5-5; T1 sequential (single slice).

## Verification

## Ship Notes
