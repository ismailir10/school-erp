# Staging teacher verification and regression fixes

## Context

Verify staging after #721–#726 following a teacher report of broken workflows. Chrome reproduced a duplicate tab title between Penilaian and a Sentra detail, and between Slip Gaji and its detail. Parent Perkembangan used the same title on its list and detail. Gerbang review found that its attendance lookup included a record from another placement for a student in the Metland roster. Multiple rows could also mask a child's timestamps. On a configured demo week, Sentra rejected a TK B score for a test student enrolled in active TK A and TK B classes.

## Spec

- Use the scoped Sentra name and the salary slip's month in their detail titles. Distinguish the parent Perkembangan detail without putting a child's name in browser history. Preserve redirects, role checks and missing-record handling.
- Count Gerbang arrival and pickup once per child, using only the child's eligible class placements in the selected campus and active academic year. Include valid class-level attendance and keep pickup details paired with their timestamp.
- Validate each Sentra score against the student's active-year placements and resolve the assessment week for the indicator's age group.

## Tasks

- [x] Distinguish Sentra, Slip Gaji and Perkembangan details and cover the browser transitions.
- [x] Correct Gerbang attendance scoping and aggregation and cover duplicate-placement cases.
- [ ] Match Sentra score validation to eligible age groups and cover a dual-enrollment student.

## Implementation

- Plan: title fixes and Gerbang attendance scoping developed in parallel, with separate standards and spec review. The Sentra scoring fix followed after the live reproduction.
- T1: Sentra and salary-slip details share a request-cached record lookup with metadata. Perkembangan uses a distinct generic detail title. Added assertions to three existing Playwright flows.
- T2: Gerbang and Beranda share the exact active-placement scope and aggregate the first arrival and last pickup per child, including the corresponding pickup details.

## Verification

- Chrome on staging: verified the teacher identity, Beranda → Gerbang navigation, campus roster, search, and separate arrival/pickup modes. Both actions on the disposable E2E student changed the Beranda counts from 1/20 to 2/20 and persisted to the DCARE session.
- Chrome on staging: opened Buku Penghubung and its class selector, Penilaian, Penilaian Pekanan and Sentra Ibadah. Confirmed the detail title duplicated the Penilaian title. Current teacher had only the DCARE journal assignment, and the selected Saturday had no active curriculum week.
- Chrome on staging: Metland Gerbang incorrectly showed 1/11 arrivals and pickups. A read-only database check found one record from outside the child's active Metland placements. Both scoped counts should be 0/11.
- Chrome on staging: TK A and TK B loaded the shared theme for 6 November. Saya Senang Berkarya had zero IKTP links, which disabled scoring. The separately scoped Saya Anak Sehat themes had no configured weeks. A fully configured demo week on 4 September rendered TK B indicators and the roster.
- Chrome on staging: on the 4 September demo week, selecting a TK B indicator and saving only the disposable E2E student's score failed with `Salah satu IKTP bukan untuk kelompok siswa.` The student had two current placements, DCARE (A) and TK B 4 (B).
- Chrome on staging: verified the teacher salary-slip list and March detail loaded, with duplicate titles.
- Chrome on staging: verified that Semua hadir and Semua pulang populated the DCARE session draft. Reload discarded the unsaved bulk changes.
- design-system: this change affects the tab title and attendance data. Existing page layouts and controls were retained.

## Ship Notes

- Deploy through the staging PR. No migration or environment change required.
- Smoke-test Sentra Ibadah and the March salary slip titles, Gerbang Metland (0/11 for the existing fixture), and Beranda/Taman Aster count parity. Repeat the TK B Sentra score on the disposable dual-enrollment fixture and confirm it persists.
- Revert the staging PR to roll back.
