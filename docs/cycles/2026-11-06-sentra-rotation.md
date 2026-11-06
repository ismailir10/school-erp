# Sentra sebagai data: guru sentra, putaran, dan akses Buku Penghubung

Cycle: 2026-11-06 · Branch: `claude/zen-gates-nd9c8x` · Role: cto · Approved: user, "just go for the ideal design … get it done on staging" (2026-11-06)

## Context

Feedback from Bu Ayu Rahma (Walas TK A 3, Metland Cibitung), relayed by Kak Ismail on 2026-11-06:

> Untuk pengisian penghubung online nya belum bisa mengisi untuk kelas lain … Kan kita sentra, jadi anak moving …
> pilihannya ak cma ada kelas A3. Kelas yg move: A3 A4, B3 B4 dan B5.

Metland runs a sentra model. Each guru owns a sentra, and the five moving classes (TK A 3, A 4, B 3, B 4, B 5)
rotate through the ten sentra on a two-week cycle, one sentra per class per school day:

- Week 1: Bahan Alam, Seni, Makro, Balok, Persiapan (A3 starts at Bahan Alam, A4 at Seni, B3 at Makro, B4 at Balok,
  B5 at Persiapan, each shifting one sentra a day).
- Week 2: Memasak, I Love Islam, Mikro, Imajinasi, Ibadah (same shift pattern).

Every sentra therefore hosts every moving class within the cycle, and the guru sentra fills that day's Buku Penghubung
(and Sentra Harian penilaian) for the class in her room.

Facts found in the code and the production data (read-only):
- Buku Penghubung access is "holds a TeachingAssignment on the class" (Walas or Asisten). Bu Ayu holds one, TK A 3.
  The class picker lists exactly the assigned classes, so she sees only A3. No code bug; the domain has no notion of
  a sentra.
- Sentra exists only as a fixed list in the code (Ibadah, Bahan Alam, Seni, Memasak, Main Peran, Balok, Persiapan,
  Area) used by Sentra Harian. Makro and Mikro collapse into one "Main Peran"; I Love Islam and Imajinasi have no
  sentra at all, so their guru cannot record Sentra Harian under the right name.
- Sentra Harian shows every child of an age group across the tenant; it has no idea which class is in the room today.
- Production: 11 of 17 teacher accounts have no class at all; "Nara" is a placeholder Walas on 12 classes. Data
  setup, not this cycle (see Non-goals), but it means sentra ownership is the main way most guru will get access.
- No UAT report covers Buku Penghubung or Sentra Harian within 60 days (newest relevant: 2026-09-29 full e2e).

## Decisions

1. **Sentra is per-campus data**, managed by admin: name, guru sentra (one or more), active/inactive, order. Replaces
   the fixed list as the source for Sentra Harian. The fixed list stays only to label historical entries.
2. **Existing campuses keep working on day one.** The migration creates, for each existing campus, one sentra per
   old fixed-list value (Ibadah, Bahan Alam, …) linked to it, so the Sentra Harian tiles look the same until an admin
   edits them. Admin renames/adds (Makro, Mikro, I Love Islam, Imajinasi) and deactivates what the campus doesn't use.
3. **Putaran (rotation) = a named grid per campus per tahun ajaran**: N school days (default 10) × the classes in the
   rotation, each cell one sentra, anchored on a start date. A campus may have more than one putaran (e.g. TK and KB).
4. **Day counting is calendar-aligned on Mon–Fri.** Day index = school weekdays elapsed since the start date, modulo N.
   Weekends have no sentra; a holiday does **not** shift the rotation (matches "putaran 2 pekan", where week 2 always
   follows week 1). Admin re-anchors the start date to shift it deliberately.
5. **Access follows ownership, not today.** A guru sentra may fill Buku Penghubung (entries, catatan, day mark, week
   view) for **every** class that appears anywhere in an active putaran with her sentra, on any date. Restricting to
   "today's class only" would block backfilling yesterday's book, which teachers do in the evening. Walas/Asisten
   access is unchanged.
6. **Today's sentra class is the default, not a filter.** The Buku Penghubung picker preselects the class visiting
   the guru's sentra today and labels it ("Hari ini di Sentra Balok"); every other accessible class stays one tap
   away. A guru with exactly one accessible class still skips the picker.
7. **Teacher home shows today's sentra class** alongside her own classes, tagged with the sentra name, with the same
   journal progress card. Other rotation classes are not listed on the home (noise); they live in the picker.
