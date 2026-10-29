# Feedback and safe actions — every save says what happened, no one-tap wipes

## Context

Follow-up to `2026-10-29-design-tokens-v2.md`. The product owner asked for the next cycle to focus on what improves
UX, consistency and usability (not dark theme). Three read-only audits ran against `staging` 0929e41d.

Facts (looked up, not asked):
- **UAT reports** (2026-09-29 full e2e, 2026-10-06 enrollment form): 39 of ~45 findings are fixed. The remaining ones
  are feature work (user invite, pickup display), not consistency or usability.
- **Phone basics are sound:** the primitives enforce 44px on coarse pointers, inputs are `text-base` (no iOS zoom),
  and icon buttons are labelled. One exception: the Buku Penghubung week grid's admin-edit badge is a 16px `<button>`
  in a cell corner, so a mis-tap flips the cell instead.
- **Feedback is the gap.** 8 of 11 teacher and parent forms report problems only through a toast, which disappears
  in 3–5 s:
  - The journal class/date picker says "Pilih kelas/tanggal dulu ya", but nothing is marked on the page.
  - Centre assessment says "Isi kegiatan dulu", again in a toast only.
  - The session pickup-name field gets a red border with no text.
  - Failed saves in class attendance, weekly and centre assessment, journal categories and sessions are short
    toasts, even though `ui.md` says critical failures stay (`duration: Infinity`).
