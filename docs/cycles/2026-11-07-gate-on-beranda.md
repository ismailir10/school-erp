# Cycle: Gerbang on Beranda (+ pre-promotion staging fixes)

## Context
Gerbang mode (record a child's arrival and pickup at the school gate, any class on the campus) shipped to staging
in #724, but its only entry point is the teacher's "Lainnya" sheet: two taps, and invisible unless the teacher
already knows it is there. The owner finds hiding it under Lainnya wrong; it belongs on Beranda. The gate page's own
back link already says "Beranda".

A teacher's morning runs: arrive → check in ("Kehadiran pribadi", the top of Beranda) → stand at the gate for
drop-off. Pickup is the same gate later in the day. Gerbang is therefore the next step after check-in, at both ends
of the day.

This cycle also carries any fixes found by the Chrome walk of the staging deploy (#721–#724) before the staging →
main promotion.

## Decisions
- **Fixed row on Beranda, directly under "Kehadiran pribadi".** It follows check-in in the real morning flow. Always
  in the same place for every teacher; no time-of-day reordering, because a target that moves breaks muscle memory.
- **Glanceable count in the row.** The row tells the teacher the gate status without opening it ("18 dari 40
  sudah masuk · 3 pulang", the same "masuk" wording as the Gerbang page). Same scope and counting as the Gerbang page itself: the teacher's default campus, active
  enrollments, today in Asia/Jakarta, voided records ignored.
- **Not a bottom-nav tab.** All five slots are taken, and Gerbang is a task, not a section.
- **Removed from Lainnya.** One home only. The feature is not on production yet, so no habit is broken.

## Acceptance criteria
- [ ] A teacher's Beranda shows a "Gerbang" row directly below "Kehadiran pribadi"; tapping it opens the Gerbang page.
- [ ] The row's description shows today's arrived / picked-up counts for the teacher's campus, matching what the
      Gerbang page shows.
- [ ] With no children on the campus, the row reads `Catat anak masuk dan pulang di gerbang` (no "0 dari 0").
- [ ] If the count cannot be loaded, the row still appears with that plain description and Beranda renders normally.
- [ ] The Lainnya sheet no longer lists Gerbang.
- [ ] Any defects from the staging Chrome walk are fixed (listed in Tasks once known).

## Verify flows
1. Teacher (`u_teacher`) → `/teacher` → Gerbang row under Kehadiran pribadi shows counts → tap → Gerbang page lists
   the same campus children; record one arrival → back to Beranda → count went up by one.
2. Teacher → open Lainnya → Gerbang is absent; the other items remain.
3. Edge: campus with no active enrollments → plain description, no zero counts.
4. Error: count lookup throws → Beranda still renders, row shows the plain description.

## UX notes
- Main task tap count: Beranda → Gerbang = **1 tap** (was 2: Lainnya → Gerbang).
- Row uses the existing Beranda task-row look (icon, title "Gerbang", description, "Buka"). Quieter than the
  current-class primary button; it is a secondary action on the screen.

## Test seams
- Unit test for the shared campus gate-summary helper (counts, voided ignored, empty campus).
- Component test for the Beranda row (counts, plain fallback) and the Lainnya sheet (no Gerbang).
- e2e: extend `e2e/attendance-geofence-gate.spec.ts` to enter Gerbang from Beranda.

## Non-goals
- Time-aware hero card, gate kiosk login, QR check-in, per-class filters on the row.

## Assumptions
1. "Teacher's campus" = the same default campus the Gerbang page already picks.
2. The count is computed server-side on Beranda load; no live polling.

## Gate re-openers
None (no schema, no new route, no auth change).

## Tasks
- [x] T1 Shared gate-summary helper + Gerbang row on Beranda + remove from Lainnya — accept: AC 1–5, Vitest green
      (reuse: `GET /api/teacher/gate` query, `TaskRow`).
- [x] T2 Fixes from the staging Chrome walk — none needed. Walk of deploy `67ae31e3` (admin, teacher, parent) passed
      #721–#724, with no console errors and no reproducible 4xx/5xx. CSP reports seen are report-only: the Vercel
      preview toolbar (`vercel.live`, preview deploys only) and one `eval` from a vendor chunk. Neither is a regression.
      Not verifiable on staging data: "Semua hadir"/"Semua pulang" (teacher has no sessions), the out-of-radius
      check-in sheet, and a non-zero approval queue. All three are covered by `e2e/attendance-geofence-gate.spec.ts`,
      which re-runs in this cycle's verify-local.

## Implementation
- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5-5; T1 sequential (single slice), T2 inline (walk report, no code).
- T1: lib/attendance/gate-summary.ts (+test), app/api/teacher/gate/route.ts, app/teacher/page.tsx, app/teacher/home-client.tsx, components/teacher/more-sheet.tsx, component tests, e2e/attendance-geofence-gate.spec.ts — shared `getGateSummary`/`getGateRoster` helper reused by the GET route; fixed Gerbang TaskRow under Kehadiran pribadi with live arrived/picked-up counts; Gerbang removed from Lainnya.

## Verification
- design-system: cross-checked Beranda row against .claude/standards/design-system.html §14 Portal Shell (TaskRow look).

## Ship Notes
- No migration, no env var, no new route.
- Post-merge (staging): Beranda shows the Gerbang row under Kehadiran pribadi with the campus count; Lainnya no longer
  lists Gerbang.
- Staging test data (2026-11-07, staging only, insert-only, ids prefixed `seede2e1107_`): 6 DCARE `ClassSession` rows
  for the teacher account (7 and 9–13 Nov) and 3 PENDING out-of-radius `AttendanceRecord` rows (Andi Hakim, Arif
  Fauzi). Cleanup after testing:
  `DELETE FROM "StudentAttendance" WHERE "sessionId" LIKE 'seede2e1107_%';`
  `DELETE FROM "AttendanceRecord" WHERE id LIKE 'seede2e1107_%';`
  `DELETE FROM "ClassSession" WHERE id LIKE 'seede2e1107_%';`
- Staging campus pins set from the Google Maps links on annisaasekolahku.com: Taman Aster `-6.2662801, 107.1046485`,
  Metland Cibitung `-6.2613131, 107.1159319` (radius 50 m).
- **Production, after the staging → main promotion of #724:** prod campuses have no pins, so the geofence is skipped
  until an admin sets the same two points (Pengaturan → Kampus → Ubah).
- Rollback: revert the merge commit.
