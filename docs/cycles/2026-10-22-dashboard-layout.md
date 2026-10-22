# Dashboard analytics layout

## Context
The supplied admin dashboard screenshot shows an oversized finance chart card with a large empty footer beside the aging list. Default grid stretching, an early 3:2 finance split, crowded header actions, and redundant card spacing weaken hierarchy. Review also found that the analytics FadeContent wrapper remounts charts on scroll. The latest matching June UAT is possibly stale; findings are based on current code and the supplied screenshot.

## Spec
- [x] Analytics cards keep natural content heights without oversized blank footers.
- [x] Headers, aging labels, full currency values, and links remain readable and reachable at phone, tablet, and desktop widths.
- [x] Finance totals are visible using existing StatTile primitives; preserve all six months, including zero months.
- [x] Use existing design-system spacing, typography, currency font, and semantic status colors.
- [x] Remove unnecessary analytics remounts and aging-row animations without changing data fetching, permissions, or finance calculations.
- Scope: admin analytics presentation only; no database, API, dependency, or shared animation behavior changes. Assumption: the supplied screenshot refers to /admin analytics.

## Tasks
- [x] 1. Fix analytics layout and remove redundant rendering — one presentation slice, with responsive browser verification and existing regression coverage.

## Implementation
- Plan: driver=gpt-6.1-sol; delegate the analytics presentation slice and browser verification, then independent review; sequence shared-file edits.
- Task 1: responsive AnalyticsCard headers, natural-height grids, balanced finance columns, visible six-month StatTiles, wrapping aging rows, matching skeleton layout, and existing finance regression assertions. Removed the analytics scroll remount and five aging-row animation wrappers; kept permissions, parallel loading, all months, and empty/error states.
- Independent review: approved final diff, including nativeButton=false with explicit link role.
- Shipping test fix: dashboard first-screen measurement now waits for streamed analytics to be visible before boundingBox, rather than merely attached; independent review confirms unchanged layout assertions and stronger readiness. Fixed-case repeat verification passed 5/5 without retries; changed-test ESLint passed.

## Verification
- Documentation audit: passed (13 checks; existing ADR age warning only).
- Reference: .claude/standards/design-system.html; preserve canonical currency and status tokens.

- Full Vitest: 690 suites passed, 2 skipped; 8,150 tests passed, 42 todo (650.72s).
- Targeted analytics: 30 tests across 3 suites passed; scoped ESLint passed.
- Read-only Playwright browser verification: 320, 390, 768, 1280, 1440, 1920px; no horizontal overflow, clipped currency, or inaccessible actions. Large Rp 9.999.999.999 display stress passed at 320px. Finance chart remains 220px with 16px bottom padding; desktop finance/aging cards ~413/~409px. Populated SVGs confirmed after animation settles.
- Admin voice: existing canonical labels reused; total figures use canonical font-currency and full rupiah values.
- Shipping verification: disposable local Postgres on port 54329, with DATABASE_URL and DIRECT_URL explicitly local; seeded dummy data. Full local Playwright: 246 passed and 1 pre-fix readiness flake (4.8m). The fixed first-screen case then passed 5/5 repeats with retries=0 (6.9s); prior CI deferral superseded. No shared DB mutated.
- Environment: missing local Rolldown native optional binding repaired without tracked dependency changes. Standard Turbopack build failed fetching fonts / creating a local worker port. Webpack compiled successfully, then its typecheck exhausted the default 2 GB Node heap; production build passed using `NODE_OPTIONS=--max-old-space-size=4096 npm run build -- --webpack` (including TypeScript and static generation). No project build configuration changed.

- Shipping preflight: compared origin/staging c0d22613527cdfb2c4f92568978f49af727a45e6 to runtime head 837fe5875ed6d2dd84f40094a8139a8b4487c099. Changed paths: CLAUDE.md; components/admin/dashboard/analytics/{analytics-card,aging-card,finance-trend-card,dashboard-analytics,analytics-skeleton}.tsx; existing analytics cards.test.tsx; this cycle doc. Subsequent change is e2e/admin-dashboard.spec.ts test readiness only. Route: other code, no auth/permission/API/schema change.
- Full lint and RLS/API-auth guards passed (43/43 models; 216/216 routes). Soft-skip delta vs staging: 0 (26 baseline, 26 current).

## Ship Notes
- No migrations, new environment variables, or dependency changes.
- Preview smoke: /admin analytics at phone and desktop widths; check chart tooltip, finance module links, unavailable/empty states and finance permission gating.
- Rollback: revert this presentation-only cycle.
