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

- [ ] Every slide on both decks uses a mock screen (the cover photo and the HTML module map, access matrix and
      checklist stay).
- [ ] Mocks use tokens only, real labels, and no real names; nothing focusable inside.
- [ ] Readable at 1440×900, and not clipped at 390×844.
- [ ] `/guide`, `/guide/parents` serve the decks; `/panduan#5` lands on `/guide#5`.
- [ ] Gates: tsc, lint, Vitest, `DEMO_MODE` build, `audit-docs.sh`, Playwright `e2e/deck.spec.ts`.

## Verify flows

1. Admin opens Panduan Talib from the sidebar: `/guide`, pages through all slides.
2. An old `/panduan#5` link opens slide 5 at `/guide#5`.
3. Parent opens Profil → Panduan Talib: `/guide/parents`.

## Tasks

- [x] **T1 — Slugs.** Move `app/panduan` → `app/guide`, `orang-tua` → `parents`, redirects, links, tests, docs.
- [ ] **T2 — Mock kit + three samples** for the owner's go-ahead.
- [ ] **T3 — Remaining mocks**, both decks.
- [ ] **T4 — Remove the retired SVG art**, tests, screenshots, docs.

## Implementation

- **T1.** `git mv app/panduan app/guide`, `app/guide/orang-tua` → `app/guide/parents`. Two permanent redirects in
  `next.config.ts`. Links updated in the admin sidebar, the teacher Lainnya sheet and the parent Profil. Tests updated,
  and an e2e case checks that `/panduan#5` lands on `/guide#5`. README Guides row and `docs/uat/jobs/parent.md` updated.

- **T2 (in progress).** Mock kit `components/deck/mock/{stage,frames}.tsx`; samples land here before the owner's
  review. Nothing imports them yet.

## Verification

- Visual reference: `.claude/standards/design-system.html`; the mocks are built from its tokens.

## Ship Notes
