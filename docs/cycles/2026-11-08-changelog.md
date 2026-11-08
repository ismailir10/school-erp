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
7. **Entry shape:** `headline` (≤ 60 chars), 2-7 `items`, each `{ kind: baru | lebih-baik | diperbaiki, audience: admin | guru | orang-tua | semua, text }` with `text` ≤ 140 chars, one sentence. Promotion with nothing user-visible gets a single "Pembaruan di balik layar" item so the 1:1 rule holds without bloat.
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

- [ ] T1 Release data module + types + shape/limit tests — accept: Vitest fails on each rule break (reuse: `lib/page-title.ts` style)
- [ ] T2 `/changelog` page: guard, title, filter, empty state — accept: guard test + render test per role (deps: T1, reuse: `app/guide/parents/page.tsx`)
- [ ] T3 Entry points in admin sidebar, teacher more-sheet, parent profile — accept: link visible in each (deps: T2, parallel with T4-T6)
- [ ] T4 `docs/workflow/changelog.md` writing guide; link from ship.md Promotion + CLAUDE.md; `audit-docs.sh --write` — accept: `audit-docs.sh` exits 0
- [ ] T5 `scripts/check-promotion-changelog.sh` + `Checks` CI step + self-test — accept: fixtures pass/fail as expected (parallel with T2, T3)
- [ ] T6 Backfill 23 release entries from 2026-08-08 — accept: T1 tests green, driver tone review (deps: T1, T4; fan-out one worker per ~6 entries)
- [ ] T7 `e2e/changelog.spec.ts` — accept: passes locally on production build (deps: T2, T3)

## Implementation

## Verification

## Ship Notes
