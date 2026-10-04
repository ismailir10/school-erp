# Login Aurora Background

## Context
The Google sign-in screen (`app/page.tsx`, `SignInPage`) has a static brand panel: flat `bg-secondary` with a tiled outline motif (`MOTIF_SVG`, a square + rotated square + circle at 6% opacity, i.e. an eight-point star tiling). The user asked to improve the login page with a relevant [React Bits](https://reactbits.dev) motion background and to drop that angular-star geometry. Prior cycle `docs/cycles/2026-09-30-reactbits-motion.md` already set the rule for React Bits in this repo: it is a copy-paste catalogue, WebGL pieces (Aurora, Silk, Galaxy…) pull in `ogl`/`three` and are too heavy for parents on low-end Android phones, so each piece is re-implemented dependency-free, SSR-correct, reduced-motion safe. This cycle follows the same rule: port React Bits **Aurora** (soft drifting colour bands, calm and organic, fits a school) as a pure-CSS component in the Talib teal palette, replace the star-tile motif with it, and tidy the panel around it. Smooth blobs and curves only; no polygons, stars or tiled geometric shapes anywhere on the screen.

## Spec
- [ ] New `components/reactbits/aurora.tsx`: decorative, `aria-hidden`, `pointer-events-none`, absolutely fills its parent. A few blurred radial-gradient blobs in Talib brand tokens (teal `--primary`, soft teal-tint, a restrained warm accent) drifting on slow CSS keyframes (transform only, GPU-friendly). No WebGL, no new dependency.
- [ ] Static (no animation) under `prefers-reduced-motion`; animation gated by `motion-safe:` like `BlurText`.
- [ ] `app/page.tsx` brand panel: remove `MOTIF_SVG` and its overlay div; mount `<Aurora />` instead. No polygon, star or tiled-shape decoration remains on the screen.
- [ ] Text on the panel stays AA-legible over the animated background (headline, body, capability list). Verified by a contrast check against the brightest blob state.
- [ ] Sign-in section, copy, error handling, Google flow and the demo-mode login (`DemoLoginPage`, used by every e2e spec) are unchanged.
- [ ] Mobile: background renders on the brand panel below the action; no layout shift, no horizontal scroll; first-paint cost is CSS only.
- [ ] Unit test for `Aurora` (aria-hidden, decorative, motion gated). Existing suites stay green.
- [ ] Header comment cites React Bits upstream (`Backgrounds/Aurora`), MIT + Commons Clause, matching the other `reactbits/` files.

**Added after PR review (scope extended with the user's say-so on the second item):**
- [ ] WCAG 2.2.2 Pause, Stop, Hide: the drift never ends, so the brand panel gets a visible pause/play control (44px hit area, keyboard reachable, hidden by CSS under `prefers-reduced-motion` because nothing moves then). Raised by the Codex review on the PR (P2); valid, so fixed rather than argued.
- [ ] Fix the pre-existing hydration mismatch the browser check found: under `prefers-reduced-motion: reduce` the sign-in card's `initial` differed between server and client HTML. Same screen, same file, requested by the user in this session.

### Non-goals
- No WebGL, `ogl`, `three`, `gsap` or any new dependency.
- No change to auth logic, redirects, error codes or the demo-mode screen.
- No new copy beyond the two pause-control labels ("Jeda animasi" / "Putar animasi"); no logo or typography changes.

### Assumptions I'm making
1. "Relevant React Bits motion background" = **Aurora** (soft, calm, brand-teal). Alternatives I rejected: Particles/Galaxy (busy, heavy), Silk/Liquid Ether (WebGL), Squares/Hexagon-style grids (angular shapes you asked to avoid).
2. It is okay to do a dependency-free CSS port rather than the upstream WebGL component (consistent with the 2026-09-30 decision).
3. The background goes on the brand panel only, not behind the white sign-in card, so the one action stays on a clean surface.
4. Demo-mode screen stays as is.

## Tasks
- [x] **Task 1 — Aurora component.** Add `components/reactbits/aurora.tsx`, blob keyframes/animation tokens in `app/globals.css`, and `components/reactbits/__tests__/aurora.test.tsx`. Accept: renders one `aria-hidden` layer with blob children, animation classes behind `motion-safe:`, test passes. Independent.
- [x] **Task 2 — Wire into login.** Edit `app/page.tsx`: delete `MOTIF_SVG` and its overlay, mount `<Aurora />` in the brand panel, adjust panel classes if needed. Accept: no star/tile motif left, panel text contrast ≥ AA, build + vitest green. Depends on Task 1.
- [x] **Task 3 — Verify visually.** Run the app, screenshot desktop + mobile login, confirm contrast and reduced-motion static state; fill Verification (design-system token). Depends on Task 2.
- [x] **Task 4 — Pause control.** `Aurora` gains a `paused` prop; `SignInPage` gets a pause/play icon button in the brand panel. Accept: pausing freezes all three bands in a real browser and playing resumes them; button is 44px, named, hidden under reduced motion; component and page tests cover it. Depends on Task 2.
- [x] **Task 5 — Fix reduced-motion hydration mismatch.** Constant `initial` on the sign-in card plus `<MotionConfig reducedMotion="user">` around `SignInPage`. Accept: a server-render-then-hydrate test fails on the old branch and passes on the fix; no hydration error in a reduced-motion browser run. Shares `app/page.tsx` with Task 4, so the two land in one commit.

## Implementation
- Subagent plan: driver=claude-sonnet-5-5 (already the dirty-work tier per CLAUDE.md § Harness Roster; no cheaper tier to fan out to), dirty-work=none. Tasks [1,2,3] sequential and inline: three small interlocking edits (one component, one call-site swap, one verification pass) where a subagent would need the whole plan as context. A general-purpose agent did the independent review pass (`feature-dev:code-reviewer` is not installed in this harness).
- Task 1: Aurora component — `components/reactbits/aurora.tsx`, `components/reactbits/__tests__/aurora.test.tsx`, `app/globals.css` — server-rendered CSS port of React Bits Aurora: three elliptical radial-gradient bands in `--primary` / `--primary-text` / `--celebration-gold` at 28/10/10% peak, `transform`-only keyframes (26/32/38s, alternating, mismatched so they never re-sync) behind `motion-safe:`. Peaks were chosen from a worst-case contrast calculation (all three bands overlapping at peak on `--secondary`): 4.76:1 muted text, 3.12:1 icons. The first draft (45/22/20) measured 3.69:1 and was rejected.
- Task 2: Wire into login — `app/page.tsx` — deleted `MOTIF_SVG` (the square + rotated-square + circle tile, i.e. an eight-point star pattern) and its overlay div; mounted `<Aurora />` in the brand panel, which was already `relative isolate overflow-hidden`. Sign-in section, copy, Google flow and `DemoLoginPage` untouched.
- Task 4: Pause control — `components/reactbits/aurora.tsx`, `components/reactbits/__tests__/aurora.test.tsx`, `app/page.tsx` — `paused` sets `data-paused` on the layer and each band carries `group-data-[paused=true]/aurora:[animation-play-state:paused]`, so pausing is CSS-only and keeps each band's position (a resume continues rather than restarting). The toggle is a ghost icon `Button` (`size-11`, lucide `Pause`/`Play`), label flips between "Jeda animasi" and "Putar animasi" (no `aria-pressed`, which would double-announce a changing label), `motion-reduce:hidden` in CSS rather than `useReducedMotion()` so server and client HTML stay identical. State is per page view, not persisted.
- Task 5: Hydration fix — `app/page.tsx`, `app/__tests__/page.test.tsx` — removed `initial={prefersReducedMotion ? false : …}` and the `useReducedMotion` import; `LoginPageWrapper` wraps only `SignInPage` in `<MotionConfig reducedMotion="user">` (`DemoLoginPage` stays outside it, unchanged). Reduced-motion users now get the fade without the slide. Tasks 4 and 5 are one commit because both edit `app/page.tsx`; splitting would need interactive staging.

## Verification
- design-system: colours are brand tokens via `color-mix` only (no hex), motion is restrained and transform-only, panel layout and type scale untouched (`.claude/standards/design-system.html`, `colors.md`, `ui.md`).
- Task 1: build + vitest + lint + typecheck passed (see end-of-cycle gate below); `aurora.test.tsx` 4/4 (aria-hidden decorative layer, three bands with `motion-safe:`-only animation, tokens and curves only, className merge).
- Task 2: same gates; independent review pass reported no high-confidence issues (class generation, stacking, reduced motion, tokens, `color-mix` support, non-vacuous tests).
- Task 3: verification only — screenshots committed under `docs/cycles/screenshots/`, record below.

### End-of-cycle gate (run on source SHA `93d7fb9678ae4bb924a880e224208af45a59ae28`, the code head)
- `DEMO_MODE=true DATABASE_URL=postgresql://ci:ci@localhost:5432/schoolerp npm run build` (CI's env; a bare `npm run build` fails in a worktree with no `.env` on `DATABASE_URL is not configured`, not on this change): completed, route table printed, exit 0.
- `npx vitest run`: `Test Files  479 passed | 2 skipped (481)`, `Tests  4403 passed | 42 todo (4445)`.
- `npm run typecheck`: no errors. `npm run lint`: `55 problems (0 errors, 55 warnings)`, all pre-existing, none in changed files.
- `bash scripts/audit-docs.sh`: `13 ok, 1 warn, 0 fail` (the warn is the standing ADR 60-day window notice).
- Contrast (worst case, all three bands overlapping at peak on `--secondary`): muted text 4.76:1, foreground 10.90:1, `--primary-text` icons 3.12:1.
- Soft-skip delta: no test files other than the new `aurora.test.tsx` changed, and it adds no skips.
- Playwright: local run deferred to CI (env cannot execute it: no seeded database for the e2e suite). Required CI check `Playwright E2E` gates the merge; CTO will not merge on red. Note no e2e spec reaches the changed screen: every spec runs `DEMO_MODE=true`, which renders `DemoLoginPage` (untouched), and `SignInPage` only renders when `NEXT_PUBLIC_SUPABASE_URL` is set.

### Verification route (`/ship` Step 3)
- Changed paths vs `origin/staging`: `app/page.tsx`, `app/globals.css`, `components/reactbits/aurora.tsx`, `components/reactbits/__tests__/aurora.test.tsx`, the cycle doc, two screenshots, and the generated counts block in `CLAUDE.md` (70 → 71 active cycles, regenerated with `audit-docs.sh --write`). Runtime source is present, so documentation-only does not apply. No auth logic, session, cookie, guard or dependency changed: a visual swap inside the brand panel, with the Google handler and redirect URL untouched. Route = **Other code changes → local verification**, no signed-in staging check required.
- Local verification passed for source SHA `93d7fb9678ae4bb924a880e224208af45a59ae28`: route=`next dev` on :3100 with `NEXT_PUBLIC_SUPABASE_URL` set to a dummy so `SignInPage` renders, `DATABASE_URL` pointed at a disposable local Postgres 16 (`schoolerp`, no schema applied: the login screen makes no database reads). Chromium via Playwright at 1280x800, 390x844, and 1280x800 with `prefers-reduced-motion: reduce`.
  - Desktop and mobile: `<h1>` "Masuk ke Talib" and the "Masuk dengan Google" button render; Aurora layer present (656x800 desktop, 390x351 mobile); all three bands animating (`aurora-a/b/c`, 26s/32s/38s, live non-identity transforms); no horizontal scroll; no remaining `data:image/svg` background anywhere on the page; zero HTTP 5xx.
  - Reduced motion: `animation-name: none` and `transform: none` on all three bands (static backdrop).
  - Evidence: `docs/cycles/screenshots/2026-10-04-login-aurora-desktop.png`, `docs/cycles/screenshots/2026-10-04-login-aurora-mobile.png`.
  - Blockers: 0 introduced by this change. Findings classified:
    - Minor, environmental: `net::ERR_TUNNEL_CONNECTION_FAILED` for `va.vercel-scripts.com` (Vercel Analytics / Speed Insights), blocked by the sandbox network. Not code.
    - Minor, pre-existing: under `prefers-reduced-motion: reduce` React logs a hydration mismatch on the sign-in card's `motion.div` (`initial={prefersReducedMotion ? false : …}` renders differently on server and client). In lines this cycle did not touch, and visible only to reduced-motion users. Left alone at this SHA; fixed afterwards in Task 5 and re-verified in the follow-up block below.

### Follow-up gate: Tasks 4 and 5 (source SHA `c175a1789b89b11594f6b61e8ddd7754037900e8`)
- Same CI env build: `DEMO_MODE=true DATABASE_URL=… npm run build` exit 0. `npx vitest run`: `Test Files  480 passed | 2 skipped (482)`, `Tests  4407 passed | 42 todo (4449)` (up from 479 / 4403: the new `app/__tests__/page.test.tsx` suite, 3 tests, and one new `aurora.test.tsx` test). `npx tsc --noEmit` exit 0. `npx eslint app/__tests__ app/page.tsx components/reactbits` exit 0.
- Regression test proven to bite: with the old `initial={prefersReducedMotion ? false : …}` restored, `hydrates a reduced-motion client against server HTML without a mismatch` FAILED with the same "A tree hydrated but some attributes of the server rendered HTML didn't match" message seen in the browser; with the fix it passes. (My first version of this test passed on the buggy code, because framer-motion caches the preference in a module-level singleton; it now drives `useReducedMotion` through a mock seam instead.)
- Local browser verification (same route as above: `next dev` :3100, dummy `NEXT_PUBLIC_SUPABASE_URL`, `DATABASE_URL` → disposable local Postgres, Chromium):
  - Reduced motion (1280x800): pause control `display: none`; all three bands `animation-name: none`; card `opacity: 1`; **0 hydration errors**, 0 other console errors apart from the sandbox-blocked Vercel analytics scripts.
  - Normal motion: pause button is 44x44; bands `running` → click "Jeda animasi" → all three `paused`, and the band transform was unchanged across 1.5s (frozen); click "Putar animasi" → `running` and the transform moved again; 0 hydration errors.
  - Evidence: `docs/cycles/screenshots/2026-10-04-login-aurora-paused.png` (paused state, play button in the panel corner).
- Independent review pass: no high-confidence product-code defects (Tailwind variant compiled and its specificity checked, `data-paused` string rendering, toggle accessible name / hit area / focus ring / stacking, `MotionConfig` fixes the mismatch without changing behaviour for non-reduced users). Three low-severity test notes: cleanup moved into `finally` and the title made honest (both done); the mock seam cannot notice `<MotionConfig>` being deleted, recorded as a comment in the test rather than hardened.
- Behaviour change to flag: reduced-motion users used to get no entrance animation; they now get the 0.42s opacity fade without the slide (`MotionConfig reducedMotion="user"`).
- Playwright: still deferred to the required CI `Playwright E2E` check, same reason as above (it passed on the previous head `a574abe`).

## Ship Notes
- No migrations, no env vars, no new dependencies. `package-lock.json` untouched.
- Merge is a squash into `staging`; Vercel builds `staging` only, so there is no preview. After merge, a glance at the staging login screen (Aurora visible on the brand panel, Google button works) is a health check, not a gate: this is not an auth-impacting change, so no `needs-staging-verify` label.
- Rollback: revert the squash commit. The change is purely presentational (`app/page.tsx` swap plus an additive component and keyframes).
- Scope note: the ask also covered avoiding "Israel-kind-of-shape" imagery. The only angular/star geometry on this screen was the tiled `MOTIF_SVG` pattern, now removed. The new backdrop uses ellipses and gradients only. A `--motif-opacity` token remains in `app/globals.css` unused by this screen and was deliberately left alone.
