# Lint warnings to zero, then keep them there

## Context

`npm run lint` exits 0 with **56 warnings** (0 errors). Warnings that nobody reads are noise that hides the one that matters: a new unused import or a missing hook dependency lands in a PR and nobody can tell it from the other 56. The warnings fall into a few groups, and most are not code problems at all:

- **~22 are `_`-prefixed names the project already uses on purpose** (`_req` on route handlers that ignore the request, `_init`/`_args` on `fetch` mocks, `_drop`/`_ignored` for "omit this key" destructuring, `_ok`/`_message` rest-siblings, `_error`). The lint config never told `@typescript-eslint/no-unused-vars` about the convention.
- **~15 are stale `eslint-disable` directives** that suppress nothing (`react-hooks/set-state-in-effect`, `no-var`, `no-constant-condition`, `exhaustive-deps`), left behind when the rules or code changed.
- **~9 are genuinely dead code**: unused imports (`Link`, `Skeleton`, `ArrowLeft`, `CalendarOff`, `AgeGroupInput`), a `WEEKDAY_CODES` const used only as a type, a `editGuardianId` state that is written and never read, an unused `error` prop on the teacher error boundary.
- **5 are `react-hooks/exhaustive-deps`**: three `x?.y ?? []` fallbacks recreated every render inside a `useMemo` dependency list (so the memo never memoises), and two column-definition memos that deliberately use `[]` so rows do not remount.
- **2 are `<img>`** on auth-proxied same-origin photo URLs (`next/image`'s server-side optimizer cannot carry the session cookie; the repo already suppresses this rule twice with that reason).
- **3 are the `ColumnMeta` generics** in `components/ui/data-table.tsx`, which TypeScript's declaration merging requires to match the upstream interface even though the body does not use them.

The outcome is zero warnings and a lint script that fails on any new one, so the count cannot creep back. No behaviour changes anywhere; this is hygiene plus one real micro-fix (the three never-memoising fallbacks).

## Spec

- [ ] `eslint.config.mjs` declares the underscore convention for `@typescript-eslint/no-unused-vars` (`argsIgnorePattern`, `varsIgnorePattern`, `destructuredArrayIgnorePattern`, `caughtErrorsIgnorePattern` all `^_`, plus `ignoreRestSiblings`). Unprefixed unused names still warn.
- [ ] Dead code is removed, not renamed: the five unused imports, `WEEKDAY_CODES` (the type becomes a literal union), `editGuardianId` and its two setters, the `error` binding in `app/teacher/error.tsx`.
- [ ] The three `?? []` / conditional fallbacks (`payrollItems`, student-journal `students`, teacher-center `indicators`) are wrapped in `useMemo`, so the `useMemo` that reads them actually memoises. Rendered output is identical.
- [ ] The two intentional `[]` column memos (`admin/guardians`, `admin/students`) and the two auth-proxied `<img>` tags and the three `ColumnMeta` generics carry a one-line `eslint-disable-next-line` **with the reason**. No suppression without a stated reason.
- [ ] All unused `eslint-disable` directives are removed.
- [ ] `npm run lint` reports `0 problems`, and the script becomes `eslint --max-warnings=0`; the existing CI `Lint` step then fails on any new warning.
- [ ] No visual or copy change: markup, classes and text are untouched, so the `design-system` tokens and portal shells are unaffected.

**Non-goals**
- No dependency change, no schema migration, no API/route behaviour change (the route edits only rename an ignored parameter via config; no source change in `*/stats/route.ts`).
- No new lint rules beyond the underscore convention, no upgrade of `eslint-config-next`.
- No refactor of `openEdit` / `openEditDialog` into `useCallback` (it would cascade through the column memos for no user-visible gain).
- The nightly prod backup failure (issue #554) stays with the owner.

**Assumptions I'm making**
1. The `_` convention is intentional project-wide. Evidence: 22 sites, including route handlers and test doubles, already follow it. If you would rather rename each site, only T1 changes.
2. `editGuardianId` is dead: it is written in two places and read nowhere (checked by grep). Removing it cannot change behaviour.
3. Wrapping `data?.items ?? []` in `useMemo` is behaviour-preserving: the same array contents, with a stable identity while `data` is unchanged.
4. Making `--max-warnings=0` part of `npm run lint` is acceptable. It is the point of the cycle; the risk is that a future dependency bump introduces a new warning and fails CI, which is the intended signal.

## Tasks

- [x] **T1 — Teach the linter the `_` convention.** Edit `eslint.config.mjs`. *Accept:* `npm run lint` warning count drops from 56 to ~34; no source file changed in this task. *Depends on:* nothing.
- [x] **T2 — Remove dead code.** Edit the files listed in Spec bullet 2. *Accept:* the corresponding `no-unused-vars` warnings are gone; `npx tsc --noEmit -p .` clean; touched suites pass. *Depends on:* T1 (so the count is attributable).
- [x] **T3 — Hooks, suppressions with reasons, stale directives.** Memoise the three fallbacks; add reasoned suppressions; run `npx eslint . --fix` to drop the unused directives. *Accept:* `npm run lint` → 0 problems; `npx vitest run` green. *Depends on:* T2.
- [x] **T4 — Ratchet.** `package.json` `"lint": "eslint --max-warnings=0"`; cycle bookkeeping (Verification, Ship Notes), `bash scripts/audit-docs.sh`. *Accept:* `npm run lint` exits 0 with zero warnings, and exits non-zero when one warning is injected (checked then reverted). *Depends on:* T3.

## Implementation

- Subagent plan: driver=claude-sonnet-5-5, dirty-work=none; tasks [T1,T2,T3,T4] inline. Reason: small, interlocking edits where each step's lint count is the acceptance check, so a subagent would need the whole plan as context. One independent read-only reviewer agent runs on the final diff.
- Task 1: Teach the linter the `_` convention — `eslint.config.mjs` — `no-unused-vars` ignores `^_` args/vars/destructured/caught names and rest siblings; unprefixed names still warn. 56 → 36 warnings, no source change.
- Task 2: Remove dead code — `app/admin/invoices/[id]/page.tsx` (Link, Skeleton, ArrowLeft), `app/teacher/assessments/center/[center]/page.tsx` (CalendarOff), `app/api/admin/curriculum/import-promes/route.ts` (AgeGroupInput), `app/api/admin/classes/route.ts` (WEEKDAY_CODES const → literal union type), `app/admin/guardians/page.tsx` (`editGuardianId` state + 2 setter calls; written, never read), `app/teacher/error.tsx` (unused `error` binding) — 36 → 28 warnings.
- Task 3: Hooks, reasoned suppressions, stale directives — memoised `payrollItems` (`admin/(hr)/payroll/[id]/page.tsx`), student-journal class `students`, teacher-center `indicators` so the `useMemo`s that read them actually memoise; one-line reasoned `eslint-disable-next-line` on the two intentional `[]` column memos (`admin/guardians`, `admin/students`; handlers only use state setters, `editForm.reset`, `toast`), on the two auth-proxied photo `<img>` tags, and a scoped disable/enable around the `ColumnMeta` declaration-merge generics in `components/ui/data-table.tsx`; `eslint --fix` removed 17 stale directives (3 only became stale after T1: `no-unused-vars` in `api/employees*` and `api/enrollments/[id]`); `eslint --fix` left blank lines where directives were, which were deleted by hand (diff checked: removed comment lines only; `fees/page.tsx` keeps the still-needed `exhaustive-deps` half of a combined directive) — 28 → 0 warnings.

- Task 4: Ratchet — `package.json` — `"lint": "eslint --max-warnings=0"`. Proven both ways: clean tree → exit 0; with a throwaway `lib/zz-lint-ratchet-probe.ts` containing an unused `const` → exit 1; the probe was deleted. CI's existing `Lint` step runs `npm run lint`, so it now fails on any new warning.

## Verification

- Warning count per task: 56 (start) → 36 (T1) → 28 (T2) → 0 (T3). `npm run lint` prints nothing and exits 0; `npx tsc --noEmit -p .` clean (after `npx prisma generate` in the fresh worktree).
- Gate on the T3 tree (the last source change; T4 only touches the lint script): `npm run build` (CI env: `DEMO_MODE=true`, dummy `DATABASE_URL`, `NEXTAUTH_SECRET`) → exit 0; `npx vitest run` → Test Files 571 passed | 2 skipped (573); Tests 5738 passed | 42 todo (5780) — identical to `staging`, so no test was added, removed or changed.
- Ratchet check (T4): see Task 4 above.
- Review (independent read-only agent on the whole cycle diff): no findings. Confirmed `editGuardianId` has no remaining references; the dropped imports are not used in JSX, type positions or re-exports; `WeekdayCode` keeps the same seven values; the three new `useMemo` calls are unconditional top-level hooks above any early return, with dependencies exactly what each expression reads; `app/teacher/error.tsx` is safe because Next passes `{ error, reset }` and a component may ignore a prop it does not destructure; both `<img>` disable comments sit on the line immediately above `<img` and are valid in those JSX positions; and in CI the `typecheck` step (which runs `prisma generate`) runs before `Lint`, so `lib/generated/prisma` exists when `--max-warnings=0` is evaluated, the same state as the local run. One general note, accepted: a fresh `npm ci` could in theory resolve a lint-plugin version that adds new warnings, which would fail the ratchet — intended signal, not specific to this diff.
- design-system: no markup, class or copy change. The only rendered-tree edits are comment lines, a removed unused import, and memoised fallbacks, so portal shells and tokens are untouched.
- Playwright: local run deferred to CI (env cannot execute it — the sandbox refuses the privilege switch needed to run a Postgres server as a non-root user, and there is no Docker daemon). Required CI check `Playwright E2E` gates the merge; CTO will not merge on red. No behaviour changes in this cycle apart from the three memo identities, so the jsdom suites that render those pages are the relevant local coverage.

## Ship Notes

- **Migrations / env vars:** none. No dependency change; `package-lock.json` is untouched (a local `npm` side effect kept modifying it in the worktree; it was reverted each time and is not in the diff).
- **Behaviour to know about:** `npm run lint` now fails on **any** warning (`--max-warnings=0`). A future dependency bump or a new unused import will turn the CI `Lint` step red instead of adding a 57th warning. That is the intent. To add a deliberate unused name, prefix it with `_`; to suppress a rule, say why in the same comment.
- **Staging check:** none required. No auth, session, cookie or guard code is touched.
- **Rollback:** revert the four commits; nothing else to undo. If the ratchet itself is the problem, revert only the `package.json` line.
- **Not done:** `openEdit` / `openEditDialog` are still plain functions captured by `[]`-dependency column memos (documented in place); turning them into `useCallback` would cascade through the memos for no user-visible gain. The nightly prod backup failure (issue #554) still needs the owner to set the repo secrets.
