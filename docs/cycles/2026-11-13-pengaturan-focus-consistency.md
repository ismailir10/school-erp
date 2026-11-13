# Pengaturan polish and one focus indicator everywhere

## Context

PR #737 (`64ee3e22`) gave the shared primitives a solid 2 px `focus-outline` and aligned portal surfaces, but it left feature code alone. A read-only sweep of staging `64ee3e22` found 109 hand-rolled focus rings (`focus-visible:ring-2 …`) in 24 files outside `components/ui`. Two primitives, `resizable` and `navigation-menu`, were also missed. Keyboard users therefore still see two different indicators, and nothing stops new code from adding a third.

An audit of admin **Pengaturan** found these problems:
- The hub link carries the old ring.
- The hub groups badly. "Sekolah" holds 6 items and "Akademik" holds 2. Three items share the `CalendarDays` icon and two share `Coins`, so scanning by icon fails.
- Every settings route shows the dashboard skeleton, with its stat-tile row, although no settings page has stats. The page jumps when it loads.
- Jam Kerja, Pengaturan Pendaftaran and Templat Pengingat WhatsApp return a bare skeleton while loading, so the page title flashes away.
- Kampus and Hari Libur ignore load failures and show "Belum ada …", which is false. Their deactivate and reactivate calls are raw `fetch` with no `try`/`catch`, so a network drop fails silently.

No UAT report covers admin settings.

## Decisions

- **One focus indicator.** Replace each hand-rolled ring with `focus-visible:focus-outline`. Where a ring was inset (clipped cells), keep the inset with the utility's `--focus-outline-offset` variable rather than a second style. A Vitest guard scans `app/` and `components/` and fails on `focus-visible:ring-` / `focus:ring-` in feature code, so the drift cannot return.
- **Regroup the hub.** The groups become Sekolah (Kampus, Hari Libur, Jam Kerja, Pengaturan Pendaftaran), Akademik (Tahun Ajaran, Semester, Bank Narasi, Templat Buku Penghubung), Keuangan & Gaji, and Akses. Every item gets a distinct icon. Routes and permissions do not change.
- **Skeletons match the page.** The hub gets a 2-column card grid and form pages get a header plus one card. The header stays rendered while data loads.
- **Load failure is not emptiness.** Settings lists show a retryable error, not the empty state. Mutations use `sendJson` and toast on failure.
- **Out of scope:** the about 900 `text-sm`/`text-xs` sites and the token typography migration (judgement-heavy, own cycle). Changing the confirm on user activation is also out, because activation grants login access and the confirm stays.

## Acceptance criteria

1. `rg 'focus-visible:ring-|focus:ring-' app components` returns nothing outside the guard's documented allowlist. The guard test fails if one is added.
2. The Pengaturan hub shows four groups of balanced size, and no two items share an icon.
3. `/admin/settings` and each settings subpage render a skeleton that matches their own layout, with no stat-tile row.
4. On Jam Kerja, Pengaturan Pendaftaran and Pengingat WhatsApp, the page header is visible while loading.
5. When their API fails, Kampus and Hari Libur show an error with "Coba lagi", not "Belum ada …".
6. A failed deactivate or reactivate on Kampus, Hari Libur, Pengguna or Peran shows an error toast instead of an unhandled rejection.

## Verify flows

- As `u_super_admin`, open Pengaturan at 1440 and 390 px and Tab through the hub. Every link shows the solid outline.
- Open each settings subpage and watch it load.
- Keyboard-traverse a student dossier block toggle and the teacher assessment grid, and confirm the outline is visible and not clipped.

## UX notes

The main task is reaching a setting: 2 taps (Pengaturan → item), unchanged. Regrouping changes where an item sits, not how many taps it takes.

## Tasks

- [x] Focus: codemod hand-rolled rings to `focus-outline` in feature code and the two primitives, and add the guard test.
- [x] Pengaturan: regroup the hub and give it distinct icons, layout-shaped skeletons and a persistent header, plus load-error states and safe mutations.
- [x] Verify: run the full gate, sign in to the local demo, take before/after shots, and record the result.

## Implementation

