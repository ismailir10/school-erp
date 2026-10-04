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
- [ ] **Task 2 — Wire into login.** Edit `app/page.tsx`: delete `MOTIF_SVG` and its overlay, mount `<Aurora />` in the brand panel, adjust panel classes if needed. Accept: no star/tile motif left, panel text contrast ≥ AA, build + vitest green. Depends on Task 1.
- [ ] **Task 3 — Verify visually.** Run the app, screenshot desktop + mobile login, confirm contrast and reduced-motion static state; fill Verification (design-system token). Depends on Task 2.

## Implementation
- Subagent plan: driver=claude-sonnet-5-5 (already the dirty-work tier per CLAUDE.md § Harness Roster; no cheaper tier to fan out to), dirty-work=none. Tasks [1,2,3] sequential and inline: three small interlocking edits (one component, one call-site swap, one verification pass) where a subagent would need the whole plan as context. A general-purpose agent did the independent review pass (`feature-dev:code-reviewer` is not installed in this harness).
- Task 1: Aurora component — `components/reactbits/aurora.tsx`, `components/reactbits/__tests__/aurora.test.tsx`, `app/globals.css` — server-rendered CSS port of React Bits Aurora: three elliptical radial-gradient bands in `--primary` / `--primary-text` / `--celebration-gold` at 28/10/10% peak, `transform`-only keyframes (26/32/38s, alternating, mismatched so they never re-sync) behind `motion-safe:`. Peaks were chosen from a worst-case contrast calculation (all three bands overlapping at peak on `--secondary`): 4.76:1 muted text, 3.12:1 icons. The first draft (45/22/20) measured 3.69:1 and was rejected.

## Verification
- design-system: colours are brand tokens via `color-mix` only (no hex), motion is restrained and transform-only, panel layout and type scale untouched (`.claude/standards/design-system.html`, `colors.md`, `ui.md`).
- Task 1: build + vitest + lint + typecheck passed (see end-of-cycle gate below); `aurora.test.tsx` 4/4 (aria-hidden decorative layer, three bands with `motion-safe:`-only animation, tokens and curves only, className merge).

## Ship Notes