8. **Sentra Harian uses the campus sentra list.** Tiles = active sentra of the guru's campus, her own sentra first.
   Inside a sentra the roster defaults to the class visiting it today (when a putaran says so), with the existing age
   group view still available. New entries record the sentra; old entries keep their old label everywhere they show.
9. **Admin surface: one page "Sentra"** under Kesiswaan, next to Kelas: sentra list per campus (CRUD in a dialog) and
   the putaran list; a putaran opens a grid editor. Read needs `academic.view`, writes need `academic.edit` (same as
   Kelas).
10. **Grid validation:** every cell must name an active sentra of the same campus; the same sentra twice on one day is
    a warning shown in the grid, not a hard block (a shared room is possible). Classes in a putaran must belong to the
    putaran's campus and tahun ajaran.
11. **Production data is not written by this cycle.** After staging sign-off, the Metland sentra, guru and putaran are
    entered by the school admin through the new page (or by us on request, as a separate ops step).

## Acceptance criteria

- [ ] Admin with `academic.edit` can create, rename, reorder, deactivate a sentra of a campus and set its guru sentra
      (any active employee of that campus); `academic.view` alone sees the page read-only; other tenants' data is
      never visible (404).
- [ ] After the migration, every existing campus has sentra rows matching the old fixed list, and Sentra Harian tiles
      and historical entries look the same as before.
- [ ] Admin can create a putaran (name, tahun ajaran, kelas, start date, jumlah hari), fill its grid, and save; the
      grid shows "Pekan 1 · Senin" style day labels and flags a sentra used twice on one day.
- [ ] A guru sentra with no TeachingAssignment on a rotation class can open that class in Buku Penghubung, tick
      entries, write catatan, set a day mark, and open a child's week; a guru with neither assignment nor sentra in
      that class's putaran still gets 403.
- [ ] The Buku Penghubung picker lists assigned classes plus sentra classes, preselects today's sentra class and
      labels it with the sentra name; on a weekend or with no putaran it behaves as today.
- [ ] Teacher home shows today's sentra class with its sentra name and journal progress.
- [ ] Sentra Harian tiles come from the campus sentra list (own sentra first); opening a sentra defaults the roster
      to today's visiting class when known; saving records the sentra; monitor and parent views show the sentra name
      for new entries and the old label for old ones.
- [ ] A deactivated sentra disappears from tiles and grid choices but its history still shows its name; a putaran
      marked inactive grants no access.

## Verify flows

1. **Admin sets up Metland-style sentra** — `u_super_admin`, `/admin/sentra`: pick a campus, add "Makro", assign a
   guru, create putaran "Putaran TK" with two classes, 10 days, fill a few cells, save, reload — grid persists; using
   one sentra twice on a day shows the warning.
2. **Guru sentra fills another class's book** — `u_teacher` owns a sentra in the seeded putaran that visits a class she
   is not assigned to: `/teacher/student-journal?pick=1` shows that class labelled with today's sentra; open it, tick
   an indicator, save, reload — persisted. Teacher home shows the sentra card.
3. **Sentra Harian with the new list** — `u_teacher`, `/teacher/assessments`: own sentra tile first, open it, roster
   defaults to today's class, record one level, reload — saved; admin `/admin/assessments` shows the sentra name.
4. **Edge — weekend / no putaran:** with the date set to a Saturday, the picker shows no "hari ini" label and no
   preselection beyond the first class. **Error — outsider:** API call for a class outside both assignment and
   putaran answers 403.

## UX notes

- Admin `/admin/sentra`: campus selector first (default: first campus), then "Daftar sentra" table (Sentra, Guru
  sentra, Status, Aksi) with primary "Tambah sentra"; then "Putaran" table (Nama, Tahun ajaran, Kelas, Mulai, Hari)
  with "Buat putaran". Empty states say what to do next ("Belum ada sentra. Tambahkan sentra pertama…").
- Putaran grid: rows = days ("Pekan 1 · Senin" … ), columns = classes, cells = sentra select; sticky first column;
  duplicate sentra in a row → amber cell + one-line note. Primary action "Simpan putaran".
- Teacher picker: class option reads "TK B 4 · Sentra Balok (hari ini)" for today's; sentra-access classes are
  marked "via sentra" so a guru understands why they appear.
- Copy follows `voice.md` (Bunda/guru tone, short, Indonesian).

## Test seams

- Vitest unit: rotation day math (weekday counting, modulo, weekend/before-start → none, holiday no shift).
- Vitest API: class-access helper + journal guards (assignment, sentra-owner allowed, outsider 403, inactive putaran
  403, cross-tenant 403); admin sentra/putaran routes (permissions, validation, tenant scope); Sentra Harian POST with
  sentraId.