- Plan: driver=claude-opus-5-5 (spec, review, verification), workers=claude-sonnet-5 for the two read-only audits, the focus codemod and the Pengaturan slice. The two build slices own disjoint files and ran in parallel.
- Focus: 23 feature files plus `resizable` and `navigation-menu` now use `focus-visible:focus-outline`, the utility documented in `design-system.html` and `ui.md`. Inset cells use `[--focus-outline-offset:-2px]` and the landing page keeps its `--primary-text` tint through `[--focus-outline-color:…]`. `lib/__tests__/focus-indicator-guard.test.ts` fails on any new `focus*:ring-` in `app/` or `components/`. Its allowlist is empty.
- Pengaturan: the hub now groups Sekolah 4, Akademik 4, Keuangan & Gaji 3 and Akses 2, with a distinct icon per item. `config/__tests__/admin-nav.test.ts` locks icon uniqueness.
- Skeletons follow page shape. The hub is a card grid, list pages show a toolbar and rows, and form pages show one card. Sentra gains the `loading.tsx` it lacked.
- Jam Kerja, Pendaftaran and Pengingat WhatsApp keep their `PageHeader` while loading. They use `ErrorState` with "Coba lagi" on failure and `EmptyState` when access is missing.
- Kampus and Hari Libur check `res.ok` and show `ErrorState` with a retry instead of a false "Belum ada …".
- Mutations on Kampus, Hari Libur, Pengguna and Peran go through `sendJson` in `try`/`catch`. Delete rejections keep `ConfirmDialog` open for a retry, which it already supports.

## Verification

### Verified locally at `a050c52f` on 2026-11-13

- **App:** `DEMO_MODE=true` production webpack build, run against a disposable local PostgreSQL 16 that was freshly pushed and seeded. The baseline was staging `64ee3e22`, built separately. Default Turbopack fails to resolve symlinked `node_modules` in a scratch worktree, so both builds used webpack.
- **References:** I checked against `design-system.html` / `ui.md` (the focus-outline utility), `patterns.md` (skeletons, Don't make me think) and `voice.md` (error copy).
- **AC1:** `rg 'focus-visible:ring-|focus:ring-' app components` finds nothing, and the guard runs as part of Vitest. In the browser, the Pengaturan hub link computes `outline: solid 2px` when focused.
- **AC2:** The before/after shot is [hub at 1440 px](screenshots/2026-11-13-pengaturan/hub-1440-before-after.png), with before on the left. Before, the cards held 6/2/3/2 items, leaving a half-empty Akademik card and three identical calendar icons. After, they hold 4/4/3/2 with distinct icons. `admin-nav.test.ts` asserts that the icons are unique.
- **AC3–4:** Covered by the rewritten `loading.tsx` files and a work-hours test asserting that the header is visible both while loading and after a failure. At 390 px, Jam Kerja renders with its header, breadcrumb and form.
- **AC5:** In Chromium I forced `/api/config/campuses` to return 500. The page showed the "Daftar kampus belum bisa dimuat" heading and a "Coba lagi" button, and zero "Belum ada …" text. After un-routing, "Coba lagi" loaded both campus rows. Vitest covers the same behaviour for campuses and holidays.
- **AC6:** Covered by Vitest. The mutations go through `sendJson` in `try`/`catch`, and `ConfirmDialog` stays open when a delete rejects.
- **Full gate:**
  - lint passed.
  - `tsc --noEmit` passed.
  - RLS coverage 51/51 and API auth 239/239 passed.
  - `audit-docs.sh` reports 0 fail after `--write`.
  - Vitest passed 766 files and 9,394 tests, with 2 skipped files and 42 todos.
- **Playwright:** `npx playwright test` passed **296/296 in 7.3 min** on a fresh DB.
  - The project pins a newer Playwright than this container's browser, so the run used an untracked config override that points `executablePath` at the preinstalled Chromium.
  - The first attempt reused a stale `next-server` from before the rebuild and failed with chunk mismatches. After killing it, the clean run passed.

## Ship Notes

Frontend only, with no schema, API or env change. The changes affect focus styling, the order and icons of the settings hub, skeletons, and error handling in the settings pages. On staging, Tab through Pengaturan and open Kampus. Roll back by reverting the squash commit. Not auth-impacting, so no `needs-staging-verify` label.
