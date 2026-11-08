# Changelog: "Apa yang Baru" page + promotion rule

## Context

Users (admins, teachers, parents) have no way to learn what changed after each release. `staging` → `main` promotions happen every few days (29 since early August) and the only record is git history, which no school user reads.

Outcome: a signed-in-only page listing releases in plain Indonesian, one entry per `main` promotion, kept current by a rule that blocks a promotion without a new entry. The last 3 months (promotions from 2026-08-08) are backfilled so the page is useful on day one.

Facts found: any new top-level route is signed-in by default (`proxy.ts` only whitelists named public paths); `/guide` is the precedent for a signed-in page outside the portals (own `getSession()` guard, "Kembali" link, entry points in admin sidebar footer, teacher "Lainnya" sheet, parent profile "Bantuan"). The app renders no markdown and reads no repo files at runtime (Vercel file tracing), so release data must be a TS module, not `CHANGELOG.md`.

## Decisions

1. **Audience:** all signed-in users; copy in Bahasa Indonesia per `voice.md`; no PR numbers or tech terms. (User)
2. **Granularity:** one entry per promotion, dated. Same-day promotions share one entry (23 distinct dates in the backfill). (User)
3. **Access:** any signed-in role, route `/changelog`, titled "Apa yang Baru". Signed-out goes to `/` like every other gated page. (User)
4. **Enforcement:** a promotion PR (`staging` → `main`) fails CI unless the changelog gained an entry since `main`. `/ship --to-main` ships the entry to `staging` first (own small PR), then opens the promotion. (User)
5. **Single source:** `lib/changelog/releases.ts` typed data is the only copy; the page renders it. No `CHANGELOG.md` (it would duplicate and drift).
6. **Release id = promotion date** (`2026-11-06`, `-2` on a same-day second). No semver: the product is not consumed as a package.
7. **Entry shape:** `headline` (≤ 60 chars), 1-7 `items`, each `{ kind: baru | lebih-baik | diperbaiki, audience: admin | guru | orang-tua | semua, text }` with `text` ≤ 140 chars, one sentence. Promotion with nothing user-visible gets a single "Pembaruan di balik layar" item so the 1:1 rule holds without bloat.
8. **Page filter:** defaults to the viewer's own portal (plus "semua" items); one chip row to widen. Zero taps for the common case.
9. **Writing guide** lives in `docs/workflow/changelog.md` (see Tasks T4); enforced limits are checked by Vitest so bloat fails the build, not review.

## Acceptance criteria

- [ ] Signed-out visit to `/changelog` lands on `/`; admin, teacher and parent accounts can all open it.
- [ ] Page lists releases newest first with date, headline and items; each item shows kind and audience.
- [ ] A viewer sees their own portal's items first by default and can widen to all in one tap.
- [ ] Entry point exists in admin sidebar footer, teacher "Lainnya" sheet and parent profile.
- [ ] Backfill covers every promotion from 2026-08-08 to today, none from the 8 unpromoted staging commits.
- [ ] Vitest rejects an entry that breaks the limits (headline/item length, item count, order, duplicate id, unknown kind/audience).
- [ ] A staging → main PR without a new entry fails the `Checks` job; one with a new entry passes; other PRs are unaffected.
- [ ] `docs/workflow/changelog.md` defines what to include, what to skip and how to word it, with good/bad examples; `ship.md` Promotion and CLAUDE.md link to it.
- [ ] Every page `<title>` rule (`page-titles` test) passes.

## Verify flows

1. Super admin (`u_super_admin`) opens sidebar "Apa yang Baru" → sees newest release, admin items first → taps "Semua" → guru/orang-tua items appear.
2. Parent (`u_rightjet`) opens profile → "Apa yang Baru" → sees orang-tua items only by default; text readable at 375 px.
3. Edge: teacher opens a release containing no guru items → "semua" items still show; no empty block.
4. Error: signed-out `/changelog` → `/`; a guardian-only item list never errors for a role with zero matches (shows "Belum ada pembaruan untuk peran ini").

## UX notes

Standalone page like `/guide`: "Kembali" to the viewer's home, then title, filter chips, release cards. Primary action: read. Taps to the main task: 2 from any portal (menu → entry). Empty state per portal.md contract. Voice: neutral for admin items, warm for orang-tua items (still one wording per item; the audience tag drives filtering, not tone).

## Test seams

