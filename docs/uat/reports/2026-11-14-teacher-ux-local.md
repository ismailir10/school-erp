# UAT Report — Teacher portal — 2026-11-14

> Persona: Bu Sari (seeded `u_teacher`, Guru Tiga, Walas TKIT A and guru Sentra Balok)
> Six core jobs and supplemental route coverage. Three major findings, one minor, no unplanned blockers on the scheduled fixture.
> Local production build at cached `origin/staging` `a0afa580`. Disposable synthetic Postgres, Android-like Chromium touch viewports 390×844 and 320×740, desktop 1440×900. No staging verification in this report.

## Summary

The attendance, gate and class roster saves worked with a scheduled session and were preserved on reload. On the seeded Saturday, Beranda still called ordinary classroom roll "Kelas hari ini" and Gerbang offered fully actionable rows for children with no session. Two same-name rows illustrated how a teacher can tap a plausible row and learn the difference only through a transient error. The teacher's own off-site attendance reached and cleared the admin queue, but the teacher's refreshed page communicated the decision only by removing a badge. Journal autosave reverted an interrupted tap and retried successfully, with discoverability and state feedback gaps on narrow phones.

## Findings

### JTBD-TEACHER-HOME-02, ATT-01 and SESSION-03 — One school-day roll is presented as three different tasks

- **Completed:** yes (class exceptions, bulk remaining, session bulk arrival and pickup). **Severity:** major.
- As Bu Sari, the main button says `Lanjutkan absensi · 0/19`. The next section repeats `Absensi TKIT A`. `Gerbang` is above both, and `Sesi & penjemputan` is farther down (its TKIT A link y=1,160 on a 320×740 viewport). The visible copy says session stamps are saved separately, but a Gate arrival appears in the same session row and a roll write for a single session goes into that row. The screens implement different save models: Gate and Absensi save on tap, while the roster holds drafts and requires `Simpan absensi`. On the no-session Saturday, the two primary buttons still asked me to continue the day's unscheduled attendance/journal.
- As Bu Sari, on the session roster I see green `Hadir` pills before any arrival is recorded. Its downward chevron looks like a menu, but a tap cycles Hadir → Sakit → Izin → Alpa. At 320 px `Ahmad Hafsah Hidayat` visually clips to `Ahmad Hafsah Hiday…`; a nearby row is `Ahmad Zafran Hidayat`. Class attendance shows four labeled accessible radio choices, while the visual H/S/I/A abbreviations rely on a separate count line for interpretation.
- **Evidence:** `home-390.txt`, `home-approved-320.txt`, `home-settled-1440.txt`, [04-session-320.png](assets/2026-11-14-teacher-ux-local/04-session-320.png), `flows.log`, `followup.log`. The independently loaded Friday journal showed `12/19 siswa lengkap`, no horizontal scroll, confirming a distinct day from the weekend.
- **Suggested cycle:** Make a single clearly prioritized classroom workflow by day and class, with explicit distinction between roll status and the arrivals/pickups it can record, consistent persistence cues, named status choices, and full identity at 320 px. Keep the campus-wide gate shortcut.

### JTBD-TEACHER-GATE-01 — Gerbang waits until after the tap to reveal an unavailable row

- **Completed:** yes on synthetic scheduled TKIT A fixture. The no-session variant failed to record as expected by calendar rules. **Severity:** major (availability signal and next step).
- As Bu Sari, Gerbang promises `cukup satu ketukan`. The natural Saturday roster shows 85 count and active-looking rows. With a search for Abdul Zahra Mahendra, two different children with the exact same display name appeared under `POPUP Weekend` and `TKIT A`. In the natural Saturday state, tapping TKIT A returned `Belum ada sesi kelas hari ini`. In the test with a TKIT A session only, the identical-name POPUP row still accepted the tap and returned the same toast, while the TKIT A row recorded correctly. The failure does not disable the row or provide a persistent explanation or next step. At 320 px, each row is 56 px tall and fits horizontally; class names correctly distinguish these two seed identities once the teacher knows which class to look for.
- **Evidence:** [02-gate-no-session.png](assets/2026-11-14-teacher-ux-local/02-gate-no-session.png), `gate-dual-placements-before.txt`, `gate-pickup-320.txt`, `followup.log`. Session showed both stamped times and `Orang tua` after Gate.
- **Suggestion:** Show date and schedule context before tapping. Surface only actionable placements first, distinguish identical names, and explain unavailable rows in place.

### JTBD-TEACHER-HOME-03 — Teacher's approval result is communicated by subtraction

