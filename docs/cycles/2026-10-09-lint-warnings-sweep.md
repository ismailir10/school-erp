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
- [ ] **T4 — Ratchet.** `package.json` `"lint": "eslint --max-warnings=0"`; cycle bookkeeping (Verification, Ship Notes), `bash scripts/audit-docs.sh`. *Accept:* `npm run lint` exits 0 with zero warnings, and exits non-zero when one warning is injected (checked then reverted). *Depends on:* T3.

## Implementation

- Subagent plan: driver=claude-sonnet-5-5, dirty-work=none; tasks [T1,T2,T3,T4] inline. Reason: small, interlocking edits where each step's lint count is the acceptance check, so a subagent would need the whole plan as context. One independent read-only reviewer agent runs on the final diff.
- Task 1: Teach the linter the `_` convention — `eslint.config.mjs` — `no-unused-vars` ignores `^_` args/vars/destructured/caught names and rest siblings; unprefixed names still warn. 56 → 36 warnings, no source change.
- Task 2: Remove dead code — `app/admin/invoices/[id]/page.tsx` (Link, Skeleton, ArrowLeft), `app/teacher/assessments/center/[center]/page.tsx` (CalendarOff), `app/api/admin/curriculum/import-promes/route.ts` (AgeGroupInput), `app/api/admin/classes/route.ts` (WEEKDAY_CODES const → literal union type), `app/admin/guardians/page.tsx` (`editGuardianId` state + 2 setter calls; written, never read), `app/teacher/error.tsx` (unused `error` binding) — 36 → 28 warnings.
- Task 3: Hooks, reasoned suppressions, stale directives — memoised `payrollItems` (`admin/(hr)/payroll/[id]/page.tsx`), student-journal class `students`, teacher-center `indicators` so the `useMemo`s that read them actually memoise; one-line reasoned `eslint-disable-next-line` on the two intentional `[]` column memos (`admin/guardians`, `admin/students`; handlers only use state setters, `editForm.reset`, `toast`), on the two auth-proxied photo `<img>` tags, and a scoped disable/enable around the `ColumnMeta` declaration-merge generics in `components/ui/data-table.tsx`; `eslint --fix` removed 17 stale directives (3 only became stale after T1: `no-unused-vars` in `api/employees*` and `api/enrollments/[id]`); `eslint --fix` left blank lines where directives were, which were deleted by hand (diff checked: removed comment lines only; `fees/page.tsx` keeps the still-needed `exhaustive-deps` half of a combined directive) — 28 → 0 warnings.

## Verification

## Ship Notes
