# Admin list pages share one shape, one filled button per screen (UX-R4 + UX-R5)

## Context

Roadmap items **UX-R4** (admin list pages share one shape) and **UX-R5** (one primary action per screen) from
`docs/uat/reports/2026-11-14-ui-ux-audit.md`. They ship together because they change the same header buttons on
Sentra, student detail and staff attendance.

Re-verified on `staging` @ `ee955459` (after #739), code read plus a local build:

- **Stat cards mean two things.** Admissions' cards filter the list (selected card ringed). Students (Total, Aktif,
  Lulus) and Guardians (Total, Aktif, Tidak Aktif) show the same kind of count but do nothing when tapped. Admissions
  also has a "Belum bayar" toggle in its toolbar that does exactly what its "Belum bayar" card does.
- **Header buttons are hand-built.** Only the invoice list uses the header's structured primary action; about 18
  pages build their own buttons, with mixed sizes. Staff list says a bare "Tambah". Academic years puts two filled
  "Tambah" buttons in two toolbars, and its year names lead nowhere.
- **Two filled buttons on one screen.** Sentra: "Tambah sentra" and "Buat putaran" are both filled. An unplaced
  student shows "Daftarkan ke Kelas" twice (header and the attention strip). Staff attendance makes a navigation
  link ("Absensi Staf Harian") the filled button, built by nesting a button inside a link; the shared empty state
  nests the same way.
- **Already consistent, no change needed.** Every list-reachable detail page uses the same "Kembali ke Daftar …"
  back link, which replaces the breadcrumb (8 pages). The audit's "breadcrumb on some, back link on others" no longer
  reproduces; the rule just isn't written down.
- **Settings sub-pages: two shapes, two jobs.** Campuses, holidays, roles and users are collections (list + dialog);
  work hours, admission settings and WhatsApp reminders are single settings (one card, save at the bottom). That is
  the right split, so this sub-finding is dropped as a code change and written down as a rule instead.

## Decisions

1. **Stat cards filter when they count a slice (user's choice).** A card that counts a status the list can already
   filter by is a toggle: one tap filters, the card shows it is selected, a second tap (or the Total card) clears it,
   and it stays in step with the toolbar filter. Money and other KPI tiles (Piutang, Diterima bulan ini) stay
   display-only. The rule goes into `patterns.md` Recipe 1.
2. **One shared stat-filter component**, lifted from Admissions, so every list renders the selected state the same way.
3. **The toolbar "Belum bayar" toggle on Admissions goes.** The card is the filter; two controls for one filter is the
   inconsistency.
4. **Headers use the structured slots only.** One filled primary, outline secondaries (several allowed, folding into
   the `⋯` menu on phones), everything else in the menu. Navigation links become outline link-buttons, never a
   button nested in a link. "Tambah" says what it adds.
5. **Section-level actions are outline.** On Sentra both section buttons become outline; the page has no filled
   button, because neither action is the screen's one job.
6. **An unplaced student's "Daftarkan ke Kelas" lives in the header only.** The attention strip keeps the warning
   text and drops its duplicate button.
7. **Academic years:** "Tambah Tahun Ajaran" becomes the header primary; "Tambah Program" stays with its table as an
   outline button. A year's name opens that year's classes (names are doors), replacing the separate "Kelola kelas"
   link.
8. **Back navigation and settings shapes are written down, not rebuilt** (see Context).

## Acceptance criteria

- [ ] On Students, tapping "Aktif" or "Lulus" filters the list to that status in one tap, the card shows selected, the
  toolbar status filter shows the same value, and tapping it again (or "Total Siswa") shows all.
- [ ] On Guardians, "Aktif" and "Tidak Aktif" behave the same way.
- [ ] On Admissions the cards still filter, and the toolbar no longer has a separate "Belum bayar" toggle.
- [ ] On the invoice list, each count card whose status the toolbar can filter by filters the list the same way;
  money tiles stay display-only.
- [ ] Every admin list page header shows at most one filled button, and none of them nests a button inside a link.
- [ ] The staff list's add button says what it adds ("Tambah Karyawan").
- [ ] Sentra shows no filled button; both section actions still work.
- [ ] An unplaced student's page shows "Daftarkan ke Kelas" once, and the attention strip still says why.
- [ ] Staff attendance: "Harian" and "Bulanan" are outline links that open their pages; on a phone they are reachable
  from the `⋯` menu.
- [ ] Academic years: one filled "Tambah Tahun Ajaran" in the header; a year's name opens its classes.
- [ ] `patterns.md` Recipe 1 states the stat-card rule, the header-slot rule, the detail back-link rule, and the
  collection vs single-setting rule for settings pages.

## Verify flows

1. **Stat cards, `u_school_admin`, 1440.** `/admin/students` → tap "Lulus" → only graduated students, card ringed,
   toolbar says Lulus → tap "Lulus" again → all. Repeat on `/admin/guardians` with "Tidak Aktif", and on
   `/admin/admissions` with "Belum bayar". `/admin/invoices` → tap "Lewat tempo" → only overdue invoices.
   **Edge case:** a card whose count is 0 still selects and shows the empty state, not an error.
2. **One filled button, `u_school_admin`, 1440 and 390.** Walk Students, Classes, Academic years, Staff, Staff
   attendance, Sentra, an unplaced student → count filled buttons per screen (≤ 1); tap each header action once → it
   opens its dialog or page.
3. **Phone header, 390.** Staff attendance → `⋯` → "Bulanan" opens the monthly page.
4. **Error case.** Students with the list request failing (offline) → the stat cards and filter don't crash the page;
   the list shows its error state.

## UX notes

- Filter students to graduates: 2 taps (open select, pick) → **1 tap** (card). Same for guardians and invoices.
- Admissions unpaid filter: unchanged, 1 tap (card); one fewer control on the screen.
- Unplaced student → enroll: unchanged, 1 tap.
- Staff attendance → monthly on a phone: 1 tap → 2 taps (`⋯`, Bulanan). Accepted: it keeps one header row on a phone,
  and the desktop path stays 1 tap.

## Test seams

- Vitest: the stat-filter component (pressed state, toggle, clear); the page header with several secondaries
  (desktop buttons, phone menu); Students / Guardians / Admissions page tests for card ↔ toolbar sync.
- e2e: the existing students and admissions specs keep passing; add a students stat-card filter assertion.

## Non-goals

- New filters a page does not have today (a card only becomes a filter where the list can already filter by it).
- Restyling the dashboard, detail rails or HR summary tiles that are not list filters.
- Rebuilding settings pages into one layout.

## Assumptions

1. Guardians have no add action because guardians are created from a student or an admission; that stays.
2. Where a page's count card has no matching toolbar filter, the card stays display-only and is listed in
   Implementation.

## Gate re-openers

None: no schema, dependency, auth or production change.

## Tasks

- [ ] T1 Shared pieces: stat-filter component (from Admissions), page header accepts several secondaries, empty state
  uses a link-button — accept: unit tests green (deps: none)
- [ ] T2 List pages: Students, Guardians, Admissions, Invoices stat cards filter + header slots — accept: verify flow 1
  (deps: T1)
- [ ] T3 Headers and one filled button: remaining admin headers on the structured slots, Sentra, student detail,
  staff attendance, academic years — accept: verify flows 2–3 (deps: T1; parallel with T2)
- [ ] T4 Docs: `patterns.md` Recipe 1 rules, audit roadmap status — accept: `audit-docs.sh` green (deps: T2, T3)

## Implementation

## Verification

## Ship Notes
