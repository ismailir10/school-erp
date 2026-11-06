# Cycle: Browser-tab page titles

## Context
User report: in Chrome the tab always reads "Talib — by An Nisaa' Sekolahku", whatever page or portal the user is on.
Scan confirmed it: 7 of 77 `page.tsx` set a title (the public/legal pages); every admin, teacher and parent page
fell through to the root default. 50 of those are `"use client"` pages, which cannot export `metadata`. The 404 page
had no title either. No UAT report covers this.

## Decisions
- **Server pages export `metadata`; client pages get a sibling `layout.tsx`** that does. No page is rewritten or
  split, so no behaviour changes.
- **One helper, `pageTitle()` in `lib/page-title.ts`, for every layout.** Verified in the browser: a layout with a
  plain string title drops the root `%s · Talib` template for nested routes (`/admin/students/[id]`). The helper sets
  `absolute` + `template`, so a layout titles itself and keeps the suffix flowing down.
- Titles follow `voice.md` (nav label = tab word). Detail pages are generic (`Detail Siswa`); naming the record
  would need a server fetch per page, which is a larger change and out of scope.
- Login (`/`) keeps the brand default; redirect-only pages are exempt.
- A Vitest guard (`app/__tests__/page-titles.test.ts`) fails on any untitled page, so this cannot rot again.

## Acceptance criteria
- [x] Every admin, teacher and parent page shows `<Halaman> · Talib` as its tab title.
- [x] Nested routes (detail pages) keep the ` · Talib` suffix.
- [x] The 404 page has its own title.
- [x] A test fails when a page has no title, or a layout uses a plain string title.

## Verify flows
1. Sign in as `u_super_admin`, open Siswa, Tagihan, Pengaturan > Pengguna and a student detail: each tab differs.
2. Click through the sidebar (client-side navigation): the title follows the page.
3. Repeat as `u_teacher` and the parent `u_kbaster_parent_d4`. Open a missing URL: "Halaman tidak ditemukan".

## Tasks
- [x] T1. `lib/page-title.ts` + root layout uses `TITLE_TEMPLATE`.
- [x] T2. Titles for ~65 pages (server `metadata`, client `layout.tsx`), `not-found.tsx`.
- [x] T3. Guard test + `voice.md` § Browser-tab title.

## Implementation
- Plan: single driver (Sonnet); the edit was a scripted, mechanical mapping route → title, so no fan-out.
- design-system: no visual change; document `<title>` only. Frontend gate token satisfied.

## Verification
- `npx tsc --noEmit`, `npx eslint app lib/page-title.ts`: clean. Full `npx vitest run`: 738 files passed, 9089 tests.
- Production build (`DEMO_MODE=true`) on a disposable local Postgres 16 (Docker was unavailable), Chromium via
  Playwright, demo cookies. Observed `document.title`:
  - admin: Dasbor, Siswa, Wali Murid, Kelas, Tagihan, Penerimaan, Biaya, Pendaftaran, Karyawan, Penggajian, Pengaturan,
    Pengguna, Peran & Izin, Semester, Rapor, ... all `· Talib`; 404 = "Halaman tidak ditemukan · Talib".
  - details: Detail Siswa, Detail Wali Murid, Detail Tagihan, Buku Penghubung Siswa, all with the suffix.
  - client-side sidebar navigation: Siswa, Tagihan updated correctly.
  - teacher: Beranda, Absensi Kelas, Penilaian, Buku Penghubung, Profil Saya, Slip Gaji, Kehadiran Saya.
  - parent: Beranda, Tagihan, Kehadiran, Jurnal, Perkembangan, Profil.
  - First run caught the nested-template bug (`Pemantauan Buku Penghubung` without suffix), fixed by `pageTitle()`.
- Playwright suite not run: no user flow changed (document title only). Server stopped, throwaway DB removed.

## Ship Notes
Nothing to migrate. Follow-up (not done): record-specific titles on detail pages (`Siswa: Aisyah`).
