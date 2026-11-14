# UI/UX audit and improvement roadmap (docs only)

## Context

The user asked for a comprehensive UI/UX audit of the admin, teacher and parent portals, judged against our own standards, the "don't make me think" principle and cross-page consistency. The output is a roadmap that Codex and other harnesses can pick up. Each item points at the problem and says how to re-verify it before fixing; it does not prescribe the fix. Two examples set the bar:
- **The Sentra "Kampus" dropdown.** It feels off because the popup covers its own field, every option repeats "An Nisaa' Sekolahku …", and the admin is asked for something the app should know.
- **Names should open their record.** An admin should be able to tap a student's name on an invoice and land on the student, without searching the Siswa page.

No product code changes in this cycle.

## Decisions

- **The deliverable is a UAT report.** It goes in `docs/uat/reports/2026-11-14-ui-ux-audit.md`, with curated screenshots in `docs/uat/reports/assets/2026-11-14-ui-ux-audit/`, following the precedent of `2026-09-29-full-e2e.md` and `2026-10-06-enrollment-form.md`. `spec` already reads the newest matching UAT report into a cycle's Context, so every future UX cycle picks the roadmap up without anyone pointing at it.
- **Roadmap items are pointers.** Each has *Verify before fixing* steps and marks a **Decision needed** where the design belongs to the user. Implementers re-verify and may drop an item with a reason.
- **One roadmap item = one future cycle** (UX-R2 is split by module). Status is ticked in the report's roadmap table by the PR that ships the item.
- **Run locally on demo auth, not on staging.** The `/uat` skill defaults to staging with Chrome MCP, and neither is available to this cloud session. The one staging-only fact, the full campus names, is taken from the user's screenshot and flagged for read-only verification.
- **Scope.** Super-admin-only areas were excluded. Copy and wording are in scope. Viewports: phone for teacher and parent; phone and desktop for admin.

## Acceptance criteria

- Every admin, teacher and parent route is swept with screenshots, console and network checks.
- Every finding cites a route, viewport, evidence and repro steps.
- The roadmap is ranked, and each item says what to verify first.
- The report states its own limits: a Saturday run, the seed campus names, and the untested paths.

## Tasks

- [x] Run a local production build on a disposable Postgres and seed it.
- [x] Run the browser sweep across five agents (admin ×3, teacher, parent) and a static code sweep.
- [x] Check the key screenshots and code anchors as lead reviewer, merge the duplicates, and write the report and roadmap.

## Implementation

- Plan: the driver (Opus) wrote the rubric and the agent brief, and did synthesis, screenshot review and roadmap ranking. The dirty-work tier did the sweeps: five Haiku agents (per the user's request) for the browser pass and one Sonnet agent for the static code sweep. The driver read no module files beyond spot checks.
- The shared helper `shoot.js` (screenshot, load time, console errors, failed requests, horizontal overflow) and the rubric lived in the session scratchpad. The raw agent notes and about 150 screenshots stayed there; 10 curated screenshots are committed.

## Verification

- Build: `origin/staging` @ `a0afa580`, `DEMO_MODE=true npm run build` (needed `NODE_OPTIONS=--max-old-space-size=6144`; the default heap ran out during type check) + `npm run start`, local Postgres 16, `prisma db push` + `prisma db seed`.
- Sweep: 69 routes, all HTTP 200. Zero app console errors and zero failed requests, excluding the `/_vercel/*` analytics 404s that only happen locally. Zero horizontal overflow at 390 px. Slowest page about 2 s.
- Lead-reviewer checks:
  - **Seen on screenshots:** the Sentra select covering its trigger, the static "Semua kampus (2)" header, the staff-attendance picker covering the grid, the invoice detail with no student or wali link, the admissions duplicate "Belum bayar", the parent invoice sheet, and the check-in title contradiction.
  - **Read in code:** `app/admin/invoices/invoices-client.tsx:92-107` (student name links to the invoice), `components/ui/select.tsx:111` (`alignItemWithTrigger = true`), `app/admin/layout.tsx:22` (static campus text), and `lib/admin/header-context.ts` (no per-user campus scope).
- design-system: no frontend diff. Findings are judged against `.claude/standards/design-system.html` and the standards files.
- Not run: Vitest and Playwright. The change is docs and images only, with no code path touched.

## Ship Notes

- Docs-only PR into `staging`: one cycle doc, one UAT report, 10 PNGs (340 KB).