- **Error copy is inconsistent.** There are 276 `toast.error` calls. Network failures read two ways ("Terjadi
  kesalahan jaringan" ×9, "Koneksi terputus. Coba lagi sebentar ya." ×4). Load failures take three shapes, and a bare
  "Gagal menghapus" gives no next step.
- **One-tap wipes.** The journal class-day grid puts "Tandai semua" next to "Hapus semua". "Hapus semua" autosaves,
  has no confirm and no undo, even though `ui.md` routes every delete through `ConfirmDialog`.
- **Small drift:**
  - 7 hand-rolled empty states in the teacher and parent portals sit next to `EmptyState`.
  - 5 `toLocaleString("id-ID")` number formats bypass `lib/format.ts`, which has no number helper.
  - `components/ui/chart.tsx` calls a bare `toLocaleString()` (system locale, so server and client can render
    differently).

## Decisions

Taken on the product owner's behalf ("proceed with your best judgement").

1. **Field problems are shown at the field.** Use shadcn `FieldError` with `aria-invalid` and `aria-describedby`, and
   focus the first invalid field. A toast is never the only signal for a validation problem.
2. **Failed saves of a teacher's record persist and offer a retry.** This covers attendance, assessment, journal and
   sessions: `duration: Infinity` plus a "Coba lagi" action. Load failures and minor actions keep the short toast.
3. **One error-copy catalog.** `lib/feedback.ts` owns the generic messages (network, save, load, delete), worded per
   `voice.md`, plus the `toastError` helper. The generic literals across the app move to it. Specific,
   domain-worded messages stay where they are.
4. **Bulk destructive taps confirm through `ConfirmDialog`**, the existing standard. It is not an undo toast: one
   pattern for the whole app. The session clear-time ✕ only edits local state until "Simpan", so it stays as is.
5. **Hit areas grow invisibly.** The week-grid badge keeps its 16px look and gets a 44px pseudo-element hit area.
6. **Numbers format through `lib/format.ts`.** A new `formatNumber` replaces the scattered `toLocaleString`. The guard
   test gains a rule so this stays true.

## Acceptance criteria

- [ ] On the teacher journal page, submitting without a class or date marks the missing field inline. The message is
      announced and stays until fixed.
- [ ] Centre assessment without a kegiatan shows the error at the field. A session with an empty pickup name shows
      "Wajib diisi" under the field.
- [ ] A failed save in class attendance, weekly or centre assessment, journal categories or sessions shows an error
      that stays and has a working "Coba lagi".
- [ ] Generic network, save, load and delete toasts across the app use `lib/feedback.ts`. No duplicated generic
      literal remains.
- [ ] "Hapus semua" on the class-day grid asks first, and nothing is cleared on Batal.
- [ ] The week-grid admin-edit badge has a hit area of at least 44px and the same look.
- [ ] The 7 hand-rolled empty states use `EmptyState`.
- [ ] Number formatting goes through `formatNumber`, and the guard test fails on `toLocaleString(` outside
      `lib/format.ts`.
- [ ] `ui.md` documents the feedback pattern (field error, persistent save error, confirm bulk destructive). The full
      gate is green.

## Verify flows

1. **Teacher, phone 390.** Buku Penghubung: press the submit/next action with no class picked, and the field shows
   the error. Pick a class, and the error clears.
2. **Teacher, phone 390.** Class-day grid: tap "Hapus semua" → the dialog appears → Batal keeps the marks; confirm
   clears them.
3. **Teacher, phone 390.** Session detail: clear the pickup name and save, and "Wajib diisi" shows under the field.
4. **Error case:** block the save API (Playwright route → 500) on class attendance. A persistent error toast appears
   with "Coba lagi"; unblock, tap "Coba lagi", and the save succeeds.
5. **Edge:** parent and teacher pages with no data show `EmptyState` (seed a teacher with no students, or a filter
   with no match).

## UX notes

Copy follows `voice.md` (warm "ya", Islamic courtesy layer where it already exists). The catalog:
- **network:** "Koneksi terputus. Coba lagi sebentar ya."
- **save:** "Belum tersimpan. Coba lagi sebentar ya." (neutral: a save can fail on the server, not only the connection)
- **load:** "{X} belum bisa dimuat. Coba lagi sebentar ya."
- **delete:** "Belum terhapus. Coba lagi sebentar ya."
- **required field:** "Wajib diisi."

Final wording is checked against `voice.md` in the build.

## Test seams

- Vitest:
  - `lib/feedback.ts` (catalog and `toastError` options).
  - `formatNumber`.
  - The journal page, centre-assessment and session-client validation (inline error rendered, `aria-invalid`).
  - class-day-grid confirm (Batal keeps the marks).
  - The guard rule.
- Playwright: the existing teacher suite is the regression net. Flow 4 is walked by hand with route interception
  during verify, with no new spec (cost vs value).

## Non-goals

- Dark theme, StatCard/StatTile merge, UAT feature items (user invite, pickup display, HR permission message, photo
  compression budget).
- Rewriting the ~150 domain-specific error toasts.
- Admin forms (they already use react-hook-form + `FormMessage`).

## Assumptions

1. A persistent toast with "Coba lagi" is acceptable on phone. Sonner stacks, and the user can dismiss it.
2. "Hapus semua" is rare enough that one extra tap costs less than a wiped day.

## Gate re-openers

None: no schema, dependency, auth or PII change.

## Tasks

- [x] T1 `lib/feedback.ts` catalog + `toastError` + tests; migrate the generic literal error toasts app-wide (outside
      T2's files) — accept: tests; no duplicated generic literal. (parallel)
- [x] T2 Teacher flows: inline field errors (journal picker, centre assessment, session pickup name) and persistent
      save errors with retry (class attendance, weekly, centre, category accordion, sessions) — accept: component
      tests. (parallel; uses T1's API as specified)
- [x] T3 Safety and hit areas + empty states: `ConfirmDialog` on "Hapus semua", week-grid badge hit area, 7 empty
      states → `EmptyState` — accept: tests, screenshots. (parallel)
- [x] T4 `formatNumber` + migrate number formats + `chart.tsx`; guard rule for `toLocaleString(` — accept: tests.
      (parallel)
- [ ] T5 Docs: `ui.md` feedback pattern; `voice.md` points to the catalog — accept: audit-docs green. (after T1–T4)

## Implementation

- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5-5 (all four slices, plus the three audits that fed the spec) + claude-haiku (consistency sweep). T1–T4 run in parallel on disjoint file sets; T5 (docs) runs after them. The driver wrote `lib/feedback.ts` up front because it is the API contract T1 and T2 build against.
- T4: `formatNumber` (id-ID, a cached formatter per fraction-digit setting) in `lib/format.ts`; `formatRupiah`/`formatRupiahParts` now build on it, with identical output. The three dashboard analytics cards, `chart.tsx` (a bare `toLocaleString()` → system locale) and `fee-admin-view`/`raport/build` are migrated, with identical strings. Guard rule G fails on `.toLocaleString(` in `app/` and `components/`. The one allowlisted line is the vendored `ui/calendar.tsx` month-name formatter (a Date, not a number).
- T3: "Hapus semua" on the class-day grid goes through `ConfirmDialog` (destructive, focus on Batal, body names the count, child and date); "Tandai semua" stays one tap. The week-grid admin-edit badge keeps its 16px look with an `after:-inset-3.5` 44px hit area. The teacher home, slips and parent perkembangan empty states use `EmptyState`. `element-progress-row` keeps its one-line in-row caption, because a full `EmptyState` would bloat a progress row.
- T2: inline field errors (`FieldError` + `aria-invalid`/`aria-describedby`, focus on the first invalid field, clears once fixed) on the journal class/date picker, centre-assessment kegiatan and session pickup name ("Wajib diisi."). Centre-assessment Simpan no longer sits disabled without a reason; tapping it explains what is missing. Failed saves in class attendance, weekly and centre assessment, journal categories and sessions use `toastError`, which persists with "Coba lagi" re-sending the same payload under a stable id. Weekly re-applies the failed cell. Class attendance shows no retry on 401/403, where retrying cannot work. The centre no-match state uses `EmptyState`.
- T1: `lib/feedback.ts` (`MESSAGES` catalog, `toastError`, `toastCaughtError`; the driver wrote it as the contract) + 12 tests. About 125 generic error sites across ~65 files are migrated: saveFailed 42, network 15, generic 6, deleteFailed 1, `loadFailed(noun)` 61. Tests import `MESSAGES` rather than re-hardcoding strings. Domain-specific copy, server files and error-boundary titles are left alone. Driver change on review: `saveFailed` became neutral ("Belum tersimpan. Coba lagi sebentar ya."). A save can fail on the server, so it must not tell an admin to check the connection.

## Verification

- design-system cross-check: §Forms prescribes `.field-error` (0.75rem, destructive, under the input) with `aria-invalid` and "announced, not just colour" (design-system.html ~L314, L1614, L2941). T2's inline errors follow it. §Toast (`.toast-error`) is unchanged; T1 changes copy and duration only. The display figures in §Type (`Rp 12.450.000`) match the id-ID grouping `formatNumber` produces.

## Ship Notes