- e2e (Playwright, one spec `e2e/sentra.spec.ts`): flows 1–3 condensed.

## Non-goals

- Writing production data (Metland sentra, guru, putaran) — admin does it via the UI after staging sign-off.
- Cleaning up the placeholder Walas "Nara" and the 11 unassigned teacher accounts.
- Per-campus holidays or holiday-shifting rotations; parent-facing "hari ini di Sentra X" text.
- Removing the old fixed sentra list from the schema (kept for history labels).
- Attendance and other teacher surfaces gaining sentra access.

## Assumptions

- A guru sentra belongs to the same campus as her sentra (the guru picker lists that campus's employees).
- One putaran cell = one sentra per class per day (no half-day splits).
- `academic.view`/`academic.edit` are the right permissions (sentra is academic setup, like Kelas).
- Rotation start date is a weekday; if admin picks a weekend it is moved to the next Monday on save.

## Gate re-openers

- **Schema migration (additive):** five new tables (sentra, guru sentra, putaran, putaran classes, putaran cells), one nullable column on assessment entries, plus a data insert of
  the old fixed-list sentra for each existing campus. No drops, no renames.
- **Permission change:** teacher access to Buku Penghubung widens from assigned classes to assigned + sentra-rotation
  classes. Stated above; auth-impacting → `needs-staging-verify`.
- No new dependency, no PII change, no paid API.

## Tasks

- [x] T1 Schema + migration + seed — accept: `prisma migrate` applies on a fresh DB, RLS script green, seed creates
      sentra for each campus, a putaran where `u_teacher` owns a sentra visiting a class she isn't assigned to. (deps: none)
- [x] T2 `lib/sentra` domain: rotation day math, accessible-classes + can-access helper, today's sentra per guru —
      accept: unit tests for every rule in Decisions 4–6. (deps: T1)
- [x] T3 Admin API: sentra CRUD + putaran CRUD + grid save — accept: API tests for permission, validation, tenant
      scope. (deps: T2) ∥ T5, T6
- [x] T4 Admin UI `/admin/sentra` + putaran grid + nav entry — accept: flow 1 walkable. (deps: T3)
- [x] T5 Buku Penghubung access: guards use the shared helper, picker lists sentra classes with today's preselected —
      accept: guard tests + picker test; flow 2. (deps: T2) ∥ T3, T6
- [x] T6 Sentra Harian on campus sentra: tiles, roster default, POST writes sentra, readers label by sentra —
      accept: API + format tests; flow 3. (deps: T2) ∥ T3, T5
- [x] T7 Teacher home: today's sentra class card — accept: home test; flow 2 home part. (deps: T5)
- [x] T8 e2e `sentra.spec.ts` + docs (README, uat jobs, voice glossary, counts) — accept: Playwright green, audit-docs
      green. (deps: T4–T7)

## Implementation

- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5-5 (Haiku for trivial sweeps); T1 → T2 sequential (schema then
  domain helpers everything else uses); T3, T5, T6 parallel after T2 (disjoint files); T4 after T3, T7 after T5;
  T8 last. Driver reviews each diff and runs the gate before committing.
- T1: `prisma/schema.prisma`, `prisma/migrations/20261106000000_add_sentra/`, `lib/sentra/legacy.ts`, `prisma/seed.ts`,
  `lib/db.ts` (parity note) — five sentra tables + `AssessmentEntry.sentraId`, RLS + service policies, day-one insert
  of the 8 legacy sentra per campus; seed adds Makro, guru sentra (E003 Balok, E004 Seni) and a 2-day "Putaran TK"
  over TKIT A/B so `u_teacher` reaches TKIT B only via sentra. Note: `prisma migrate deploy` cannot run on an empty
  DB in this repo (no baseline migration, pre-existing), so the migration was proven on a DB built from the pre-cycle
  schema: `INSERT 0 16` (2 campuses × 8).
- T2: `lib/sentra/{rotation,access}.ts` + tests (22) — calendar-aligned Mon–Fri day index (O(1)), day labels,
  `teacherCanAccessClass` / `getStudentSentraAccess` (assignment first, then one sentra query scoped to an ACTIVE
  putaran in an ACTIVE year of the tenant with a slot of the guru's ACTIVE sentra), `getTeacherSentraToday`.
- T3: `app/api/admin/sentra/**`, `lib/validations/sentra.ts`, `app/api/__tests__/admin-sentra.test.ts` (15) — sentra
  GET/POST/PATCH (no delete), options, putaran POST/GET/PATCH/DELETE, grid PUT (replace-all in a transaction; cells
  must be an ACTIVE sentra of the putaran's campus and a class of the putaran). Tenant-scoped 404s, `academic.view`
  read / `academic.edit` write, mutations rate-limited like the class routes.
- T4: `app/admin/sentra/**`, `components/admin/sentra/**`, `config/admin-nav.ts` (+ tests) — Kesiswaan › Sentra after
  Kelas; campus select, sentra table + dialog (checkbox list of the campus's guru, Aktif/Nonaktif instead of delete),
  putaran table + create dialog; putaran detail with the day × class grid ("Pekan 1 · Senin"), duplicate-sentra and
  nonaktif-cell warnings, save disabled while a nonaktif cell remains; read-only without `academic.edit`.
  design-system.html cross-check is recorded under Verification.
- T5: `lib/student-journal/guards.ts`, journal routes (`class-grid`, `entries/batch`, `students/[id]/week`,
  `notes/unread`), new `app/api/student-journal/classes`, picker `app/teacher/student-journal/page.tsx` (+ tests;
  existing journal/attendance test mocks gained the sentra lookup). Guru-sentra access is **opt-in per caller**
  (`requireTeacherForClass(id, { viaSentra: true })`): journal routes pass it; attendance and `api/teacher/students`
  share the guard and stay assignment-only (review finding — the first cut widened them; a test pins it). Picker
  label `TK B — Program · Sentra Balok (hari ini)` / `… · via sentra`, today's sentra class preselected.
- T6: Sentra Harian routes/pages (`app/api/teacher/assessment-entries/center/**`, `app/teacher/assessments/**`),
  readers (`app/admin/assessments`, `lib/curriculum/{penilaian-monitor,perkembangan-loader}.ts`, parent pages),
  `lib/format.ts` `formatEntrySentra`, `lib/validations/assessment-entry.ts`, `lib/sentra/legacy-slug.ts` (+ tests,
  e2e selectors). Tiles = the guru's campus sentra (own first, "Hari ini: <kelas>"); route param is a sentra id, old
  enum slugs redirect; roster defaults to today's putaran class with a class/age-group switch; POST writes `sentraId`
  plus the legacy `center`; entries recorded before this cycle still load (`sentraId` null + matching `center`).
  Review fixes: sentra and class pinned to the guru's campus, ACTIVE only (admins keep tenant scope).
- T7: `app/teacher/page.tsx`, `app/teacher/home-client.tsx`, `lib/teacher/home-progress.ts` (+ 2 test files) — today's
  sentra class joins the home list with the same journal/attendance/replies/day-mark summary and a "Sentra X · hari
  ini" badge; an assigned class that is also today's sentra class is tagged, not duplicated; sentra-only cards show no
  attendance actions (attendance stays assignment-only); a failing sentra lookup leaves the home rendering.
- T8: `e2e/sentra.spec.ts` (admin setup + duplicate warning, guru sentra fills TKIT B + outsider 403, Sentra Harian
  own tile → record → admin monitor), `docs/uat/jobs/{admin,teacher}.md`, voice glossary (Sentra, Guru sentra,
  Putaran), CLAUDE.md counts via `audit-docs.sh --write`.
- Verify fix (full Playwright run 1: 274 passed, 2 failed, both from this cycle): legacy sentra tiles keep their old
  `hub-center-<slug>` test id (`teacher-assessments-weekly.spec.ts` looks for `hub-center-worship`); the picker
  trigger wraps to two lines so "TKIT B — Program · Sentra Balok (hari ini)" no longer spills past the card at
  320px (`mobile-stress.spec.ts`).

## Verification

Route: **auth-impacting** (teacher access to Buku Penghubung widens to guru-sentra classes) → verify-local now, plus a
signed-in staging check after merge (`needs-staging-verify`). Compared `origin/staging...006b5cae` (85 files: prisma
schema/migration/seed, `lib/sentra/**`, `lib/student-journal/guards.ts`, `app/api/admin/sentra/**`,
`app/api/student-journal/**`, `app/api/teacher/assessment-entries/center/**`, admin/teacher/parent pages, tests,
e2e, docs) plus one empty-state copy line after it.

- App: production build, demo auth + disposable local Postgres (local PG 16 on :54329, `db push` + seed). Staging
  check: pending (needs-staging-verify).
- Full gate on `f0040575` + fix `006b5cae`: `npm run lint` clean; `npx vitest run` **745 files, 9143 passed**;
  `verify-api-auth.sh` 232/232; `verify-rls-coverage.sh` 51/51; `DEMO_MODE=true npm run build` ok; `npx playwright
  test` run 1 **274 passed, 2 failed** (both this cycle: legacy tile test id, 320px picker overflow → fixed in
  `006b5cae`), run 2 on a fresh DB **276 passed, 0 failed (6.0m)**. `audit-docs.sh` 13 ok / 1 warn (ADR age) / 0 fail.
- Walk (Playwright script, screenshots in `docs/cycles/screenshots/2026-11-06-sentra/`):
  - Flow 1 admin, 1366px: `/admin/sentra` loads in ~1.1 s with the 8 legacy sentra per campus and an empty-state for
    putaran; Taman Aster → "Putaran TK" opens the grid ("Pekan 1 · Senin/Selasa" × TKIT A/B, seeded cells), save
    disabled until dirty; no 4xx/5xx. Duplicate warning + adding a sentra covered by `e2e/sentra.spec.ts`.
  - Flow 2 guru sentra, 390px: picker preselects "TKIT B — TK Islam Terpadu · Sentra Balok (hari ini)" for a class
    `u_teacher` is not assigned to; home lists "Jurnal harian TKIT B · Sentra Balok" with its progress and no
    attendance action for that class; tick → save → reload persists (e2e).
  - Flow 3 Sentra Harian: own "Sentra Balok" tile first with "Sentra saya", roster defaults to today's class, level
    saved and shown as "Sentra Balok" on `/admin/assessments` (e2e).
  - Flow 4: weekend branch unit-tested (`rotationDayIndex` → null); outsider class-grid call → 403 (e2e + Vitest);
    attendance stays assignment-only (Vitest pins it).
  - Console: only `/_vercel/{insights,speed-insights}/script.js` 404s, which exist on Vercel only (pre-existing).
- design-system: admin page follows the Admin List recipe (PageHeader, DataTable with Aksi column, StatusBadge,
  EmptyState, dialog forms) and teacher surfaces the portal card/list patterns from `.claude/standards/
  design-system.html`; status colours via tokens only (no raw hex in the diff).
- Copy nit fixed after the walk: putaran empty-state description no longer repeats its title (unit test + lint + tsc
  re-run green).

## Ship Notes

- **Migration** `20261106000000_add_sentra` (additive: 5 tables + `AssessmentEntry.sentraId`, RLS + service policies,
  data insert of 8 legacy sentra per existing campus). Applied automatically by `scripts/vercel-build.sh`
  (`prisma migrate deploy`) on the staging deploy, and on main at promotion.
- **No env vars, no new dependency.**
- **Post-merge staging check (signed in, real auth):** (1) admin → Kesiswaan › Sentra: each staging campus shows the 8
  legacy sentra; add one, set a guru; create a putaran with two classes and fill the grid; save → reload persists.
  (2) That guru (signed in on staging) → Buku Penghubung picker lists the other class, labelled; open and save.
  (3) Sentra Harian tiles show the campus list. (4) A non-guru-sentra teacher still sees only her own classes.
  Remove `needs-staging-verify` only after this passes.
- **Production setup after promotion** (Decision 11, not done by this cycle): admin enters Metland's 10 sentra
  (rename "Main Peran" → "Bermain Peran Makro"; add Bermain Peran Mikro, I Love Islam, Imajinasi; deactivate Area if
  unused), the five guru below, and one putaran (TK A 3, A 4, B 3, B 4, B 5; 10 days; start on a Monday of week 1).
- **Rollback:** revert the squash commit. The new tables and column are harmless if left (old `center` column is
  still written), so no down-migration is needed.

**Metland Cibitung setup data** (from Kak Ismail, 2026-11-06), for the admin to enter on staging (test) and later
production (Decision 11). Each guru owns one week-1 and one week-2 sentra; moving classes TK A 3, A 4, B 3, B 4, B 5;
putaran 10 days, week 1 starting from the schedule screenshot in Context.

| Guru (account name) | Pekan 1 | Pekan 2 |
|---|---|---|
| Bu Ayu (Ayu Rahma Yuniska) | Bahan Alam | Memasak |
| Bu Femi (Lutfi Femiliana) | Seni | I Love Islam |
| Bu Fidy (Fidyah Putri Ramadhani) | Balok | Imajinasi |
| Bu Yulia (Yulia Purbaningsih) | Bermain Peran Makro | Bermain Peran Mikro |
| Bu Elvri (Elvriani Haziza) | Persiapan | Ibadah |
