# Parent portal dates on the Asia/Jakarta day

## Context

The 2026-10-07 `admin-dates-wib` cycle (#607) taught `formatDate` / `formatDateShort` to render a full ISO timestamp on the Asia/Jakarta calendar day. It left a documented gap (its Ship Notes, "Known gap"): the parent portal still **pre-truncates** the timestamp with `.slice(0, 10)` before calling `formatDate`, which turns it into a date-only string and brings back the UTC day. A wali who pays at 05:00 WIB on 7 Okt sees the receipt "Diterbitkan 6 Oktober 2026", and a payment row under "Pembayaran" reads one day early, so the receipt date disagrees with the admin kuitansi. It is wider than the first hour of the day: `POST /api/invoices/[id]/payments` stores a backdated payment as midnight +07:00 (`${paidAt}T00:00:00+07:00`), which is 17:00Z the day before, so **every backdated payment** showed a day early on the parent receipt. Same for the raport "Diterbitkan" line. Four call sites remain: `app/parent/report-cards-list.tsx:97` and `app/parent/invoices/invoice-detail-sheet.tsx:354,385` (plus a fourth read of the same pattern at `:193`, which compares a due *date* and is correct; it stays).

The other follow-up named in the handover docs ("copy KK/KTP into the guardian record on convert", "documents on the student detail rail") already shipped in #606 (`lib/enrollment/guardian-copy.ts`, `student-enrollment-application-block.tsx`), so it is **not** in this cycle. This cycle is the small, certain fix plus a guard so the pattern cannot return.

No UAT report covers the parent invoice or raport screens within 60 days; this comes from a known gap in a shipped cycle doc, not a new finding.

## Spec

- [ ] `app/parent/report-cards-list.tsx` "Diterbitkan …" passes the raw `publishedAt` timestamp to `formatDate`. A raport published at `2026-10-06T22:30:00.000Z` reads "Diterbitkan 7 Oktober 2026".
- [ ] `app/parent/invoices/invoice-detail-sheet.tsx` receipt header ("Diterbitkan …", from `invoice.paidAt`) and every payment row date (`p.paidAt`) pass the raw timestamp. Same input → 7 Oktober.
- [ ] Date-only and UTC-midnight values do not shift: `2026-02-05T00:00:00.000Z` and `2026-02-05` both stay "5 Februari 2026" (existing behaviour of `formatDate`, locked by tests here at the parent call sites).
- [ ] The overdue check at `invoice-detail-sheet.tsx:193` is unchanged (`dueDate` is a calendar date).
- [ ] A source-scan Vitest suite fails if any non-test file under `app/parent/**` or `components/parent/**` calls `formatDate`/`formatDateShort` on an argument that ends in `.slice(0, 10)` or `.split("T")[0]`. It passes on the fixed tree and fails on the four old lines (verified by running it before the fix).
- [ ] No visual change: markup, classes and copy are untouched, so `design-system` tokens and layout are unaffected.

**Non-goals**
- Teacher portal and `lib/` helpers that slice dates for *logic* (week keys, calendar math). Their inputs are date columns or already-Jakarta strings; not display bugs.
- Zoneless `T` strings parsed in the process zone (noted in #607; no caller passes one).
- The nightly prod backup failure (issue #554). It needs repository secrets only the owner can set (`docs/runbooks/prod-setup.md` §3); I will flag it, not change workflow files.
- No schema migration, no new dependency, no API change.

**Assumptions I'm making**
1. `invoice.paidAt` and `payment.paidAt` are real instants (a payment is recorded with `new Date()` or an admin-chosen date at UTC midnight); both render correctly through `formatDate` with the raw value. I will confirm against the API serializer in T1.
2. A source-scan test is acceptable here; the repo already has one (`lib/__tests__/primary-text-contrast.test.ts`). If you would rather not have a scan test, drop T2 and nothing else changes.
3. Docs-only classification does not apply (runtime `.tsx` changes), so `/ship` uses local demo-auth browser verification, no signed-in staging check (no auth surface touched).

## Tasks

- [x] **T1 — Pass raw timestamps to `formatDate` in the parent portal.** Edit `report-cards-list.tsx` and `invoice-detail-sheet.tsx` (three sites). Add cases to `app/parent/invoices/__tests__/invoice-detail-sheet.test.tsx` (receipt + payment row at `22:30Z` → next WIB day; UTC-midnight stays) and a render test for the raport row (new `app/parent/__tests__/report-cards-list.test.tsx`). *Accept:* new cases fail on the old code, pass on the new; `npx vitest run app/parent` green. *Depends on:* nothing.
- [x] **T2 — Guard against the pattern returning.** New `app/parent/__tests__/no-prewrapped-date-format.test.ts` scanning `app/parent/**` and `components/parent/**` (excluding `__tests__`) for `formatDate(Short)?(<expr>.slice(0, 10)` / `.split("T")[0]`. *Accept:* run against the pre-fix tree it reports the three sites; green after T1. *Depends on:* T1 (order only; write the test first, watch it fail, then fix).
- [x] **T3 — Cycle bookkeeping.** Fill Implementation / Verification (include `design-system` no-change note and Playwright status) / Ship Notes; run `bash scripts/audit-docs.sh`. *Accept:* audit exits 0. *Depends on:* T1, T2.

## Implementation

- Subagent plan: driver=claude-sonnet-5-5, dirty-work=none; tasks [T1,T2,T3] inline. Reason: three one-line edits plus two small test files, in interlocking order (guard test must fail before the fix and pass after); a subagent would need the whole plan as context. An independent read-only reviewer agent runs on the final diff.
- Task 1: Pass raw timestamps to `formatDate` in the parent portal — `app/parent/report-cards-list.tsx`, `app/parent/invoices/invoice-detail-sheet.tsx` (receipt header + payment rows), tests in `app/parent/invoices/__tests__/invoice-detail-sheet.test.tsx` and new `app/parent/__tests__/report-cards-list.test.tsx` — dropped `.slice(0, 10)` so `formatDate` sees the instant. Note: "Diterbitkan" on the raport only renders on history rows (the newest rapor gets the celebration card), so the raport tests use two terms.
- Task 2: Guard — new `app/parent/__tests__/no-prewrapped-date-format.test.ts` scanning `app/parent` + `components/parent` for `formatDate(Short)?(<expr>.slice(0, 10) | .substring(0, 10) | .split("T")[0])`, plus a self-test of the pattern on shapes it must and must not catch. Written first and run against the unfixed tree: it reported exactly the three sites.
- Review: a read-only reviewer agent was dispatched on the final diff (source + tests + guard); its findings are recorded under Verification.

## Verification

- Red-first: the guard test failed on the unfixed tree with `invoice-detail-sheet.tsx:354`, `:385`, `report-cards-list.tsx:97`. With the two source files reverted, the three shifted-day cases (22:30Z receipt, 22:30Z payment row / raport, 17:00Z backdated payment) failed and the UTC-midnight cases passed; with the fix applied all pass.
- `npm run build` (CI env: `DEMO_MODE=true`, dummy `DATABASE_URL`, `NEXTAUTH_SECRET`) → exit 0.
- `npx vitest run` → Test Files 571 passed | 2 skipped (573); Tests 5738 passed | 42 todo (5780).
- design-system: no markup, class or copy change; only the argument passed to `formatDate`, so the portal shell tokens in `design-system.html` are untouched.
- Review (independent read-only agent on the final diff): no blocking findings. Confirmed all three arguments are always full ISO strings (`lib/parent-helpers.ts` serialisers and `app/api/guardian/invoices/[id]/route.ts` all use `toISOString()`), so `formatDate` always takes the Asia/Jakarta path; `npx vitest run app/parent` also passes under `TZ=UTC`, `TZ=Asia/Jakarta` and `TZ=America/Los_Angeles` (11 files, 109 tests). Two low-severity notes, both accepted: the guard regex also flags `formatDate(dateOnlyString.slice(0, 10))` (harmless, `formatDate` accepts raw date-only input), and it does not see a nested call such as `formatDate(new Date(x).toISOString().slice(0, 10))` (nothing in the scanned roots does this).
- Playwright: local run deferred to CI (env cannot execute it — Postgres 16 binaries are present but the sandbox refuses the privilege switch needed to run a server as a non-root user, and no Docker daemon). Required CI check `Playwright E2E` gates the merge; CTO will not merge on red. The local demo-auth browser route that `/ship` selects for app changes could therefore not be run here; the changed strings are covered by jsdom component tests (`invoice-detail-sheet.test.tsx`, `report-cards-list.test.tsx`).
- `bash scripts/audit-docs.sh` → 0 fail.

## Ship Notes

- **Migrations:** none. No schema or data change; stored values were always right, only display moved.
- **Env vars:** none.
- **Behaviour change to eyeball:** on `/parent/invoices` (invoice sheet) and `/parent/reports`, "Diterbitkan …" and each payment-row date now read on the Asia/Jakarta day. A backdated payment recorded as 6 Okt now reads "6 Oktober 2026" (it showed 5 Oktober before). Date-only and UTC-midnight values are unchanged.
- **Staging check:** none required. No auth, session, cookie or guard code is touched.
- **Rollback:** revert the two commits (`031bbfa`, `cb1c6ff`); nothing else to undo.
- **Not done / follow-ups:** the guard test scans only `app/parent` and `components/parent`. Teacher/admin `lib/` helpers that slice dates for logic (week keys, calendar math) are out of scope. The nightly prod backup failure (issue #554) needs repo secrets and is unrelated to this cycle.