- **Completed:** yes across teacher submit, admin approve and fresh teacher navigation. **Severity:** major.
- As Bu Sari, I saw why the check-in required review and could not submit an empty or two-character reason. After submission, the same block said `sudah tercatat`, `Menunggu persetujuan`, `Kehadiran tersimpan`, `Lokasi tercatat`, and offered `Catat pulang`. After admin approved, the pending badge disappeared on a fresh Home visit. The screen still read `Masuk 08.43 · Terlambat 103 menit · sudah tercatat` and `Catat pulang`. It never explicitly said the admin approved the exception. Existing tab freshness was not observed. `home-client.tsx` refreshes after its own write and supplies no focus, polling, or subscription refresh for decisions made elsewhere.
- **Evidence:** `gps-outside.txt`, `gps-pending.txt`, `home-approved-320.txt`, `preflight.log`, `followup.log`. The teacher screenshot caught dialog exit animation, so use the text snapshots for exact state.
- **Suggestion:** Present one decision state with time, reason or actor where appropriate, and a deliberate refresh policy. Align teacher wording with the admin queue state.

### JTBD-TEACHER-JOURNAL-01 — Journal checklist gives narrow-screen users little cue to the indicator action

- **Completed:** yes (individual indicator, simulated connection loss, retry, reload). **Severity:** minor in isolation. Candidate for the broader teacher-to-parent journal cycle.
- As Bu Sari, the 320×740 roster started at y=451 below heading, date, change-context control, bulk action, no-book action and save-status space. On each row a downward chevron expands today's indicators, a message icon opens an add-note composer, and a right chevron opens the week. The icon-only buttons have descriptive accessible names, but those names are not visible. On expanding the second student, the first indicator was below the viewport, forcing a further scroll. Indicator rows are buttons with state represented by color and a checkmark and do not expose `aria-pressed` or checked semantics. The failure reverted the initial check and showed `Coba simpan lagi`; tapping it settled to `Jurnal tersimpan`. Reopening the same student after reload preserved the state. The class/day title and named Home guardian reply links both carried the expected scope.
- **Evidence:** [05-journal-indicator-mobile.png](assets/2026-11-14-teacher-ux-local/05-journal-indicator-mobile.png), `journal-320-indicators.txt`, `guardian-reply-320.txt`, `flows.log`, `survey.log`.

## Performance

Samples are localhost browser timings. A click-to-visible number covers Playwright's click through the target state appearing. Shared machine load varied, and no production performance claim follows.

| Action | Metric | Measured | Budget | Verdict |
|---|---|---:|---:|---|
| Initial Home | Page full load | 252 ms | <1,500 ms | Fine |
| Home primary to class roster | Click to visible | 1,213 ms | <1,500 ms | Fine |
| Class roster load | API response | 14 ms | <500 ms | Fine |
| Attendance failed exception to local retry | Click to visible | 61 ms | <800 ms | Fine |
| Attendance retry saves | Click to confirmation | 110 ms | <800 ms | Fine |
| Attendance bulk remaining | Click to completed | 745 ms | <800 ms | Fine |
| Outside GPS to note sheet | Click to visible | 95 ms | <2,000 ms | Fine |
| Outside GPS note to pending | Click to visible | 416 ms | <2,000 ms | Fine |
| Gerbang list | Click to visible | 516–1,085 ms | <1,500 ms | Fine |
| Gate arrival / pickup | Click to toast | 164 / 89 ms | <1,000 ms | Fine |
| Session bulk arrival / pickup | Click to draft | 48 / 57 ms | <300 ms | Fine |
| Session arrival / pickup save | Click to confirmation | 75 / 65 ms | <1,500 ms | Fine |
| Home journal to roster | Click to visible | 898 ms | <1,500 ms | Fine |
| Journal Friday picker to roster | Click to visible | 106 ms | <1,500 ms | Fine |
| Journal retry | Click to confirmation | 912 ms | <2,000 ms | Fine |

## Supplemental route coverage

At 320 px, navigated assessment hub and Balok, weekly assessment with the Saturday date recovery and the successful Friday themed roster, `Lainnya`, own attendance, Cuti dan izin, salary slip list and detail, profile, changelog and guide. Used teacher Home to open a guardian reply and verified the Orang Tua label. The October salary slip lists gross, deductions and take-home pay, but the take-home amount is below the first 320×740 viewport. The PDF link returned HTTP 200 with application/pdf. Its rendered pages were not inspected. Supplemental coverage is screen and interaction sampling, with no assessment submission, leave request or live login.

Raw text and timing evidence: [local evidence](assets/2026-11-14-teacher-ux-local/evidence.txt).

## Heuristic disclaimer

This is synthetic UAT. An LLM persona cannot replicate thumb reach, sunlight
glare, emotional distrust, or network conditions on a 4-year-old phone in
Bekasi traffic. Treat findings as a cheap first pass, not a substitute for
putting the app in front of a real teacher or parent.
