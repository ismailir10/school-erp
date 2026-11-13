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
- [ ] Pengaturan: regroup the hub and give it distinct icons, layout-shaped skeletons and a persistent header, plus load-error states and safe mutations.
- [ ] Verify: run the full gate, sign in to the local demo, take before/after shots, and record the result.

## Implementation

- Plan: driver=claude-opus-5-5 (spec, review, verification), workers=claude-sonnet-5 for the two read-only audits, the focus codemod and the Pengaturan slice. The two build slices own disjoint files and ran in parallel.
- Focus: 23 feature files plus `resizable` and `navigation-menu` now use `focus-visible:focus-outline`, the utility documented in `design-system.html` and `ui.md`. Inset cells use `[--focus-outline-offset:-2px]` and the landing page keeps its `--primary-text` tint through `[--focus-outline-color:…]`. `lib/__tests__/focus-indicator-guard.test.ts` fails on any new `focus*:ring-` in `app/` or `components/`. Its allowlist is empty.

## Verification

## Ship Notes
