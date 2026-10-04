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

### Non-goals
- No WebGL, `ogl`, `three`, `gsap` or any new dependency.
- No change to auth logic, redirects, error codes or the demo-mode screen.
- No new copy, logo or typography changes.

### Assumptions I'm making
1. "Relevant React Bits motion background" = **Aurora** (soft, calm, brand-teal). Alternatives I rejected: Particles/Galaxy (busy, heavy), Silk/Liquid Ether (WebGL), Squares/Hexagon-style grids (angular shapes you asked to avoid).
2. It is okay to do a dependency-free CSS port rather than the upstream WebGL component (consistent with the 2026-09-30 decision).
3. The background goes on the brand panel only, not behind the white sign-in card, so the one action stays on a clean surface.
4. Demo-mode screen stays as is.

## Tasks
- [x] **Task 1 — Aurora component.** Add `components/reactbits/aurora.tsx`, blob keyframes/animation tokens in `app/globals.css`, and `components/reactbits/__tests__/aurora.test.tsx`. Accept: renders one `aria-hidden` layer with blob children, animation classes behind `motion-safe:`, test passes. Independent.
- [x] **Task 2 — Wire into login.** Edit `app/page.tsx`: delete `MOTIF_SVG` and its overlay, mount `<Aurora />` in the brand panel, adjust panel classes if needed. Accept: no star/tile motif left, panel text contrast ≥ AA, build + vitest green. Depends on Task 1.
- [x] **Task 3 — Verify visually.** Run the app, screenshot desktop + mobile login, confirm contrast and reduced-motion static state; fill Verification (design-system token). Depends on Task 2.

## Implementation
- Subagent plan: driver=claude-sonnet-5-5 (already the dirty-work tier per CLAUDE.md § Harness Roster; no cheaper tier to fan out to), dirty-work=none. Tasks [1,2,3] sequential and inline: three small interlocking edits (one component, one call-site swap, one verification pass) where a subagent would need the whole plan as context. A general-purpose agent did the independent review pass (`feature-dev:code-reviewer` is not installed in this harness).
- Task 1: Aurora component — `components/reactbits/aurora.tsx`, `components/reactbits/__tests__/aurora.test.tsx`, `app/globals.css` — server-rendered CSS port of React Bits Aurora: three elliptical radial-gradient bands in `--primary` / `--primary-text` / `--celebration-gold` at 28/10/10% peak, `transform`-only keyframes (26/32/38s, alternating, mismatched so they never re-sync) behind `motion-safe:`. Peaks were chosen from a worst-case contrast calculation (all three bands overlapping at peak on `--secondary`): 4.76:1 muted text, 3.12:1 icons. The first draft (45/22/20) measured 3.69:1 and was rejected.
- Task 2: Wire into login — `app/page.tsx` — deleted `MOTIF_SVG` (the square + rotated-square + circle tile, i.e. an eight-point star pattern) and its overlay div; mounted `<Aurora />` in the brand panel, which was already `relative isolate overflow-hidden`. Sign-in section, copy, Google flow and `DemoLoginPage` untouched.

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
    - Minor, pre-existing: under `prefers-reduced-motion: reduce` React logs a hydration mismatch on the sign-in card's `motion.div` (`initial={prefersReducedMotion ? false : …}` renders differently on server and client). In lines this cycle did not touch, and visible only to reduced-motion users. Not fixed here (scope); queued as a follow-up suggestion.

## Ship Notes
- No migrations, no env vars, no new dependencies. `package-lock.json` untouched.
- Merge is a squash into `staging`; Vercel builds `staging` only, so there is no preview. After merge, a glance at the staging login screen (Aurora visible on the brand panel, Google button works) is a health check, not a gate: this is not an auth-impacting change, so no `needs-staging-verify` label.
- Rollback: revert the squash commit. The change is purely presentational (`app/page.tsx` swap plus an additive component and keyframes).
- Scope note: the ask also covered avoiding "Israel-kind-of-shape" imagery. The only angular/star geometry on this screen was the tiled `MOTIF_SVG` pattern, now removed. The new backdrop uses ellipses and gradients only. A `--motif-opacity` token remains in `app/globals.css` unused by this screen and was deliberately left alone.
