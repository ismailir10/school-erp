# Branch consolidation — dependency batch and stale-branch cleanup (2026-10-16)

## Context

The user asked for every useful piece of work on any branch to reach `main`, and for `main` and `staging` to be the only branches left. At the start (`origin/staging` = `b996347`, `origin/main` = `31663ba`, identical trees) the remote held six other branches:

| Branch | What it is | Verdict |
|---|---|---|
| `feat/intuitive-ui` | One WIP checkpoint commit (`f5a0546`, 2026-09-25) of the UI redesign, on top of `e630a23` | **Superseded.** The same cycle shipped as PR #559 (`docs/cycles/2026-09-25-intuitive-ui-foundation.md` on staging carries the finished version, including the journal race fix this checkpoint left open), then `2026-09-25-role-redesign-completion.md`. Every file it touched exists on staging except `app/admin/admissions/conversion.ts` and its test, which #650 deleted on purpose. Nothing to take. |
| `pr-assets` | Orphan branch holding PR screenshots (`scripts/pr-screenshots.sh`) | Not code. The script recreates it on the next screenshot upload. |
| `fix/dependabot-transitive-alerts` (draft PR #644) | `overrides` for four transitive advisories | **Take**, with tighter ranges (below). |
| `dependabot/…/minor-and-patch-80ede2754f` (PR #645) | 9 minor/patch bumps; `Lint, Typecheck & Test` red | **Take 8 of 9**; hold `eslint-config-next` (below). |
| `dependabot/…/jsdom-30.1.2` (PR #646) | jsdom major, CI green | Separate cycle (majors are one per cycle). |
| `dependabot/…/framer-motion-14.0.0` (PR #647) | framer-motion major, CI green | Separate cycle. |

## Decisions

- **#645's red CI is `eslint-plugin-react-hooks` 7.0.1 → 7.1.1**, pulled in by `eslint-config-next` 16.4.0 (which requires `^7.1.0`). 7.1 widens the React Compiler rules: 121 errors in 61 files (90 `set-state-in-effect`, 20 `refs`, 8 `preserve-manual-memoization`, 2 `immutability`, 1 `use-memo`). Most are the fetch-on-mount pattern (`useEffect(() => { load(); }, [load])` where `load` sets `loading` first). Fixing them changes loading behaviour on 61 screens, which is a cycle of its own, not part of a branch cleanup. So `eslint-config-next` stays at 16.3.8, `overrides` pins the plugin at 7.0.1 (dependabot's regenerated lockfile had moved it to 7.1.1 even under 16.3.8), and `.github/dependabot.yml` ignores `eslint-config-next >=16.4.0` with the reason. Lint coverage is exactly what staging has today.
- **#644's overrides use caret ranges, not `>=`.** `uuid >=11.1.1` resolved to uuid 14, which is ESM-only, under `exceljs`'s `require('uuid')`. `^11.1.1` fixes the advisory and keeps CommonJS. Same for the others: `mysql2 ^3.23.1`, `deepmerge-ts ^8.0.0`, `tmp ^0.2.6`, so a future major never slips in through an override.
- The remaining `npm audit` findings (9 high: `braces`, `micromatch`, `fast-glob` through `shadcn`/`ts-morph`, and `@next/eslint-plugin-next` through `eslint-config-next`) are dev tooling whose only fix is a breaking major. Left as #644 left them.
- jsdom 30 and framer-motion 14 each get their own PR after this one merges, per CLAUDE.md § Dependency cadence.
- Promotion to `main` happens on the user's instruction in this request, as a merge commit, once the dependency PRs are on staging.

## Acceptance criteria

- [x] Every minor/patch version from #645 except `eslint-config-next` is in `package.json`/`package-lock.json`.
- [x] The four transitive advisories from #644 (`mysql2`, `deepmerge-ts`, `tmp`, `uuid`) no longer appear in `npm audit`.
- [x] `npm run lint` passes with zero warnings; the eslint hold is explained in `dependabot.yml`.
- [x] Full gate green; the app runs on a disposable database.
- [ ] After merge: #644 and #645 closed, `feat/intuitive-ui`, `fix/dependabot-transitive-alerts` and `pr-assets` deleted.

## Verify flows

- Admin, teacher and parent home screens and the data tables (TanStack 9.2.6) load with no console errors.
- A form validated by zod 4.6 rejects bad input and accepts good input (admin create flows, `/daftar`).
- `exceljs` still loads under the uuid override (curriculum import parser).
- The full Playwright suite passes; any flake met on the way is fixed at its cause, not retried away.

## Tasks

- [x] **T1 — Bump, override, hold, gate.**
- [x] **T2 — Deflake the admissions-list reminder e2e** met during the gate.

## Implementation

- Plan: driver=claude-opus-5-5, workers=none; T1, T2 inline (why: one `npm install`, a config edit and a six-line test fix; the driver had already read every branch and the failing trace, so a worker would only re-read them).
- T1: `package.json`/`package-lock.json` — `@tanstack/react-table` ^9.2.6, `resend` 6.32.1 (lockfile), `shadcn` ^4.21.3, `zod` ^4.6.5, `@next/bundle-analyzer` ^16.4.0, `@playwright/test` ^1.63.0, `@vitejs/plugin-react` ^6.1.2, `tsx` ^4.23.15; `eslint-config-next` stays 16.3.8; `overrides` for `mysql2`, `deepmerge-ts`, `tmp`, `uuid`, `eslint-plugin-react-hooks`. `.github/dependabot.yml` ignore entry. No app code change.
- T2: `e2e/enrollment-fee-payment.spec.ts` — the *admin list* test flaked in the gate (passed on retry): `menuitem 'Ingatkan bayar (WhatsApp)'` not found after the retried open had seen it. The search box writes `?search=` after a debounce and the list refetches; the child's row is already on the unfiltered first page, so the test opened its menu before the refetch re-rendered the row and closed it. The test now waits for `?search=` in the URL and checks the item's `href` inside the retried open step. Product behaviour unchanged. Pre-existing on staging (spec from #650/#651), not caused by the bumps.

## Verification

### Verified locally — 2026-10-16, on top of `origin/staging` `b996347`
- Compared diff (`origin/staging...HEAD`): `package.json`, `package-lock.json`, `.github/dependabot.yml`, `e2e/enrollment-fee-payment.spec.ts`, `CLAUDE.md` (counts block), this cycle doc. Route: **other code** (dependency versions can change app behaviour) → local verify; not auth-impacting (no auth, session, cookie or Supabase package moved), so no signed-in staging check.
- Gate: `npm run lint` → exit 0, 0 warnings (with `eslint-plugin-react-hooks` 7.1.1 it was 121 errors, the #645 failure); `npx tsc --noEmit -p .` → exit 0; `npx vitest run` (no `DEMO_MODE`) → "Test Files 620 passed | 2 skipped (622) · Tests 7222 passed | 42 todo"; `verify-rls-coverage.sh` → 43/43, `verify-api-auth.sh` → 209/209; `audit-docs.sh` → 13 ok, 1 warn (old ADR rows), 0 fail; `DEMO_MODE=true npm run build` → exit 0.
- Playwright: `npx playwright test` on a disposable local Postgres 16 (`localhost:54329`, fresh `prisma db push` + seed) → "188 passed, 1 flaky (4.7m)". The flaky test is T2; after the fix `enrollment-fee-payment.spec.ts --repeat-each 4 --retries 0` → 24 passed. A wrapper config pointed `executablePath` at the installed Chromium (revision differs from the one `@playwright/test` 1.63 pins); nothing else changed.
- The suite's 188 tests walk the verify flows: admin, teacher and parent shells and lists (TanStack 9.2.6 DataTable, pagination, row menus), zod-validated forms (`/daftar`, lead dialog, enrollment form, invoices), payments and tenant boundaries. `exceljs` loads with uuid 11.1.1 (`require('uuid').v4()` checked; the promes-parser Vitest suite is in the green run).
- `npm audit`: `mysql2`, `deepmerge-ts`, `tmp`, `uuid` (and the `prisma`/`@prisma/config` rows they caused) gone; 9 high remain, all dev tooling with only a breaking-major fix (see Decisions).
- design-system: no UI change in this cycle.
## Ship Notes

- Migration: none. Env: none. App code: none.
- Follow-up (not in this cycle): fix the 121 React Compiler findings, then drop the `eslint-plugin-react-hooks` override and the `eslint-config-next` ignore together.
- Rollback: revert the squash commit.
