# Cycle: Geofenced staff check-in, support-staff attendance, gate kiosk

## Context
The owner asked for three attendance changes plus a product principle:
1. Teacher check-in must be within 50 m of any campus. Outside → proceed with a note that admin approves.
2. Support staff (pembantu / tenaga pendukung) need attendance too, and admin must be able to record it for them.
3. Teachers often don't hold a phone at drop-off (penerimaan) and pickup (penjemputan). Need fewer-step options.
4. Adopt "don't make me think" as a written principle in CLAUDE.md (AGENTS.md is a symlink to it).

Facts (code survey):
- `AttendanceRecord` already stores `checkInLat/Lng`, one row per employee per day; `POST /api/attendance/check-in`
  never checks distance. Teacher check-in is one tap on `/teacher` (`app/teacher/home-client.tsx`), with geolocation
  (10 s timeout, falls back to no location).
- `Campus` has `lat/lng` (nullable) and no radius. Tenants have several campuses.
- Support staff are already `Employee` rows (`jabatan` is free text); `attendance.checkin` permission lets any employee
  with a login clock in. Staff without phones have no path today — only per-record admin override.
- `StudentAttendance` carries arrival (`checkInTime`), pickup (`checkOutTime`) and `pickedUpByRelation`. Teachers mark
  one student at a time in the session view; no bulk, no QR, no kiosk.
- `LeaveRequest` has the PENDING → APPROVED/REJECTED pattern to copy. Payroll reads attendance through
  `countAttendanceDays` (`lib/payroll/working-days.ts`).
- UAT: `docs/uat/reports/2026-06-04-admin-teacher-full.md` (>60 days, possibly stale — verify before acting) did not
  test clock-in because geolocation was needed. No attendance ADR.

## Decisions
- **Principle.** A short "Product principle: don't make me think" section in CLAUDE.md, the rules in
  `.claude/standards/patterns.md`, and `docs/workflow/spec.md` requires each spec to state the tap count of its main
  task. Shipped in this PR because this session is bound to one branch.
