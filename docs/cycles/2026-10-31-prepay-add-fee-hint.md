# Catat pembayaran di muka: say why "Tambah biaya" is off

## Context

After [2026-10-30-prepay-other-fees](2026-10-30-prepay-other-fees.md) shipped to staging, the user tried "Catat pembayaran
di muka" and asked "admin cannot add komponen?". On staging the school has one enabled one-time fee component
(Uang Pangkal; Penyesuaian is disabled; SPP Bulanan, Uang Makan and Uang Kegiatan are monthly and belong to the SPP part).
"Tambah biaya" turns off once every one-time component is already in a line, which is correct, but it greys out with no
reason, so it reads as a bug. A school with no one-time component at all sees the same silent grey button.

## Decisions

- **D1. Say why, and where to fix it.** Under "Tambah biaya", when it is off because no one-time component is left, show a
  muted line with a link to the Biaya page (`/admin/fees`), where components are created. Two wordings: none exist at
  all, or all of them are already used. *User's choice ("yes please" to the proposed hint).*
- **D2. The 20-line limit keeps its own wording** ("Maksimal 20 biaya…") so the two reasons never read the same.
- **D3. The link opens in a new tab** so the dialog and anything typed stay put, like "Buka tagihan".

## Acceptance criteria

- [ ] With every one-time component already used in a line, "Tambah biaya" is disabled and a line under it reads
      "Semua komponen biaya sekali bayar sudah dipakai. Tambah komponen baru di halaman Biaya." with "halaman Biaya"
      linking to `/admin/fees` in a new tab.
- [ ] With no one-time component at all (after a student is picked), the line reads "Belum ada komponen biaya sekali
      bayar. Tambahkan di halaman Biaya." with the same link.
- [ ] With 20 lines, the line names the limit instead.
- [ ] While "Tambah biaya" is available, no line shows. Before a student is picked, no line shows.

## Verify flows

1. Admin → Tagihan → Catat pembayaran di muka → a student → Tanpa SPP → add lines until every one-time component is used
   → the hint appears; the link opens `/admin/fees` in a new tab; the dialog keeps its values.
2. Edge: remove a line → the hint disappears and "Tambah biaya" works again.

## UX notes

Muted helper text (same style as the section description), sentence case, voice.md. No new component; follows
design-system.html.

## Test seams

Dialog component test: all used, none at all, 20 lines, available (no hint), link target.

## Non-goals

Creating fee components from inside the dialog; changing which components are listed.

## Assumptions

1. `/admin/fees` is where an admin creates and enables fee components (it is the page that edits `isRecurring`).

## Gate re-openers

None.

## Tasks

- [x] T1 Hint under "Tambah biaya" — accept: component tests for the four states (deps: none)

## Implementation

- Plan: driver=claude-opus-5-5 (spec, review, verify, ship), workers=claude-sonnet-5-5 (T1 code + tests). One task, no
  fan-out.
- T1: `components/admin/invoices/spp-prepay-dialog.tsx` (+ test). `addLineHint` is null before a student is picked or
  while "Tambah biaya" works; otherwise `limit` (20 lines, wins), `none` (no one-time component) or `used` (all in
  lines). It renders as a `FieldDescription` under the button (`#spp-prepay-add-line-hint`, the button's
  `aria-describedby` while shown); "halaman Biaya" links to `/admin/fees` in a new tab with the "Buka tagihan" link
  styling. The old "Belum ada komponen biaya sekali bayar yang aktif." empty line no longer shows when the hint covers
  the same case. Five new component cases.
- Branch note: `claude/exciting-dijkstra-48q4x5` restarted from `origin/staging` (`a97aab83`) after #704 merged; the
  remote branch had been deleted on merge, so this is a fresh push.

## Verification

- design-system: existing `FieldDescription`, link and icon styles; copy per voice.md.
- `npx tsc --noEmit` clean; `npm run lint` exit 0; `npx vitest run components/admin/invoices app/admin/invoices` 14
  files, 262 tests passed (dialog file 39 after the empty-line change); `DEMO_MODE=true` build exit 0.
- Playwright (container Chromium, git-excluded wrapper config), production build, freshly seeded disposable Postgres:
  `admin-paid-invoice-spp-prepay.spec.ts` 3 passed.
- Browser (1440x900, demo admin): a student with no class, Tanpa SPP, Daftar Ulang + Seragam added (the seed's two
  one-time components) → "Tambah biaya" disabled, hint "Semua komponen biaya sekali bayar sudah dipakai. Tambah
  komponen baru di halaman Biaya." with a link to `/admin/fees`, `target=_blank`; removing a line hides the hint and
  re-enables the button. No console errors.
- Ship route (actual diff vs `origin/staging`): other code — one dialog, its test, this cycle doc.

## Ship Notes

- Migrations, env vars, manual steps: none. Not auth-impacting.
- Rollback: revert the squash-merge commit on `staging`.
- For the school: if an admin needs Seragam, Sarana or another one-time fee in "Catat pembayaran di muka", create or
  enable it as a one-time component on the Biaya page; on staging only Uang Pangkal is enabled today.
