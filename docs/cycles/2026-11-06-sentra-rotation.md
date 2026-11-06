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

- [ ] T1 Schema + migration + seed — accept: `prisma migrate` applies on a fresh DB, RLS script green, seed creates
      sentra for each campus, a putaran where `u_teacher` owns a sentra visiting a class she isn't assigned to. (deps: none)
- [ ] T2 `lib/sentra` domain: rotation day math, accessible-classes + can-access helper, today's sentra per guru —
      accept: unit tests for every rule in Decisions 4–6. (deps: T1)
- [ ] T3 Admin API: sentra CRUD + putaran CRUD + grid save — accept: API tests for permission, validation, tenant
      scope. (deps: T2) ∥ T5, T6
- [ ] T4 Admin UI `/admin/sentra` + putaran grid + nav entry — accept: flow 1 walkable. (deps: T3)
- [ ] T5 Buku Penghubung access: guards use the shared helper, picker lists sentra classes with today's preselected —
      accept: guard tests + picker test; flow 2. (deps: T2) ∥ T3, T6
- [ ] T6 Sentra Harian on campus sentra: tiles, roster default, POST writes sentra, readers label by sentra —
      accept: API + format tests; flow 3. (deps: T2) ∥ T3, T5
- [ ] T7 Teacher home: today's sentra class card — accept: home test; flow 2 home part. (deps: T5)
- [ ] T8 e2e `sentra.spec.ts` + docs (README, uat jobs, voice glossary, counts) — accept: Playwright green, audit-docs
      green. (deps: T4–T7)

## Implementation

## Verification

## Ship Notes
