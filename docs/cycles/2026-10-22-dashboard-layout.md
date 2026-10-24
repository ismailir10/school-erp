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
- Shipping verification: disposable local Postgres on port 54329, with DATABASE_URL and DIRECT_URL explicitly local; seeded dummy data. Full local Playwright: 246 passed and 1 pre-fix readiness flake (4.8m). The fixed first-screen case then passed 5/5 repeats with retries=0 (6.9s); prior CI deferral superseded. Local tests did not mutate a shared database; the separately approved production operation is recorded below.
- Environment: missing local Rolldown native optional binding repaired without tracked dependency changes. Standard Turbopack build failed fetching fonts / creating a local worker port. Webpack compiled successfully, then its typecheck exhausted the default 2 GB Node heap; production build passed using `NODE_OPTIONS=--max-old-space-size=4096 npm run build -- --webpack` (including TypeScript and static generation). No project build configuration changed.

- Shipping preflight: compared origin/staging c0d22613527cdfb2c4f92568978f49af727a45e6 to runtime head 837fe5875ed6d2dd84f40094a8139a8b4487c099. Changed paths: CLAUDE.md; components/admin/dashboard/analytics/{analytics-card,aging-card,finance-trend-card,dashboard-analytics,analytics-skeleton}.tsx; existing analytics cards.test.tsx; this cycle doc. Subsequent change is e2e/admin-dashboard.spec.ts test readiness only. Route: other code, no auth/permission/API/schema change.
- Full lint and RLS/API-auth guards passed (43/43 models; 216/216 routes). Soft-skip delta vs staging: 0 (26 baseline, 26 current).

### Verified locally — a5345751, 2026-10-22
- Gate: full lint passed; `npx vitest run` → 690 suites passed / 2 skipped, 8,150 tests passed / 42 todo. RLS + API-auth guards passed. `NODE_OPTIONS=--max-old-space-size=4096 npm run build -- --webpack` → compiled successfully, TypeScript finished, static generation finished. Runtime files unchanged since 837fe587; a5345751 adds only the reviewed E2E readiness fix and evidence.
- App: production build on http://localhost:3000, demo super admin and school admin, disposable seeded local Postgres; both database URLs explicitly local.
- Walked: finance chart, six-month totals, aging labels/amounts, finance navigation, mobile wrapping, keyboard links and school-admin finance gating → passed. Existing unit coverage confirms unavailable/empty/hidden contracts.
- Playwright: full suite → 246 passed, 1 pre-fix readiness flake (247 total, 4.8m); fixed first-screen case → 5 passed (6.9s), repeat-each=5, retries=0. No hard failures or new skips.
- Console/network: finance walk pageErrors=[]; pre-existing report-only CSP diagnostics during full E2E, no finance rendering failure.
- Screenshots: /tmp/dashboard-layout/dashboard-finance-local-desktop.png (1440px), /tmp/dashboard-layout/dashboard-finance-local-phone.png (390px), dummy seeded data.
- Highlight: the two screenshots above, visually inspected.
- Rounds: 2 — responsive analytics fix; streamed-section test readiness fix. Independent code review approved both.
- At the local gate, authenticated deployment smoke awaited staging; the post-merge checks below supersede that deferral. No per-PR Vercel deployment exists. No unverified auth staging labels outstanding; earlier security PR #683 has signed-in staging evidence.

### Release and approved production operation — 2026-10-22

- Dashboard PR [#684](https://github.com/ismailir10/school-erp/pull/684) merged to staging; its deployment reached READY and the signed-in dashboard check passed with no console errors. Promotion PR [#685](https://github.com/ismailir10/school-erp/pull/685) passed Checks, Test & Build and E2E (8,150 unit tests; 247 E2E tests), then merged to main as ca9bb7cf60e20c071d2b59897d82dbcb1b25bc06. Production deployment reached READY; the production URL returned HTTP 200.
- Production smoke exposed an existing sign-in lockout from #683: two active admins had verified Google identities linked to older email/password accounts, whose primary-provider metadata remained email. The owner explicitly approved a separate credential repair in production Supabase project `vxwywmvpxetdgnxejjgk`; this was an operational exception, with no auth-guard, schema or application-code change.
- The independently reviewed, guarded transaction removed only those two accounts' legacy email identities/passwords, pending auth/recovery/PKCE state and existing sessions, then set provider metadata to Google. Exact-target assertions passed; existing verified Google identities, auth/app IDs, roles, unrelated metadata and application data were preserved. Independent post-operation checks passed. Reviewed SQL SHA-256: `8598ca8c27474ed9de6e16876e35b57df5d9f4de4abec2a3157290fb7f47d372`.
- After the repair, a fresh owner Google sign-in reached `/admin`, survived a full refresh, displayed the corrected finance layout and navigated to invoices. Browser errors and the independent runtime-error check were empty. Only the new owner OAuth session existed; the second admin had no remaining sessions. The second admin's database postconditions passed; their interactive Google sign-in was not available in the browser profile.
- Production screenshot: `/tmp/dashboard-layout/dashboard-production-after.png`. These operational checks supplement the unchanged runtime verification above; this record adds documentation only.


### Documentation follow-up verification

- Compared with `origin/staging` at `5cf26f4de69908833550a0115c717dc7b6543441`: only `docs/cycles/2026-10-22-dashboard-layout.md` changes. This records completed release and approved operational evidence; runtime, configuration and tests are unchanged.
- Documentation audit passed (13 checks; existing ADR age warning only); `git diff --check` passed. Local runtime/build and E2E reruns skipped under the documentation-only verification route; prior runtime evidence above remains valid. Follow-up PR CI Checks and Test & Build are pending; no E2E label is required for this record-only diff.

## Ship Notes
- No migrations, new environment variables, or dependency changes.
- Preview smoke: /admin analytics at phone and desktop widths; check chart tooltip, finance module links, unavailable/empty states and finance permission gating.
- Application rollback: revert this presentation-only cycle. The separately approved credential repair is not reversed by reverting code; removed credentials and sessions must not be restored. Recovery uses the preserved Google identities and fresh sign-in.
- Credential-repair limits: existing access JWTs can remain valid until expiry; the operation does not disable project-wide email OTP/recovery or guarantee permanent Google-only authentication. No secrets, password hashes or token values are included in this record.
