# Cycle: Separate TK A / TK B themes

## Context
A school admin asked: "tema utk TK A dan TK B beda ya, cara membedakan utk input di webnya gmna?" Their two Program
Semester sheets (2026/2027 S1) share MPLS (Orientasi + 3× Pembiasaan, 13/7–31/7) and then diverge: different
sub-themes, different week dates, and TK B has a theme TK A lacks (Saya Anak Indonesia).

Today a semester has one theme tree for every kelompok. Only learning objectives and class sections carry TK A/TK B.
The teacher's "current week" is resolved school-wide by date, so entering both groups' themes would give overlapping
weeks, and a TK B class could be scored against a TK A theme (whichever week the database returns first). The admin
cannot do this correctly today.

Staging holds 4 themes / 6 sub-themes / 9 weeks / 36 indicator links / 4 assessment entries in one tenant.
No UAT report covers curriculum admin.

## Decisions
- **A theme gets an optional kelompok: TK A, TK B, or Semua (shared).** User choice. Shared fits MPLS and keeps every
  existing theme valid with no data surgery. The alternative (required, copy into both groups) needed copying links
  and assessment entries.
- Theme names must be unique within a semester **per kelompok** (Semua counts as its own scope), so "Saya dan
  Lingkungan" can exist for both TK A and TK B.
- A class only sees themes for its own kelompok plus shared ones. Week dates must not overlap within what one
  kelompok sees (TK A + Semua, TK B + Semua). TK A and TK B weeks may share dates.
- Indicators can only be linked to themes their kelompok can see. A TK A indicator never links to a TK B theme.
- Changing a theme's kelompok is blocked when it would break existing data: assessment entries from the other group on
  its weeks, links to the other group's indicators, or a resulting week overlap.

## Acceptance criteria
- [ ] Admin can set a theme's kelompok (TK A / TK B / Semua) on create and edit. Existing themes show as Semua.
- [ ] The theme page filters by kelompok, and each theme card shows a badge for its kelompok.
- [ ] Two themes with the same name can exist in one semester when their kelompok differ. A same-scope duplicate is
      rejected with a clear message.
- [ ] Adding a week whose dates overlap another week visible to the same kelompok is rejected with a clear message.
      TK A and TK B weeks on the same dates are accepted.
- [ ] On the same date, a TK A homeroom teacher sees the TK A theme/week and a TK B teacher sees the TK B one. Both
      see a shared theme (MPLS).
- [ ] Sentra (center) entry and the penilaian monitor resolve the week per student's/class's kelompok.
- [ ] Linking an indicator (manually or via PROMES import) to a theme outside its kelompok is rejected or reported as
      unmatched. It is never linked silently.
- [ ] Changing a theme's kelompok that would break existing entries, links or week overlap is refused with an
      explanation.

## Verify flows
1. **Admin, separate trees.** Sign in as `u_school_admin` → Semester → Tema. Create "Saya dan Lingkungan" as TK A and
   again as TK B, then add a week 3–7/8 under each. Both are saved, and the TK A / TK B filters show one each.
2. **Teacher sees own group.** As `u_teacher` (TK A homeroom) open weekly assessment in that week → TK A theme. Switch
   the seeded homeroom to TK B (or use a TK B teacher) → TK B theme.
3. **Edge, shared.** MPLS stays Semua. Both groups see it in July.
4. **Error.** Add a TK A week overlapping a shared MPLS week → rejected with the overlap message.

## UX notes
- Theme form: new "Kelompok" select (Semua kelompok / TK A / TK B), default Semua. Helper text: "Pilih TK A atau TK B
  bila tema hanya untuk satu kelompok."
- Theme list: segmented filter "Semua · TK A · TK B" above the cards. A TK A view lists TK A + shared themes, and so
  does TK B. Badge on each card.
- Errors use voice.md tone, e.g. "Pekan ini bertumpang tindih dengan pekan lain di kelompok TK A."

## Test seams
- Vitest: week resolver by kelompok; overlap check per kelompok scope; theme create/update API (scope uniqueness,
  kelompok change guard); indicator-theme link and PROMES import scope rule.
- e2e: extend the existing curriculum/teacher spec so TK A and TK B teachers see different themes for one date.

## Non-goals
- Per-campus or per-class themes (kelompok only).
- Bulk "copy TK A tree to TK B" action.
- Reworking the objectives page (already filtered by kelompok).

## Assumptions
1. TK A/TK B is the existing kelompok (`A`/`B`); no new level concept such as KB.
2. The school will re-scope its own themes after release. No production data is changed by this cycle.
3. Name uniqueness treats Semua as its own scope, so a shared "MPLS" and a TK A "MPLS" may coexist (the admin's call).

## Gate re-openers
- **Schema migration (additive):** nullable `ageGroup` on Theme, plus a replacement for the theme-name unique index
  (null-safe). No backfill; existing rows become shared.

## Tasks
- [ ] T1 Schema + migration: nullable kelompok on Theme, per-scope unique name — accept: migrate on fresh DB, seed passes (deps: —)
- [ ] T2 Validation + theme API: kelompok on create/update, scope-unique name, kelompok-change guard — accept: Vitest (deps: T1)
- [ ] T3 Week resolver + overlap per kelompok; teacher weekly, sentra, penilaian monitor pass class kelompok — accept: Vitest (deps: T1)
- [ ] T4 Indicator-theme links + PROMES import respect kelompok — accept: Vitest (deps: T1) — parallel with T3
- [ ] T5 Admin theme page: Kelompok select, filter, badge — accept: local browser walk (deps: T2)
- [ ] T6 README + docs/uat/jobs/admin.md + e2e — accept: Playwright local (deps: T3–T5)

## Implementation
- **Plan:** driver claude-opus-5-5 (reasoning tier) does T1 (schema, migration, shared `lib/curriculum/age-scope.ts`), review and sign-off. T2+T4, T3 and T5 are delegated to claude-sonnet-5-5 subagents (dirty-work tier) in parallel. Doc/fixture sweeps go to claude-haiku-5-5.
- **T1:** `Theme.ageGroup AgeGroup?`; migration `20261106000000_theme_age_group` adds the column and replaces the name unique index with `(tenantId, semesterId, ageGroup, name) NULLS NOT DISTINCT` (staging is Postgres 17). Tested on a disposable DB: old schema pushed, migration applied, `prisma migrate diff` against the new schema is empty. Seed passes.

## Verification

## Ship Notes
