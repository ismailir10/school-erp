# Guide mock screens — realistic illustrations, and English route slugs

## Context

Follow-up to [2026-10-31-panduan-refresh](2026-10-31-panduan-refresh.md) (merged as #707). The owner reviewed the
decks and asked for:

1. **More realistic illustrations:** "not a screenshot, but not too far from the actual design." The inline-SVG
   drawings (grey bars standing in for text, a 560×400 line-art kit) read as diagrams, not as Talib.
2. **English slugs.** `/panduan` and `/panduan/orang-tua` break the English-only route rule set on 2026-09-25 (see
   the `/admin/penilaian → /admin/assessments` redirects in `next.config.ts`).

## Decisions

1. **Mock screens, not screenshots.** Each illustration is a simplified Talib screen in HTML: the app's own Tailwind
   tokens, type and lucide icons, real labels and button text copied from the page source, and invented sample data
   (Aisyah Putri, Bu Nur, Bu Guru Rina). It is cropped to what the slide is about, inside a light phone or browser
   frame, with one detail lifted out as a floating card.
   - Why not screenshots: they go stale with every UI change, would show real children, and cannot be cropped or
     emphasised.
   - Why not SVG: SVG cannot borrow the app's components and type.
2. **One kit.**
   - `components/deck/mock/stage.tsx` is a 680×500 design canvas, zoomed to its column like `FitHeight`, and
     `aria-hidden` + `inert`.
   - `components/deck/mock/frames.tsx` holds `Phone`, `PortalHeader`, `BottomNav`, `Browser` and `Float`.
3. **Routes `/guide` and `/guide/parents`.** Permanent redirects from the old paths keep shared links working; the
   `#slide` fragment survives the redirect.
4. **Direction check first.** Three samples (one per portal) go to the owner before the other ~25 are built.
5. **Workflow deviation:** this session is pinned to `claude/intelligent-sagan-nf6qve`, restarted from
   `origin/staging` after #707 merged; no `feat/*` worktree.

## Acceptance criteria

- [x] Every slide on both decks uses a mock screen (the cover photo and the HTML module map, access matrix and
      checklist stay).
- [x] Mocks use tokens only, real labels, and no real names; nothing focusable inside.
- [x] Readable at 1440×900, and not clipped at 390×844.
- [x] `/guide`, `/guide/parents` serve the decks; `/panduan#5` lands on `/guide#5`.
- [x] Gates: tsc, lint, Vitest, `DEMO_MODE` build, `audit-docs.sh`, Playwright `e2e/deck.spec.ts`.

## Verify flows

1. Admin opens Panduan Talib from the sidebar: `/guide`, pages through all slides.
2. An old `/panduan#5` link opens slide 5 at `/guide#5`.
3. Parent opens Profil → Panduan Talib: `/guide/parents`.

## Tasks

- [x] **T1 — Slugs.** Move `app/panduan` → `app/guide`, `orang-tua` → `parents`, redirects, links, tests, docs.
- [x] **T2 — Mock kit + three samples** for the owner's go-ahead.
- [x] **T3 — Remaining mocks**, both decks.
- [x] **T4 — Remove the retired SVG art**, tests, screenshots, docs.

## Implementation

- **T1.** `git mv app/panduan app/guide`, `app/guide/orang-tua` → `app/guide/parents`. Two permanent redirects in
  `next.config.ts`. Links updated in the admin sidebar, the teacher Lainnya sheet and the parent Profil. Tests updated,
  and an e2e case checks that `/panduan#5` lands on `/guide#5`. README Guides row and `docs/uat/jobs/parent.md` updated.

- **T2.** Mock kit in `components/deck/mock/`:
  - `stage.tsx` is a 680×500 canvas zoomed to its column, `aria-hidden` and `inert`.
  - `frames.tsx` holds `Phone`, `PortalHeader`, `BottomNav`, `Browser` and `Float`.
  - `admin-rail.tsx` is the collapsed admin sidebar.

  Three samples went to the owner: class attendance, parent invoice and admin dashboard. The owner approved them
  ("get it merged on staging on green").
- **T3.** 21 more mocks, so every illustrated slide on both decks is a mock screen. Five Sonnet workers drew them in
  parallel, grouped by portal, from one shared brief, reference screenshots of the real screens and the three approved
  samples. Two decks share `ParentHomeMock` (parent Beranda, staff Portal orang tua). Names and amounts are invented,
  and the parent is "Bu Nur" (Nur Hasanah) throughout. Each mock departs from the live page to fit its frame; the
  workers' notes:
  - Teacher class-attendance buttons are 32px, not 44px.
  - The rapor editor shows the Triwulan and Kelas pickers above the editor; the real UI has them on the list page.
  - The invoice filter is drawn as chips; the real UI uses a select.
  - The fees tab shows one program, as the real select-driven tab does.
  - Some dialog descriptions are shortened.
- **T4.** `components/deck/art/` (the SVG kit and its 23 drawings) is deleted. The cover photo, module map, parent map,
  access matrix and first-week checklist are real HTML and stay. A deck test asserts every mock is `aria-hidden` with
  nothing focusable inside.

## Verification

- Visual reference: `.claude/standards/design-system.html`; the mocks are built from its tokens.
- **Gates.**
  - `npx tsc --noEmit` clean, after clearing a stale `.next/types` left by the route move. That stale validator also
    made one `next build` type-check run out of memory; the clean rebuild passed.
  - `eslint` clean on `components/deck`, `app/guide` and `e2e/deck.spec.ts`.
  - Vitest deck and guide suites: 27/27.
  - `DEMO_MODE=true npm run build` OK.
  - `audit-docs.sh`: 0 fail; the one warning is the pre-existing ADR window.
- **Playwright, local.** `e2e/deck.spec.ts` passed 10/10 against a production `DEMO_MODE` build on a disposable local
  Postgres 16, run with the preinstalled Chromium. The 10th case is new: `/panduan#5` → `/guide#5` and
  `/panduan/orang-tua` → `/guide/parents`.
- **CI fix.** `Test & Build` first failed on `lib/__tests__/design-token-guard.test.ts` rule E: `report-card-mock.tsx` drew
  "Tarik penerbitan" with `bg-destructive/10`. It now uses `bg-destructive-subtle text-destructive-text`, the real
  destructive chip. The guard test reproduced the failure locally and then passed.
- **Visual loop.** Every slide of both decks was captured at 1440×900 and 390×844 (reduced motion), with no sideways
  overflow, and I reviewed all of them. The only fix after review was aligning the parent's name across mocks.
  Each mock was also checked in isolation by its worker, at 560px and 366px, with a static render harness using the
  real compiled app CSS.

## Ship Notes

- Not auth-impacting: a route rename with redirects, plus static presentation components. It touches user flows (the
  guides and the parent Profil link), so the PR carries `e2e`.
- The owner approved the three samples and asked to merge on green; this PR self-merges to `staging` once
  `Checks`, `Test & Build` and `E2E` are green on the head.