- **Geofence = nearest active campus with coordinates**, radius `Campus.radiusMeters` (default 50, editable per
  campus). Inside when `distance − min(accuracy, 100) ≤ radius`; the accuracy allowance is capped so a 2 km fix never
  passes. Campuses without coordinates are ignored; if a tenant has none, the check is skipped (never block a school
  that hasn't set campus pins) and admin sees a hint on the campus settings page.
- **Outside, or no location** → check-in needs a note and lands as `approvalStatus = PENDING`. Inside → `APPROVED` as
  today, still one tap.
- **Pending does not count as present in payroll.** Only `APPROVED` counts. Rejected → status `ABSENT`, with the
  reviewer's note.
- Admin reviews in a "Perlu persetujuan" tab on the existing staff attendance page; approve/reject is one tap each,
  plus "Setujui semua". The admin dashboard shows the pending count.
- **Support staff** use the same employee check-in when they have a login. New admin page **Absensi Staf Harian**:
  today by default, grouped by campus, one tap "Tandai semua hadir", then tap only the exceptions. Each record carries
  `source` (SELF | ADMIN | KIOSK) and `recordedBy`.
- **Student drop-off/pickup, option 1 + option 3** (owner choice):
  - Session view gets "Semua hadir" (arrival, everyone not yet marked) and "Semua pulang" (pickup, default relation
    Orang tua). Exceptions are tapped as today.
  - **Gerbang (gate) mode** at `/teacher/gate`: any teacher, on any device including a shared front-desk tablet, sees
    every active student on a campus (defaults to their own campus), searches by name, and taps a child to record
    arrival or pickup. No class assignment or piket schedule needed. It writes the same record as the class session,
    so the homeroom teacher sees it. Pickup defaults to Orang tua; one more tap changes the relation.
- Additive migration only: new nullable/defaulted columns; existing rows default to `APPROVED` / `SELF`.

## Acceptance criteria
- [ ] Teacher within the radius (accuracy allowed) checks in with one tap, as today.
- [ ] Outside the radius or without location, the teacher sees the distance to the nearest campus and a note field;
      submitting saves a pending check-in. Submitting without a note is refused.
- [ ] Admin sees pending check-ins with name, time, distance, campus and note; approve and reject work, as does
      "Setujui semua". The dashboard shows the pending count.
- [ ] Payroll counts only approved days; a rejected day is ABSENT.
- [ ] Admin can edit a campus's radius (default 50 m).
- [ ] Admin can record a whole campus's staff for a day with one tap plus exceptions, without the staff having a login.
- [ ] Teacher can mark every unmarked student in a session present in one tap, and every present student picked up in
      one tap.
- [ ] Any teacher can use Gerbang mode to record a student's arrival and pickup by tapping their name, and the record
      appears in that student's class session.
- [ ] CLAUDE.md, patterns.md and docs/workflow/spec.md carry the principle; `audit-docs.sh` passes.

## Verify flows
1. **Inside.** `u_teacher`, browser geolocation set to a seeded campus pin → one tap → "Masuk" recorded, no sheet.
2. **Outside.** Geolocation 300 m away → sheet shows ± 300 m and a note field → submit → "Menunggu persetujuan".
3. **Approve.** `u_school_admin` → staff attendance → Perlu persetujuan → Setujui → row turns approved.
4. **Staff day.** Admin → Absensi Staf Harian → Tandai semua hadir → mark one Sakit → refresh, both persist.
5. **Class bulk.** Teacher session → Semua hadir → Semua pulang → all rows show both times.
6. **Gate.** Teacher → Gerbang → search a child of another class → tap Masuk; later tap Pulang. The child's own class
   session shows both.
7. **Edge.** Location denied → same note path. Tenant with no campus pins → plain check-in.

## UX notes
- Outside sheet copy: "Anda ± {n} m dari {campus}. Tambahkan catatan agar admin dapat menyetujui." Button
  "Kirim untuk disetujui". No location: "Lokasi tidak terbaca. Tambahkan catatan agar admin dapat menyetujui."
- Teacher status chip after pending: "Menunggu persetujuan".
- Tap counts (principle): inside check-in 1; outside 1 + note + 1; staff day 1 + exceptions; class arrival 1 +
  exceptions; gate 1 per child (search optional).
- Gate mode: big touch targets (≥ 48 px), name + class label, Masuk/Pulang segmented toggle at top, marked children
  greyed with time.

## Test seams
- Vitest: `lib/attendance/geofence.ts` (haversine, accuracy cap, nearest campus, no-pin skip); check-in route
  (inside/outside/no-note/no-pins); approve/reject routes; payroll counting excludes PENDING/REJECTED; staff bulk
  route; student bulk + gate routes (tenant scoping, permission).
- Playwright: extend the teacher daily spec with the outside → pending → admin approve flow and gate arrival.

## Non-goals
- Parent QR self check-in (option 2), NFC/RFID, face recognition.
- Geofencing check-out (stored, not enforced).
- Piket rosters or class assignment for gate mode.

## Assumptions
- 100 m accuracy cap is fair for indoor GPS.
- Gate mode is a teacher-portal page, so a shared tablet stays signed in as a teacher.

## Gate re-openers
- A school wants check-out enforced too, or wants gate mode for non-teacher staff (needs a new permission).

## Tasks
- [ ] T0 Principle in CLAUDE.md + patterns.md + docs/workflow/spec.md — accept: audit-docs passes (deps: —) — parallel
- [ ] T1 Schema + migration: Campus.radiusMeters; AttendanceRecord approvalStatus/checkInNote/distanceMeters/nearestCampusId/source/recordedBy/reviewedBy/reviewedAt/reviewNote — accept: migrate fresh DB, seed passes (deps: —)
- [ ] T2 Geofence lib + check-in route + teacher outside sheet — accept: Vitest (deps: T1)
- [ ] T3 Approve/reject API, admin pending tab, dashboard count, payroll counts APPROVED only, campus radius field — accept: Vitest (deps: T1) — parallel with T2
- [ ] T4 Absensi Staf Harian page + bulk API — accept: Vitest (deps: T1) — parallel with T2/T3
- [ ] T5 Session "Semua hadir"/"Semua pulang" + Gerbang mode page + API — accept: Vitest (deps: —) — parallel
- [ ] T6 README, docs/uat/jobs, e2e — accept: Playwright local (deps: T2–T5)

## Implementation
- **Plan:** driver=claude-opus-5-5 (spec, review, sign-off); workers=claude-sonnet-5-5 (T1–T3 one agent, sequential because they share the schema; T5 in parallel; T4 after T1), claude-haiku-5-5 (T0 docs). Driver implemented no slice.
- **T0:** CLAUDE.md § Product principle, `.claude/standards/patterns.md` § Don't make me think, `docs/workflow/spec.md` tap-count rule.
- **T1:** migration `20261107000000_attendance_geofence`, additive: `Campus.radiusMeters` (default 50); `AttendanceRecord` gains approvalStatus (default APPROVED, indexed), checkInNote, checkInAccuracy, distanceMeters, nearestCampusId, source (default SELF), recordedBy, reviewedBy/At, reviewNote.
- **T2:** `lib/attendance/geofence.ts` (haversine, nearest pinned campus, accuracy allowance capped at 100 m, no pins → skipped). Check-in: outside or no location without a ≥ 3-char note → 422 `OUTSIDE_GEOFENCE` with distance and campus, no row; with note → PENDING. Teacher sees a `ResponsiveFormDialog` (sheet on mobile) and a "Menunggu persetujuan" chip.
- **T3:** `POST /api/attendance/[id]/approve|reject`, `POST /api/attendance/approve-all`, `GET /api/attendance/pending` (attendance.override, tenant-scoped, skip payroll-locked rows; shared logic in `lib/attendance/review.ts`). Reject sets ABSENT. Admin staff attendance gets a "Perlu persetujuan" tab; the Dasbor attendance strip shows a pending badge linking to it. `countAttendanceDays` counts APPROVED only. Campus form gains a radius field (10–1000 m) and a hint when no campus is pinned.
- **T4:** `/admin/employee-attendance/daily` (button on the staff attendance header; the sidebar test pins exact hrefs). `GET/PUT/DELETE /api/attendance/daily`, `POST /api/attendance/daily/bulk` (attendance.override, tenant-scoped, rate-limited). Bulk creates PRESENT at the tenant's work start for ACTIVE employees with no record (`createMany` + `skipDuplicates`), source ADMIN; undo deletes only those ADMIN rows. Hadir/Sakit/Izin/Alpa = PRESENT/SICK/PERMISSION/ABSENT (existing statuses; payroll treatment unchanged). Future dates allow only Sakit/Izin. Locked rows are read-only. Monthly view and CSV show PENDING as "Menunggu" and no longer count it as Hadir.
- **T5:** session view "Semua hadir" / "Semua pulang" are client-side over the existing Simpan, with an "Urungkan" toast; they never overwrite exceptions or existing times (`lib/attendance/bulk.ts`). Gerbang: `app/teacher/gate`, linked from the "Lainnya" sheet (portal.md: new destinations go there). `GET/POST /api/teacher/gate` (TEACHER or admin with an employee, tenant + campus scoped, rate-limited); POST actions arrive / pickup / undo_arrive / undo_pickup. The session comes from the child's existing row today, else the class's FULL_DAY → MORNING/AFTERNOON session, else one `reconcileSessions` pass, else 409; upsert on (studentId, sessionId) so the class view sees the same row. Touch targets ≥ 48 px per design-system.html.
- **Verify-local fixes:** `lib/security/headers.ts` sent `Permissions-Policy: geolocation=()` on every response (the middleware overrode `next.config.ts`'s `geolocation=(self)`), so the browser never gave the teacher home a fix and every check-in would have landed as "Lokasi tidak terbaca" and PENDING; now `geolocation=(self)` and the header test pins it. The staff attendance header actions now wrap (`flex-wrap`) so the new third button no longer scrolls the page sideways at 390 px (`mobile-layout.spec.ts`).

## Verification

## Ship Notes
