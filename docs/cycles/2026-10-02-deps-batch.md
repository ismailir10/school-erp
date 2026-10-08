# Dependency drain: batched minors and patches (Oct 2026)

## Context

24 dependabot PRs were open against `staging`, the oldest from 2026-08-27. Branch protection requires an up-to-date head, so merging them one by one would re-stale every other PR (CLAUDE.md § Dependency cadence). The user asked to drain them after the 2026-10-01 promotion (#597).

Per the cadence rule:
- all minor and patch bumps go in **one** branch with one gate;
- majors get a cycle each.

The only major is **Vitest 5**: #527, a prepared migration that also moves CI to Node 24, plus its coverage-only twin #588. It ships as its own cycle after this one.

## Spec

- [x] One branch moves every non-major dependabot target to at least its proposed version.
  - Direct dependencies:
    - `next` 16.3.0 → 16.3.6 (#549) and `react` 19.2.8 → 19.3.0, both kept exact-pinned, with `react-dom` ^19.3.0 and `@types/react{,-dom}` 19.3.0 (#551)
    - `eslint-config-next` 16.3.6 (#593), exact
    - `@next/bundle-analyzer` ^16.3.6 (#592)
    - `@react-pdf/renderer` ^4.9.0 (#595)
    - `@tanstack/react-table` ^9.2.4 (#589)
    - `sonner` ^2.0.8 (#590)
    - `@testing-library/user-event` ^14.6.7 (#591)
    - `@types/node` ^26.6.3 (#594)
    - `vitest` ^4.1.11 (#547), with `@vitest/coverage-v8` ^4.1.11 because it peers vitest at an exact version
  - Lockfile-only: ip-address (#571), undici (#570), js-yaml (#550), sharp (#548), baseline-browser-mapping (#546), hono (#545), browserslist (#542), fflate (#540), @humanfs/node (#539), qs (#538), fast-uri (#535), postcss-selector-parser (#534).
- [x] The lockfile stays at v3 and installs cleanly with CI's `npm ci` (npm 10).
- [x] The end-of-cycle gate is green: build, vitest, typecheck, lint, and Playwright.
- [ ] After merge, the superseded dependabot PRs are closed with a pointer to this PR.

Non-goals:
- Vitest 5 and Node 24 (#527 and #588) ship in their own cycle.
- No application code changes. If a bump needs a code change, it leaves this batch.

Assumptions:
1. React 19.3.0 is a minor release and is batched (#551's stale `needs-preview-verify` label predates the staging-only Vercel setup).
2. Ranges are only tightened where dependabot proposed it. Transitive packages may resolve above dependabot's target when the range allows, for example sharp 0.35.5 and hono 4.13.12.

## Tasks

- [x] **Task 1 — apply all minor and patch bumps.** Change `package.json` and `package-lock.json`. Accept: every target is met; `npm ci` with npm 10 exits 0; build, vitest, tsc and lint are green.

## Implementation

- Subagent plan: driver=claude-opus-5-5, dirty-work=Sonnet (independent verifier); no fan-out for the edit itself. This is one mechanical task: a few `npm` commands plus a version check. A subagent would need the whole version table as context, and the fan-out exception applies.
- Task 1: `package.json`, `package-lock.json`.
  - Problem: npm 10.9.7 (the local npm) crashed in `buildIdealTree` → `#loadPeerSet` with `Cannot read properties of null (reading 'edgesOut')` on the vitest → jsdom → `canvas` optional-peer chain. It crashed on every attempt, even after removing the stale vitest lock entries.
  - Fix: the lockfile was resolved with `npx npm@11 install` / `npm@11 update`.
  - It stays `lockfileVersion: 3`, and a clean **npm 10 `npm ci` succeeds** on it, which is the path CI uses.
  - Final versions: vitest 4.1.11, coverage-v8 4.1.11, @types/node 26.6.4, bundle-analyzer 16.3.8, user-event 14.6.7, eslint-config-next 16.3.6, sonner 2.0.8, next 16.3.6, react/react-dom 19.3.0, @types/react{,-dom} 19.3.0, @react-pdf/renderer 4.9.0, @tanstack/react-table 9.2.4. Every transitive package was checked at or above its dependabot target.
- Independent verification (Sonnet subagent, prompted by the Codex P1 review on #598), from a fresh clone of `516f82a`, all PASS:
  1. The branch sits directly on `staging` `68d6865`.
  2. The diff touches only `package.json`, `package-lock.json`, the `CLAUDE.md` counts line, and this doc.
  3. All 12 `package.json` values match the Spec, and nothing else changed.
  4. Lockfile v3; all 14 transitive floors are met.
  5. npm 10.9.7 `npm ci` exits 0, with vitest 4.1.11, next 16.3.6 and react 19.3.0.

  One expected transitive downgrade: `hyphen` 1.14.1 → 1.6.6. `@react-pdf/renderer` 4.9's `@react-pdf/hyphenate` 0.1.0 pins `hyphen ~1.6.4`. It is not a major drop, and PDFs render (see Verification).

## Verification

- Task 1 gate, all local, on a disposable Postgres (`postgresql://ci:ci@localhost:5432/schoolerp`):
  - `npm ci` (npm 10.9.7, Node 22): exit 0.
  - `DEMO_MODE=true npm run build`: exit 0.
  - `npx tsc --noEmit`: exit 0.
  - `npm run lint`: 0 errors and 55 warnings, the same count as `staging` before this change.
  - `npx vitest run`: exit 0, `Test Files 478 passed | 2 skipped (480)`, `Tests 4399 passed | 42 todo (4441)`.
- Playwright (local, end-of-cycle): `npx playwright test -c playwright.local.config.ts`, a git-excluded override that only sets `executablePath: /opt/pw-browsers/chromium` (this container ships Chromium 1194). It ran against a `DEMO_MODE=true` production build of `af712b6` on a freshly seeded disposable Postgres: **`163 passed, 1 skipped (3.4m)`, exit 0**.
- Ship verification, route = **auth-impacting (uncertain), pre-merge local half**, source SHA `af712b6`.
  - Changed paths: `package.json`, `package-lock.json`, `CLAUDE.md` (generated counts), and this doc.
  - On a local `next start` (Next 16.3.6, `DEMO_MODE` scoped to the server process) with the disposable DB:
    - The **auth guard under the new runtime** behaves correctly: anonymous `/admin` returns **307** to `/`; anonymous `GET /api/employees` returns **401** JSON; `/admin` with the SUPER_ADMIN fixture cookie returns **200**.
    - **react-pdf 4.9 renders:**
      - `GET /api/slips/<payrollItemId>/pdf` as SUPER_ADMIN returns **200 `application/pdf`**, a valid `%PDF-1.3` with producer `react-pdf`.
      - `GET /api/guardian/invoices/<PAID invoice>/pdf` as guardian `u_rightjet` returns **200 `application/pdf`**, `%PDF-1.3`.
      - The first attempt used an unpaid invoice and got the route's deliberate paid-only **404**, which is correct behaviour.
    - The report-card PDF is covered by `e2e/parent-raport.spec.ts` in the passing suite.
  - Findings: blockers 0, minors 0.
  - The **signed-in half** (real Google OAuth and Supabase session cookies) cannot run here. It is left to the post-merge staging check in Ship Notes, and the PR carries `needs-staging-verify` until then.

## Ship Notes

- **Migrations:** none. **Env vars:** none. **Code changes:** none (manifest and lockfile only).
- **Verification route:** **auth-impacting (uncertain).** `next` 16.3.0 → 16.3.6 changes the runtime that runs `proxy.ts`, the auth guard, and the Supabase SSR session cookies on every request. Before merge it gets local demo-auth verification. The PR is labelled `needs-staging-verify` before merging.
- **Signed-in staging check after merge** (needs a real Google account, which the user has to provide):
  1. Sign in with Google on staging.
  2. Load `/admin`, an admin list page, and an invoice PDF.
  3. Sign out and back in.

  `/ship --to-main` refuses to promote until the label is removed.
- **After merge:** close the superseded dependabot PRs #534–#595 (all except #527 and #588), each with a comment pointing here.
- **Rollback:** revert the squash commit. That restores the previous manifest and lockfile.
