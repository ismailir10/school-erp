# Find updates in Apa yang Baru

## Context

Apa yang Baru opens for each signed-in portal with every matching release in one long list. The initial archive already has 24 releases across four months. A release can include changes across several modules, so readers need a way to narrow the list by month and module without losing their existing audience setting. The November 8 changelog cycle shipped the archive and audience filter. No existing UAT report covers changelog discovery.

## Decisions

- Offer one Bulan filter with month and year together, such as November 2026. List months present in the archive, newest first, with Semua bulan as the default.
- Offer one Modul filter with Semua modul as the default. Give every update item one primary module and show it alongside the existing labels. A release can contain items from several modules.
- Use these module labels: Umum, Pendaftaran, Siswa & Wali, Akademik, Kehadiran Siswa, Buku Penghubung, Penilaian & Rapor, Tagihan & Pembayaran, and SDM. Umum covers maintenance and changes across the app. SDM includes staff attendance.
- Keep newest-first release cards and show at most five matching releases per page. Count releases after filtering so readers can see every matching item without paging through empty cards.

## Acceptance criteria

- [ ] Opening Apa yang Baru retains the viewer's existing audience default and shows the five newest matching releases, or fewer when the audience has fewer results.
- [ ] Selecting a month and year limits releases to that month, including any same-day second promotion. The module filter shows only matching items within each release. Both filters work together with the audience selection.
- [ ] Every historical update has a visible module label. Existing release dates, item wording, and audience tags are preserved. Future release entries require a valid module.
- [ ] When there is another page, Sebelumnya and Berikutnya move through matching releases without duplicates or gaps and show the current page and total. A filter or audience change returns to page one.
- [ ] A combination with no matches explains the empty result and offers a single action to clear the month and module while keeping the selected audience. Controls remain available in the empty state.
- [ ] Filters and pagination have accessible Indonesian labels, work with keyboard input, and fit at 375 px without horizontal scrolling. Changing pages places focus at the new results.

## Verify flows

1. Admin opens Apa yang Baru from the sidebar, selects Semua, and pages forward and back. Verify page size, newest-first ordering, and no duplicate dates across pages.
2. Teacher opens Apa yang Baru on a phone, combines November 2026 with Buku Penghubung, and verifies that only matching updates for teachers or all audiences remain. Switch to Semua and confirm the month and module stay selected while the page resets.
3. Parent selects a month and module with no updates for their audience. Verify the empty state, clear the two filters, and confirm that the parent audience and newest page are restored. On a single-result page, verify there is no extra page to open.

## UX notes

The page opens directly to recent updates. Keep the audience control, then place Bulan and Modul before the results. Selecting a month or module takes two taps each. Advancing a page or clearing empty filters takes one tap. Keep one column for release cards. Use the existing Talib controls, labels, and focus treatment.

## Test seams

Use the changelog filter and data validation tests for combined filters, historical module coverage, same-day IDs, and page boundaries. Update the existing changelog browser test for pagination and the phone flow. No new test suite is needed.

## Non-goals

Full-text search, a separate module page, page-size controls, and an editor for release notes are outside this cycle.

## Assumptions

Five release cards per page, one primary module per update, and all months selected on entry. Filters stay on this page during the visit. Use the existing release archive and signed-in page.

## Gate re-openers

None expected. No new dependency, migration, auth change, or production data write is needed.

## Tasks

- [ ] T1 Tag the release archive and require a valid module for future entries. Update the writing guide and validate the full archive. Reuse the existing release schema and data.
- [ ] T2 Add combined audience, month, and module filters with release pagination. Reuse the existing filter, Indonesian month formatter, and shared UI controls. Depends on T1.
- [ ] T3 Update changelog help and browser coverage, then verify all three flows on the local app. Depends on T2.

## Implementation

- Plan: driver and workers use the session model. T1 archive tagging and schema/fixtures run in parallel. T2 UI and filtering follows T1. T3 browser coverage and documentation follows T2. The driver runs the gates and browser verification.

## Verification

## Ship Notes