- Vitest: `releases.ts` shape/limits; page guard (copy `app/guide/__tests__/page.test.tsx`); filter logic.
- Script test: promotion-changelog check (pass/fail fixtures), added to the audit/hook self-tests.
- e2e (`e2e/changelog.spec.ts`, copy `deck.spec.ts`): signed-out redirect, each role opens it.

## Non-goals

No admin editor, no per-user "seen" badge, no email/push announcement, no RSS, no English copy, no changelog for the 8 not-yet-promoted commits.

## Assumptions

1. Work stays on the session-designated branch `claude/jolly-cray-h1r16u` (equal to `origin/staging`), not a new `feat/*` worktree.
2. Backfill is sourced from promotion ranges in git plus cycle docs, written by workers, then reviewed by the driver for tone and bloat.
3. Auth classification: no change to `proxy.ts` or `lib/auth*`; route relies on the default gate plus a page-level `getSession()` guard, so verify-local only, no `needs-staging-verify`.
4. CI change is a step in the existing `Checks` job, not a new workflow.

## Gate re-openers

None. (No schema, no new dependency, no auth code change, no production write.)

## Tasks

- [x] T1 Release data module + types + shape/limit tests — accept: Vitest fails on each rule break (reuse: `lib/page-title.ts` style)
- [x] T2 `/changelog` page: guard, title, filter, empty state — accept: guard test + render test per role (deps: T1, reuse: `app/guide/parents/page.tsx`)
- [x] T3 Entry points in admin sidebar, teacher more-sheet, parent profile — accept: link visible in each (deps: T2, parallel with T4-T6)
- [x] T4 `docs/workflow/changelog.md` writing guide; link from ship.md Promotion + CLAUDE.md; `audit-docs.sh --write` — accept: `audit-docs.sh` exits 0
- [x] T5 `scripts/check-promotion-changelog.sh` + `Checks` CI step + self-test — accept: fixtures pass/fail as expected (parallel with T2, T3)
- [x] T6 Backfill 23 release entries from 2026-08-08 — accept: T1 tests green, driver tone review (deps: T1, T4; fan-out one worker per ~6 entries)
- [x] T7 `e2e/changelog.spec.ts` — accept: passes locally on production build (deps: T2, T3)

## Implementation

- Plan: driver=claude-sonnet-5-5, workers=claude-sonnet-5-5 (no cheaper tier suited to tone-sensitive Indonesian copy); T1, T4 inline (small, define the contract the workers need); T6 parallel, 3 workers, one data file each (`lib/changelog/data/part-{1,2,3}.ts`, no shared files); T2, T3, T5, T7 inline sequential after the guide lands. Deviation: built on the session-designated branch `claude/jolly-cray-h1r16u` in the main checkout, no `feat/*` worktree (Assumption 1). Task gate per task is the scoped Vitest/tsc run; the full `npm run build && npx vitest run` runs in verify-local.
- T1: `lib/changelog/{schema,releases}.ts`, `data/part-{1,2,3}.ts` (empty stubs), `__tests__/schema.test.ts` - typed release shape, limits (headline 60, item 140, 1-7 items, newest first, no PR numbers/links/code) and `validateReleases`; 13 Vitest tests green.
- T2: `app/changelog/page.tsx`, `components/changelog/changelog-view.tsx`, `lib/changelog/filter.ts`, tests - signed-in guard like `/guide/parents`, "Kembali ke <beranda>", "Untuk <peran>" / "Semua" toggle (default own portal), release cards with kind + audience badges, empty state. Reuses BackLink, Badge, Button, EmptyState, `formatDate`. design-system cross-check: tokens only, 44px back link, no raw hex. README gains a Portals row.
- T4: `docs/workflow/changelog.md` - writing guide (shape, include/skip, words, examples, process); linked from ship.md and CLAUDE.md with the promotion check in T5.
- T6: `lib/changelog/data/part-{1,2,3}.ts` - 23 entries (every distinct promotion date 2026-08-13 to 2026-11-06), written by 3 parallel workers from promotion ranges + cycle docs, then driver-reviewed. Driver edits: dropped items that were internal or already retired (10-22 security, 10-28 "Sudah dibayar" Lunas), merged the padded 10-26 pair into one item, replaced non-glossary words (surel, galat). Consequence: item minimum lowered 2 -> 1 (a promotion with one real change should not be padded). 2026-10-16 is a maintenance-only entry. Counts re-checked by the driver: 23 ids, `vitest run lib/changelog app/changelog` 30 passed.
- T5: `scripts/check-promotion-changelog.sh` (passes when base...head adds a release `id:` under `lib/changelog/data/`; editing an old entry does not count), `scripts/test-check-promotion-changelog.sh` (4 fixture cases, run in the CI "Workflow audit and hook regression tests" step), `ci.yml` step "Promotion changelog entry" (PRs with base `main` only). Real branch vs `origin/main`: 23 new entries, pass. `test-hooks.sh` 32 passed, `test-audit-docs.sh` 7 passed.
- T3: `components/admin/sidebar.tsx` (footer item above Panduan Talib), `components/teacher/more-sheet.tsx` (new Lainnya item), `app/parent/profile/page.tsx` (card in Bantuan, above the guide card), teacher more-sheet test (5 links + new href test). Same icon (Sparkles) and copy everywhere: "Apa yang Baru". design-system cross-check: parent card reuses the existing Bantuan card classes verbatim (text-xs floor kept). JTBD library not updated: a link, not a new capability.
- T7: `e2e/changelog.spec.ts` - signed-out redirect, each role opens it and returns home, teacher mobile (375px) default scope then Semua with no sideways scroll, admin sidebar + parent Profil links. 6 cases pass locally; full suite 288 passed.

