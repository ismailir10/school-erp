# framer-motion 13 → 14 (2026-10-16)

## Context

Dependabot PR #647 bumps `framer-motion` from 13.0.0 to 14.0.0. Its CI was green on a staging five commits old. This is the third and last step of the branch consolidation (`2026-10-16-branch-consolidation.md`); majors go one per cycle. framer-motion is a runtime dependency: the landing page (`app/page.tsx`), the pendaftaran form and its bring-list, the attendance calendar, the journal class-day grid, admin stat cards and queue tiles, the signature pad, the `/panduan` deck, and `components/reactbits/*`.

## Decisions

- Take it. 14.0.0's only change is the removal of internal compatibility shims that 13.5.1 had restored for 13.0–13.4. We use only the public API (`motion`, `AnimatePresence`, `MotionConfig`, `useReducedMotion`, variants, `pathLength`). The 13.1–13.5 notes are size reductions and bug fixes, and `^14.0.0` resolves to 14.3.0.
- The walk-in pipeline e2e flaked once in the gate. That is a test race (below) unrelated to the bump, and it is fixed here because this is the cycle that met it.

## Acceptance criteria

- [x] `framer-motion` ^14.0.0 in `package.json`, and `motion-dom` moves with it.
- [x] Every motion surface renders and works in the e2e suite, and reduced-motion handling is still covered by its Vitest suites.
- [x] The walk-in pipeline spec no longer races the search debounce.

## Verify flows

- Landing page, `/daftar`, the pendaftaran form, the admin dashboard and lists with stat cards, parent attendance and journal, teacher daily flow, and the `/panduan` deck. All are walked by the Playwright suite.

## Tasks

- [x] **T1 — Bump and gate.**
- [x] **T2 — Deflake the walk-in pipeline e2e.**

## Implementation

- Plan: driver=claude-opus-5-5, workers=none; T1, T2 inline (why: one `npm install` and a three-line test fix whose cause was already read from the trace).
- T1: `package.json`, `package-lock.json`. No app change needed.
- T2: `e2e/admin-walkin-pipeline.spec.ts`. In test (a), the click on *Buka formulir* started the navigation, and then the list's 300 ms debounced `router.replace('/admin/admissions?search=…')` fired and took the page back to the list (the trace shows `navigated to …/admin/admissions?search=E2E+Walkin…`). The `searchList` helper now waits for `?search=` in the URL before returning the row, which covers every caller. A person would have to click within 300 ms of their last keystroke to hit this, so the product is left as is.

## Verification

### Verified locally — 2026-10-16, on top of the jsdom step (`33d280b`)
- Route: other code (runtime UI dependency) → local verify; not auth-impacting.
- Gate: `npm run lint` → exit 0; `npx tsc --noEmit -p .` → exit 0; `npx vitest run` (no `DEMO_MODE`) → "Test Files 620 passed | 2 skipped (622) · Tests 7222 passed | 42 todo"; `DEMO_MODE=true npm run build` → exit 0.
- Playwright on the disposable local Postgres 16 → "188 passed, 1 flaky (6.5m)". The flaky test is T2. After the fix, `admin-walkin-pipeline.spec.ts --repeat-each 4 --retries 0` → 16 passed, and with `enrollment-fee-payment.spec.ts` at `--repeat-each 3` → 30 passed. The wrapper config only points `executablePath` at the installed Chromium.
- Motion surfaces, each in a passing spec: landing (`branding.spec.ts`), pendaftaran form and bring-list (`enrollment-*`, `admin-walkin-pipeline`), stat cards and queue tiles (`admin*`), parent attendance and journal (`parent*.spec.ts`), teacher class-day grid (`teacher.spec.ts`), `/panduan` (`deck.spec.ts`). design-system: no visual or token change. framer-motion renders the same markup.

## Ship Notes

- Migration: none. Env: none. App code: none. Supersedes #647 and its refresh #657 (14.1.0); `^14.0.0` resolves to 14.3.0 here.
- Rollback: revert the squash commit.