## Verification

Route: **other code** (no change to `proxy.ts`, `lib/auth*` or session code; the page only reads `getSession()` like `/guide/parents`), so verify-local, no `needs-staging-verify`. Compared `origin/staging...HEAD` at code SHA `ed0e659d`: `app/parent/profile`, `components/{admin,teacher,changelog}`, `lib/changelog`, `scripts/`, `.github/workflows/ci.yml`, `e2e/`, `docs/`, `README.md`, `CLAUDE.md`. Disposable local Postgres 16 (own cluster, port 54329, schema via plain `prisma db push` on the empty DB, then seeded), dropped afterwards.

- Typecheck: `tsc --noEmit` clean. Lint: `npm run lint` exit 0.
- Vitest (no DEMO_MODE): `Test Files 762 passed | 2 skipped (764)`, `Tests 9341 passed | 42 todo`. New: `lib/changelog` (schema 13 + filter), `app/changelog` page (guard, per-role, filter, empty state), teacher more-sheet.
- `verify-rls-coverage.sh`: 51/51 OK. `verify-api-auth.sh`: 239/239 OK. `test-hooks.sh` 32 passed, `test-audit-docs.sh` 7 passed, `test-check-promotion-changelog.sh` 4 passed, `audit-docs.sh` 0 fail (1 pre-existing ADR-window warn).
- `DEMO_MODE=true npm run build`: success, `/changelog` listed as dynamic.
- Playwright (production build, Chromium, via the pre-installed browser; repo-pinned Playwright could not find its own): full suite `288 passed (7.4m)`; `e2e/changelog.spec.ts` 6/6 incl. signed-out redirect, three roles open it and return home, 375px teacher default scope then Semua with no sideways scroll, admin sidebar and parent Profil links. Soft-skip delta vs `origin/staging`: baseline 26, current 26.
- Walked on the running app (screenshots): parent at 390px and admin at 1280px. Back link, title, "Untuk <peran>" / "Semua" chips, dated cards with kind + audience badges; parent sees only orang-tua and semua items; no clipping or overflow. design-system cross-check: Badge success/info/neutral tokens, muted-foreground, card/border, 44px back link, no raw hex.
- Gap: the three menu entry points were checked by test (admin href, parent Profil click-through, teacher sheet) and not by screenshot; the Profil card sits below the fold.
- Noted, not fixed (out of scope): none blocking.

## Ship Notes

- Migrations: none. Env vars: none. Manual steps: none.
- Rollback: revert the squash commit; the page, data and CI step go together. No data to undo.
- Post-merge: staging deploy READY for the merge SHA; not auth-impacting, so no signed-in staging check required. Optional glance: `/changelog` on staging as any account.
- Next promotion: write that promotion's entry first (`docs/workflow/changelog.md`), merge it to `staging`, then open the promotion PR. `Checks` now fails a PR into `main` with no new release. The 8 commits already on staging when this was written (design-system source of truth, gate-on-Beranda, geofence attendance, ...) have no entry yet: they belong to the next one.
- Decisions made: branch is the session-designated `claude/jolly-cray-h1r16u`, no `feat/*` worktree; item minimum lowered to 1 after backfill review; two backfill items dropped as internal/retired; `playwright.local.config.ts` was a temporary untracked wrapper, deleted.
