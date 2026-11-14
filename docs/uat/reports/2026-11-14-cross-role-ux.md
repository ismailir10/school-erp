# UAT report — Cross-role visual and UX audit — 2026-11-14

> Personas: Ibu Nur (admin), Bu Sari (teacher), Pak Budi (parent).
> Target: [Talib staging](https://annisaa-erp-v3-git-staging-ismails-projects-196d40d3.vercel.app). Sign in with the role accounts in the canonical [UAT skill](../../../.claude/skills/uat/SKILL.md#default-target--accounts-staging-mode); no credentials are stored in this report.
> Original audit continuation: staging commit `ee955459763f03e535e943eed4896d685f53a3db`, deployment `dpl_FDT6cx5nBNGEoZXUPYWcYzRk4Ht5`, READY. Earlier sweep and local supplement: `a0afa580e874b776441a818fd28b39446284e144`.
> Coverage: earlier 68 signed-in templates plus help/changelog retained as historical coverage; the continuation adds staging finance, report-publishing, journal, attendance and leave handoffs plus sampled access checks, not another complete sweep. The original continuation confirmed one mobile blocker and three major issues (payment pending-state persistence, journal date/context and unavailable Gate actions); one minor desktop-reader issue, weekend-attendance and fee-label validation candidates plus one provisional timing-major are recorded separately; other earlier recommendations remain qualified.

> Implementation follow-up: [cross-role audit remediation](../../cycles/2026-11-14-audit-remediation.md) tracks fixes and verification. The observations below preserve the original audit evidence; the local implementation status is recorded separately below. [PR #741](https://github.com/ismailir10/school-erp/pull/741) is merged to staging `92787a49eeccbf34cfc5ddfc327e3de79c272ddd`; the replacement deployment is READY. Unicode checkout, report reader/admin preview, admin priority/loading/billing/navigation and retained-fixture parent weekend Home have passed staging rechecks; pending-payment persistence, journal handoff, teacher availability/neutral roster and Mandiri sandbox settlement also passed. Pickup correction and a 1,099ms leave-feedback recheck also passed; parent merchant return and full one-page receipt also passed. Admin leave rejection, pending-invoice cancellation and final teacher/parent cleanup readbacks passed. All implemented findings have deployed verification within the explicit limitations below.

## Summary

The original audit prioritized the mobile Rapor reader: the long-report failure was reproduced on staging `ee955459`, with the title and close control thousands of pixels above the phone viewport. The staging finance journey passed: Rp3.000 cash plus a Rp9.000 DOKU sandbox BCA payment settled the correct Rp12.000 invoice, updated both parent tabs, and produced a receipt PDF. A separate controlled staging test also reproduced the pending-payment reload problem: a synthetic callback showed “tidak perlu bayar lagi”, but reload restored the pay button on the same unpaid balance. No payment or duplicate charge occurred in that second test. The journal date problem is also now reproduced through a staging write/read handoff: a Saturday parent note defaulted to Monday, while the teacher composer for the same child defaulted to Friday. Delivery, edited-note visibility and home-habit persistence worked. Gate also presented an enabled arrival action for an unscheduled child, then rejected it with HTTP 409; the scheduled audit child's arrival, pickup and session correction did persist. Admin loading/count findings were subsequently re-executed in the remediation checkpoint below. Preserve the working payment breakdown, invoice context, receipt access, journal delivery and admin unsaved-report guard.

## Remediation status — 14 November 2026, local verification

The [remediation cycle](../../cycles/2026-11-14-audit-remediation.md) implements the five original recommendation themes in an isolated worktree based on `ee955459`. **The table distinguishes local tests from the deployed checks explicitly recorded below; it is not a blanket staging pass.** Original severity, reproduction evidence and fixture caveats below remain intact. The implementation is deployed; signed-in verification and fixture cleanup passed as recorded at the release checkpoint below.

| Finding / theme | Implemented change and local evidence | Remaining deployed exit |
|---|---|---|
| STG-RAPOR-01 / STG-RAPOR-03; cycle 2 | Shared parent/admin reader bounds phone height, fixes header visibility, focuses the heading and resets scroll on reopen. Local Chromium suite: 5 passed, including 320/390/1280 px geometry, actual scrolling, close/reopen and focus. Admin preview shows current unsaved fields without mutation. | **Closed on staging `92787a49`:** actual published report bounded at 320/390 px and desktop, touch scroll reaches content with fixed header, close/reopen returns to beginning, unpublished sibling remains isolated. Admin unsaved preview/guard passed. PDF opened with correct first-page identity/content; full PDF content remains unverified. |
| STG-FINANCE-02; cycle 1 | Scoped durable pending hints, cross-tab guards and authoritative settlement reconciliation replace memory-only guidance. Cron-first cleared-link expiry is fixed; the latest related finance run passed 8 suites/227 tests. | When the precheckout baseline is lost/blocked and partial credit already exists, invoice-level DOKU lookup cannot correlate the current attempt. The completed, regression-protected fallback keeps the warning/no Pay and directs the guardian to tata usaha with invoice/contact information; no automatic recovery is claimed. **Persistence closed on staging `92787a49`:** synthetic unresolved warning/no Pay survived reload, sibling roundtrip and separate tab, with no warning on Hafizh or unrelated INV-2026-0082. Mandiri settlement subsequently passed with independent ledger/webhook confirmation; parent merchant return and full one-page receipt subsequently passed, while the unrelated pending invoice retained its warning. Failure/expiry/race edges remain automated coverage. |
| STG-FINANCE-04 | During remediation, root reproduced the ordinary UI path on the unchanged staging deployment: Unicode fee `cmwg2cr3o000007jvsqiw6i2k`, manual invoice `cmwg2is38000007jmkx6krpwi` / **INV-2026-0082**, Rp5.000, rejected by DOKU with HTTP 400. Provider-boundary normalization and diagnostic parsing now have regression tests. This supplements the earlier candidate; it does not rewrite its original evidence. | **Closed on staging `92787a49`:** unchanged Talib label retained; actual DOKU cart showed normalized name, correct invoice, quantity 1 and IDR 5,000. No payment was attempted in that checkout. |
| STG-GATE-01; cycle 3 | Schedule-aware availability explains disabled actions before tapping while preserving legitimate lazy session generation. Endpoint/schedule/UI tests cover closed days, holidays, existing sessions and scope. Local Chrome showed disabled closed-day rows with explanation. | **No-session defect closed on staging `92787a49`:** Bilal Hakim disabled with explanation; existing audit Saturday session eligible. This preserves the fixture caveat and does not establish ordinary weekday lazy-generation behavior. Pickup correction saved and survived reload while the other 10 unrecorded rows stayed unchanged. |
| STG-ATTENDANCE-01 / STG-ATTENDANCE-02; cycle 3 | Unrecorded rows are neutral; saves still affect changed rows. Pickup says **Catat pulang** and explains immediate departure. Parent Home queries weekend records and distinguishes no session from missing attendance. Teacher Home uses schedule-aware neutral viewing actions; local Saturday Chrome check passed. | **Parent weekend Home passes on the retained fixture:** audit child Hadir; Bilal/Hafizh Tidak ada sesi. Keep the synthetic weekend/calendar caveat. Teacher Home priority and 10 neutral Belum dicatat rows also passed. Only audit pickup was edited and the button showed **1 perubahan**; save/reload readback passed with the revised name and other 10 neutral rows unchanged. |
| STG-JOURNAL-01 / STG-JOURNAL-03; cycle 4 | Composer names child/audience/date and uses the latest applicable date, with explicit not-today/edit-date explanation. Drafts survive equal-week refetches and failed saves. Composer suite 16/16 passed, including retry without false success and permission-specific failure. Local Chrome offline save retained 67 characters; online retry saved the Friday note and teacher readback matched. | **Journal context/delivery closed on staging `92787a49`:** parent Friday 13 child/audience/not-today copy, save→edit, and teacher deep-link exact readback passed. Teacher composer showed the same date and wali audience, then was cancelled. New teacher reply, sibling failure scenarios and offline retry remain bounded by earlier/automated evidence. |
| Earlier admin dashboard/loading/billing recommendations; cycle 5 | Named work precedes summary tiles; loading/failure differs from true zero; one-student/group billing choice is explicit. Local dashboard action moved to y=299.5 at 390×844 versus staging baseline y=860.125. Local chooser and search→detail→back passed. URL tests 7/7 and detail suite 64/64 passed; independent review cleared sort restoration and interleaved URL updates. | **Admin priority closed on staging `92787a49`:** first Tinjau draf action top 299.5 / bottom 335.5 at 390×844, fully visible. Initial delayed-count, billing-choice and invoice search-return checks also passed on staging; failed-refresh behavior remains covered by automated tests, not a new deployed injection. |
| STG-FINANCE-01 / STG-FINANCE-03 / STG-RAPOR-02 / STG-JOURNAL-02 / STG-ATTENDANCE-03 / STG-LEAVE-01 / STG-ACCESS-01 | These were passing or bounded positive observations to preserve. Existing tests and focused changed-flow tests run locally; no new deployed pass is inferred. | Current money/receipt, actual merchant return, unsaved guard and selected attendance checks passed as recorded below. New leave rejection is confirmed in admin/database and teacher Home/leave sheet with 12/12 restored. Habit and access checks are not newly claimed by this row. |
| STG-PERF-01 | The isolated 1,521 ms leave-feedback sample remains a qualified timing-major. No performance optimization or improved production latency is claimed. | **Not reproduced in the current staging sample:** valid leave submission→dialog hidden and observed success toast each 1,099ms, below 1,500ms. One warm host-timed sample, not a benchmark or optimization claim; preserve the original 1,521ms observation. |

**Integration checkpoint:** all implementation slices passed independent review and final local gates. Production build, lint and typecheck passed. Complete serial units: **774 passing files / 9,522 tests**, 2 existing skipped files and 42 todo (659.42 seconds). Final full Chromium suite: **298 passed / 1 existing skip, no failures or flaky retries (6.4 minutes)**; the invoice layout/retry cases also passed 15 consecutive executions. Hooks 32, documentation regression checks 7, workflow checksum, RLS 51/51 and API auth 239/239 passed. Test corrections preserved business assertions, with no added skips or timeout increases. The exact verified revision and screenshots are in the cycle. **PR checks passed, deployment is READY, and the signed-in changed-flow verification below passed**; this local checkpoint does not claim complete coverage of broader untested workflows.

## Staging release verification — passed with stated qualifications

[PR #741](https://github.com/ismailir10/school-erp/pull/741) merged to staging at **`92787a49eeccbf34cfc5ddfc327e3de79c272ddd`**, with the same tree as verified PR head `12f2156`. Required CI passed, including **9,522 unit tests** and **298 E2E passes / 1 existing skip**, with no flaky retries. Vercel deployment **`dpl_5GM8an66GAV8AD6ZTTt8g13LkF46` is READY**; the following Chrome checks ran on that exact deployment.

- **STG-FINANCE-04 closed:** admin retried unchanged **INV-2026-0082** (`cmwg2is38000007jmkx6krpwi`). The link changed **Link gagal → Link dibuat**, and Talib retained **SPP — UAT November**. Actual DOKU checkout showed the correct invoice ID, **SPP - UAT November**, **1 × IDR 5,000**, total **IDR 5,000**. No payment method was selected; the tab was closed. This proves provider-boundary compatibility and original-label preservation, not settlement or return handling.
- **Cycle 5 admin priority closed:** at 390×844, first **Tinjau draf** action top **299.5**, bottom **335.5**, is fully visible without scrolling, compared with baseline top **860.125**. The subsequent initial-count, billing-choice and invoice return-context checks also passed; failed-refresh behavior remains automated coverage.
- **Fixture progression:** admin next recorded synthetic **CASH Rp1,000**, reference **UAT-20261114-remediation-cash**, on INV-2026-0082. Status is **PARTIALLY_PAID**, remaining **Rp4,000**. The Rp5,000 checkout inspection preceded this change; no gateway payment is claimed by these observations.

- **STG-RAPOR-01/STG-RAPOR-03 and admin preview pass:** after parent Google sign-in, the actual long report at 390×844 measured top **42.203**, height **801.797**, title **59.203**, close **55.203**. The last section/PDF were reachable and the header stayed fixed. At 320×740, top **37**, height **703**, title **54**; a touch scroll moved the opening heading to **−287** while the header stayed fixed. Escape→reopen restored opening position **141**. Desktop 1440×900 right sheet: x **768**, width **672**, height **900**. Hafizh remained **Rapor belum terbit**. Admin's temporary unsaved opening appeared in the shared preview with explicit not-saved notice; Back triggered **Keluar tanpa menyimpan?**, and the edit was discarded. PDF opened a two-page viewer with correct audit child/class/term and the original opening on the inspected first page; this is not a full PDF-content audit.
- **Remaining cycle 5 UI checks pass within the sampled paths:** **Buat Tagihan** offered **Satu siswa** and **Per kelas / beberapa siswa**. Invoice search→detail→Kembali preserved `?q=INV-2026-0082`. Artificial **700ms** latency showed **Memuat jumlah siswa…** and dashes before **41 siswa**; normal networking was restored. A failed-refresh injection was not repeated on staging; its coverage remains automated.
- **STG-ATTENDANCE-02 retained-fixture recheck passes:** parent Saturday Home showed audit child **Hadir**, with **2 days** of attendance, and Bilal/Hafizh **Tidak ada sesi**. The synthetic Saturday session/calendar limitation still applies; this confirms correct presentation of its stored attendance, not general weekend eligibility.
- **Historical local timing samples not reproduced:** Bilal Home overdue→loaded list took **1,379ms**, direct audit invoice page **782ms**, as host-observed upper bounds including tool overhead. These do not replace browser-instrumented page-load measurements or support an optimization claim; the earlier local 4.45s/4.52s observations remain historical.

- **STG-FINANCE-02 persistence passes:** controlled `paymentStatus=paid` return for `uat20261114_pending_invoice` displayed warning/staff recovery with no Pay. The warning survived hard reload, switching to Hafizh and back, and opening a separate Chrome tab for the same child; that detail had **0 Pay actions**. Hafizh showed no pending warning, while unrelated **INV-2026-0082** still offered **Bayar Rp4,000**. The extra tab was closed. This is a synthetic unresolved callback with no actual payment, not a delayed-webhook settlement claim.
- **Mandiri sandbox settlement passes:** following two BCA inquiry responses **Transaction Not Found**, Mandiri Inquiry and Pay Now succeeded on the same Rp4,000 checkout. Independent finance readback confirmed INV-2026-0082 **PAID Rp5,000**, exactly **CASH Rp1,000 + DOKU Rp4,000**, webhook **PROCESSED**, and unchanged control INV-2026-0081. Parent return/receipt subsequently passed as recorded below. The BCA inquiry limitation is provider-specific sandbox evidence; do not label the whole BCA integration failed or invent a BCA debit.
- **STG-JOURNAL-01 current recheck passes:** parent composer named the audit child/DCARE and audience **Ustadzah**, defaulted to **Friday 13 November** with explicit not-today copy. Parent saved then edited **UAT-20261114-REMEDIATION**. Teacher Home **Balasan wali Anak Audit** opened the exact edited note/date. Teacher add composer used Friday 13 and wali audience; it was cancelled without posting a new reply.
- **STG-GATE-01 and teacher clarity pass:** DCARE was the Home class priority. Bilal Hakim was disabled in Gate with no-session explanation; the existing audit Saturday session remained eligible. Session showed **10 other rows Belum dicatat**, neutral. Editing only audit pickup to **UAT Penjemput Audit — verifikasi perbaikan** produced **1 perubahan**; saving showed **Semua perubahan tersimpan** and reload preserved the revised name, with the other **10 Belum dicatat** rows unchanged.

- **STG-PERF-01 not reproduced in this remeasurement:** valid annual leave for **16 November**, **UAT-20261114-REMEDIATION-LEAVE**, reached dialog hidden and observed **Pengajuan cuti terkirim** at **1,099ms**, measured from host Date.now immediately before click with parallel waits. This is below the 1,500ms major/3,000ms blocker thresholds, but remains one warm host-timed observation, not a performance benchmark or evidence of an optimization. The original 1,521ms sample remains preserved below. History showed **Menunggu**, **11/12**, **1 pending**. Earlier automation-native date fills had not dispatched React change events; validation stopped submission, then native arrow-key events produced the correct **1 hari kerja** before the measured request. Admin rejected the request with success toast; independent database readback confirms **REJECTED**, annual available balance **12**. Teacher Home subsequently showed the exact new rejection reason, and `/teacher/attendance?cuti=1` showed **12/12** plus the new request **Ditolak**.

- **Parent payment/receipt handoff passes:** actual DOKU **Kembali ke merchant** returned to the correct audit child, auto-opened **INV-2026-0082**, showed success toast and **Lunas Rp5,000**, history **VA Rp4,000 + Tunai Rp1,000**, and no Pay. The unrelated Rp5,000 pending fixture still showed its warning. The one-page receipt PDF showed correct child/class/period and original em-dash line, due/paid **Rp5,000**, remainder **0**; its bottom showed both history rows and **LUNAS Rp5,000**. This completes current sandbox partial-cash→gateway remainder→merchant return→receipt verification without clearing a separate unresolved invoice.
- **Attendance independent readback:** exactly **1 audit attendance row**, **0 other roster rows**, with existing timestamps preserved after the pickup-name correction.

**Final fixture cleanup passed:** leave **`cmwg683cq000008jjdcz78vaf`** is **REJECTED**, annual available balance **12** independently confirmed. Teacher Home showed the exact new rejection reason; `/teacher/attendance?cuti=1` showed **12/12** and the new request **Ditolak**. Admin cancelled **`uat20261114_pending_invoice`**: **Dibatalkan**, link cleared, no active payments. Fresh parent navigation showed audit child **Lunas**, **0 pending warnings**, and the paid receipt still in history. These terminal cleanup states supersede the deliberately pending states used above.

All implemented findings have been verified on the deployed changed paths with the qualifications stated here. Untested paths and automated-only error/expiry/race cases are not promoted to live passes; the BCA simulator inquiry limitation remains provider-specific, while Mandiri settlement/return/receipt passed. A bounded fresh parent-invoice reload captured **64 responseReceived**, **0 HTTP4xx/5xx**, **0 loadingFailed**, complete capture (`hasMore=false`, not truncated), with current console errors/warnings empty. The earlier long session network buffer was truncated, so this does not establish whole-session network cleanliness. No full checkout URLs or tokens are stored here. Original audit sections below remain unchanged.

The follow-up PR changes documentation/screenshots only. Build and full E2E are skipped for that follow-up because runtime is unchanged from the locally/CI-verified deployed merge; documentation and link checks are run separately.

### Staging evidence index

Highlights: [readable mobile report](assets/2026-11-14-audit-remediation/staging-rapor-390-opening.jpg) · [correct paid invoice](assets/2026-11-14-audit-remediation/staging-parent-paid.jpg). Screenshots supplement the exact measurements and limitations above; they do not establish unobserved timing or full report-PDF contents.

| Workflow | Evidence |
|---|---|
| Report reader | [390 opening](assets/2026-11-14-audit-remediation/staging-rapor-390-opening.jpg) · [390 last section](assets/2026-11-14-audit-remediation/staging-rapor-390-last.jpg) · [320 opening](assets/2026-11-14-audit-remediation/staging-rapor-320-opening.jpg) · [320 last section](assets/2026-11-14-audit-remediation/staging-rapor-320-last.jpg) · [desktop](assets/2026-11-14-audit-remediation/staging-rapor-desktop.jpg) · [PDF first page](assets/2026-11-14-audit-remediation/staging-rapor-pdf.jpg) |
| Admin priority and preview | [mobile dashboard](assets/2026-11-14-audit-remediation/staging-admin-mobile.jpg) · [unsaved preview](assets/2026-11-14-audit-remediation/staging-admin-preview.jpg) |
| Unicode label compatibility | [before remediation](assets/2026-11-14-audit-remediation/staging-unicode-before.jpg) · [Talib label retained](assets/2026-11-14-audit-remediation/staging-unicode-after.jpg) · [normalized DOKU cart](assets/2026-11-14-audit-remediation/staging-doku-unicode-cart.jpg) |
| Payment handoff | [partial cash](assets/2026-11-14-audit-remediation/staging-partial-cash.jpg) · [persistent warning](assets/2026-11-14-audit-remediation/staging-pending-reload.jpg) · [Mandiri success](assets/2026-11-14-audit-remediation/staging-doku-payment-success.jpg) · [paid invoice](assets/2026-11-14-audit-remediation/staging-parent-paid.jpg) · [receipt](assets/2026-11-14-audit-remediation/staging-parent-receipt.jpg) · [cancelled pending fixture cleared](assets/2026-11-14-audit-remediation/staging-pending-cleared.jpg) |
| Journal | [parent edit](assets/2026-11-14-audit-remediation/staging-journal-edit.jpg) · [teacher readback](assets/2026-11-14-audit-remediation/staging-journal-teacher-readback.jpg) |
| Teacher attendance | [Home priority](assets/2026-11-14-audit-remediation/staging-teacher-home.jpg) · [unavailable Gate row](assets/2026-11-14-audit-remediation/staging-gate-no-session.jpg) · [neutral roster](assets/2026-11-14-audit-remediation/staging-session-neutral.jpg) |
| Leave timing and cleanup | [submitted request](assets/2026-11-14-audit-remediation/staging-leave-submitted.jpg) · [rejection and restored balance](assets/2026-11-14-audit-remediation/staging-leave-restored.jpg) |

## Coverage and method — earlier baseline at `a0afa580`

- **Admin on staging:** 47 distinct screens: dashboard and work queue; admissions, enrollment review, students, guardians, classes and sentra; attendance and journal; assessments and reports; invoices and receipts; staff, leave and payroll; settings, roles, academic years, semester themes, import, learning objectives and the design reference. The legacy enrollment list redirects to Pendaftaran. Opened record actions, forms, and tabs where relevant. Desktop plus eight priority screens at both 390×844 and 320×740.
- **Teacher on staging:** 13 distinct screens: Home, Gerbang, class and own attendance, journal overview/day/student, assessment overview/weekly/sentra, slips and slip detail, and profile. Seven priority screens repeated at 320×740. No session detail link on the observed Saturday; the direct sessions entry redirects to Home. Tested scheduled session detail with a synthetic local fixture instead.
- **Parent on staging:** Eight route templates at phone width: Home, Tagihan, Kehadiran, Jurnal, Rapor, Profil, Perkembangan entry and its child detail. The Perkembangan entry resolves to the selected child. Visited the parent guide and changelog, switched siblings, opened unpaid detail and paid history, and opened the note composer. Neither linked child had a published report. Public invite, signature, and payment routes were outside the signed-in sweep and require a test invitation.
- **Local journey tests:** Teacher check-in → admin approval → teacher refresh; Gate arrival and pickup → class session; parent note → teacher, with the saved date checked; admin cash entry → parent invoice detail and partial receipt; seeded long report and PDF response; simulated payment return and hard reload. No staging record writes, live gateway payments, or outbound messages. Staging Google sign-in was exercised for all three accounts.
- **Lens:** [Steve Krug, *Don’t Make Me Think*](https://sensible.com/dont-make-me-think/). At first glance, can I tell where I am, whose record I’m seeing, what I can do next, and whether it worked? Inspect headings and button prominence, labels and affordances, dates and entity context, feedback after clicking, and whether back/reload preserves meaning. One example per detail template; the sweep did not visit every student, invoice, or permutation.

## Staging continuation — 14 November 2026

This section supersedes the evidence status of the earlier recommendations where explicitly stated. The staging alias was rechecked at 15:51:41 JST and still resolved to the same READY deployment. Current target: `ee955459763f03e535e943eed4896d685f53a3db`, deployment `dpl_FDT6cx5nBNGEoZXUPYWcYzRk4Ht5`. Chrome drove staging workflows; subagents prepared additive fixtures, checked the deployed source and independently read back settlement. The source checkout is older (`45d7329a`), so code references below describe the deployed commit, not the files currently checked out.

**Time accounting:** 14:14–15:53 JST (05:14–06:53 UTC), approximately 99 minutes elapsed. Three synchronous tool stalls consumed about 53m14s, leaving approximately **46 minutes of productive audit work**, including Chrome testing, fixture/source checks and documentation/review. This was not 45 uninterrupted minutes of browser testing. Tool stalls are excluded from product timings; native screenshot export and CSV download verification remained unavailable/inconclusive. Temporary viewport overrides were restored after browser testing.

### STG-RAPOR-01 — Long published report opens beyond the phone viewport

**Persona:** Pak Budi, with Ibu Nur publishing. **Completed:** partial. **Severity:** blocker for reading the complete report in the mobile reader. **Evidence:** current staging, 390×844 and 320×740, synthetic long report; [observation transcript](assets/2026-11-14-cross-role-ux/staging-followup-evidence.txt).

Admin published the eight-section report for **UAT 14 Nov — Anak Audit**. Parent selected that child on `/parent/reports` and tapped **Buka rapor**. The visible reader showed only the final section, attendance, hafalan and PDF action. The dialog measured **4,320.97 px high**, starting at **y=−3,476.97**; title at **y=−3,451.97**, close control at **y=−3,463.97**. Its `clientHeight` and `scrollHeight` were both 4,320 px, giving the measured dialog no internal scroll range. The screenshot was displayed during the session; this report does not claim an exported staging PNG.

A subsequent staging recovery attempt using **Control+Home** and **PageUp** left dialog top at −3,476.97 px, title at −3,451.97 px and `scrollTop=0`; it did not reveal the beginning. **Escape closed the reader**, so keyboard dismissal works despite the off-screen touch-close control. At **320×740**, the dialog measured **5,096.97 px high**, top **y=−4,356.97**, title **y=−4,331.97**; `clientHeight=scrollHeight=5096`. A touch scroll gesture at x=160, y=300 with a 500 px distance left the dialog/title positions unchanged and `scrollTop=0`. Computed style confirmed `side=bottom`, height 5,096.97 px, `maxHeight=none`, `overflowY=auto`, position fixed; no winning CSS rule was captured. The reader failure is therefore reproduced at both phone widths, including touch recovery. Reopening reproduced the same bad initial position. **Unduh PDF** opened `rapor-uat-14-nov-anak-audit-triwulan-1.pdf`; its visible first page identified the correct synthetic child, DCARE and Triwulan 1, with the opening narrative and Nilai Agama, Jati Diri and STEAM sections. The PDF viewer had horizontal overflow at 390 px, so this is a working alternative download/first-page check, not a pass for full mobile PDF reading or every page/content item. The blocked job is reading the complete report in this mobile reader, not every possible escape or PDF alternative.

**Likely source cause, still a hypothesis:** `app/parent/report-cards-list.tsx:115` supplies plain `h-[95dvh]`, while `components/ui/sheet.tsx:56` supplies `data-[side=bottom]:h-auto`. Attribute-selector specificity could explain growth to content height; verify computed CSS before implementing. Both files are unchanged between the earlier and current staging revisions.

**Fix and exit tests:** bound the reader to the viewport, start at the first line, keep child/period and close controls visible, and use the same reader for admin preview. With this fixture, read every section and return to the beginning at 320×720 and 390×844; close by touch and keyboard; reopen at the beginning; switch siblings; preserve PDF access and unpublished states.

### STG-FINANCE-01 — Partial cash and sandbox payment settle the correct invoice

**Result: passed for this success path; no new finance defect observed.**

1. Admin created **INV-2026-0081** for Bilal: SPP Rp10.000 plus meal Rp2.000, total Rp12.000. The payment review showed the intended values; recording Rp3.000 cash persisted.
2. Parent at 390×844 saw Rp9.000 remaining, the partial payment and receipt affordance.
3. **Bayar Rp9.000** opened actual DOKU sandbox checkout. BCA Virtual Account was selected; the sandbox simulator's Inquiry and Pay Now actions reported success.
4. DOKU displayed success. **Kembali ke merchant** returned to Talib's correct invoice, **Lunas Rp12.000**, with separate Rp9.000 VA and Rp3.000 cash entries. Receipt PDF rendered.
5. The original parent tab independently updated to paid without manual reload. No wrong-child or wrong-invoice settlement was observed.

Independent staging readback confirmed invoice `cmwfyfx9q000008l2ddrq97gh`: `PAID`, `totalDue=12000.00`, `totalPaid=12000.00`. Cash payment `cmwfygi3d000408l2xetb7m4d` was 3000.00; DOKU payment `cmwfzi86c000108l6ingdkfdx` was 9000.00 via `VIRTUAL_ACCOUNT_BCA`. Webhook `cmwfzi7z2000008l6wyk3mw3g`, event ID `434f013f-7c1d-4b15-b8a9-ec88f0dab6ab`, was `doku.SUCCESS`, `PROCESSED`, with no error. Settlement was recorded at **14:47:54 JST**. This was sandbox settlement, not a real-bank payment.

Preserve the amount-bearing pinned action, partial balance, payment breakdown, correct invoice on return, original-tab freshness and receipt. This successful checkout does not cover delayed/lost/duplicate webhooks, expiry, cancellation or gateway errors. Pending-state reload was tested separately with a synthetic callback, described next. The current CTA is **Bayar Rp …**, replacing the earlier **Bayar sekarang** wording.

### STG-FINANCE-02 — Pending confirmation disappears after reload

**Persona:** Pak Budi. **Completed:** no for preserving unresolved-payment guidance. **Severity:** major, with duplicate-payment risk but no duplicate charge observed. **Evidence:** current staging, controlled synthetic callback; inline before/after screenshots and [transcript](assets/2026-11-14-cross-role-ux/staging-followup-evidence.txt).

Use the synthetic unpaid invoice `uat20261114_pending_invoice` / **UAT-20261114-PENDING**, Anak Audit, Rp5.000, with no actual payment. Navigate to `/parent/invoices?child=uat20261114_student&invoice=uat20261114_pending_invoice&paymentStatus=paid` to simulate the application's unresolved return state. The correct sheet opened with **Rp5.000**, **Belum dibayar**, and **Pembayaran sedang diperiksa. Status akan diperbarui otomatis — tidak perlu bayar lagi.** The footer offered **Muat ulang status** and no Bayar action. The callback parameters were removed while the child parameter remained.

Hard reload, then reopen the same invoice: **Rp5.000** and **Belum dibayar** remained unchanged, but the pending message disappeared and **Bayar Rp5.000** returned, alongside the no-link school-contact alert. The UI therefore reverses its own no-repeat-payment instruction without an observed balance change.

This is a staging reproduction of lost client pending state, **not** a delayed real webhook, genuine paid return or duplicate debit. The independent INV-2026-0081 sandbox settlement remains a passing result. Current `app/parent/invoices/client.tsx:108,184–213` stores `pendingPayments` in component memory and removes callback parameters; that is a source-supported cause candidate.

**Suggestion and exit tests:** persist the unresolved attempt against invoice and child, then reconcile it to authoritative payment state. Repeat reload, close/reopen, sibling switch and new-tab entry under controlled unresolved confirmation; ensure the correct invoice never invites another payment solely because the component remounted. Separately test real delayed, failed, expired, partial and duplicate callbacks before claiming gateway robustness.

### STG-FINANCE-03 — Unpaid checkout creation and merchant return preserve context

**Result: passed after a fixture-label adjustment; no payment attempted.**

After the synthetic line label was normalized to **SPP Bulanan**, **Bayar Rp5.000** created a payment link and navigated the same tab to DOKU with the correct invoice `uat20261114_pending_invoice` and **IDR 5,000**. No payment method was selected and no payment was made. **Kembali ke Merchant** ultimately returned to `/parent/invoices?child=uat20261114_student` and opened the same Rp5.000 unpaid invoice with its generated link. There was no false pending-paid message. A transient default-child shell settled to the correct child and is not classified as a defect.

This verifies retry after the controlled fixture adjustment and an unpaid checkout-to-merchant return. It is not an automatic application recovery from the rejected label, a gateway failure outcome, or a completed cancellation/refund transaction. Preserve correct child/invoice context and the distinction between unpaid return and unresolved paid return.

### STG-FINANCE-04 — Fee-label validation may permit gateway-rejected text

**Status:** ungraded validation-gap candidate; full user-interface reproduction not completed.

DOKU returned a 400 validation rejection for the synthetic invoice's em-dash-containing line label; normalizing the line to **SPP Bulanan** allowed the subsequent checkout retry. Source inspection of `ee955459` found a plausible ordinary input path: `/admin/fees` offers a free-text **Label**; `lib/validations/fee-component.ts` create/update schemas trim and require 1–120 characters without excluding Unicode; manual-invoice creation copies `FeeComponentDef.label` to `labelSnapshot`; `sessionLineItems` in `lib/payments/session.ts` forwards the label toward DOKU `order.line_items.name`.

This source path suggests a validation mismatch, but no fee was created through the UI to reproduce it. Do not generalize the fixture rejection to all Unicode labels or all payment channels. Next isolated test: create a dedicated fee labeled **SPP — UAT**, create its manual invoice, open parent **Bayar**, and compare an otherwise equivalent ASCII-label control; retain the exact gateway validation response. Choose normalization or input guidance only after confirming the actual gateway constraint.

### STG-RAPOR-02 — Admin unsaved-report guard works

**Result: passed.** Attempting navigation after draft edits displayed the unsaved-changes guard. Cancelling navigation preserved the fields. Current `app/admin/report-cards/raport-editor.tsx` also contains the shared app-shell navigation guard. Preserve this behavior; do not carry an older missing-sidebar-guard claim into a fix cycle.

### STG-RAPOR-03 — Desktop report starts at the bottom

**Persona:** Pak Budi. **Completed:** yes, after manual recovery. **Severity:** minor, recoverable start-position friction; separate from the mobile blocker.

At 1280×900, the open report switched to a right panel x=608, width=672, y=0, height=900, `scrollHeight=2742`, with title y=32. Unlike the mobile reader, desktop had a usable scroll range. With the PDF control focused, **End** moved to `scrollTop=1842`. After **Escape** then **Buka rapor**, the reader reopened at the same `scrollTop=1842`, title y=−1810 and PDF control active; a fresh snapshot retained that state.

A fresh hard reload followed by **Buka rapor** also opened at `scrollTop=1842`, title y=−1810, with **Unduh PDF** active. A 2,200 px upward mouse scroll recovered `scrollTop=0` and title y=32. The observed issue therefore affects fresh opening as well as reopening, but the desktop reader is scrollable and recoverable. PDF autofocus is a source/focus hypothesis, not an isolated cause. Keep this minor refinement within the reader work rather than opening a standalone fix cycle.

**Sibling report check passed:** switching to Hafizh showed the correct KB 1 context and **Rapor belum terbit**, with no **Buka rapor** action; switching back to Anak Audit restored the published report. Preserve this isolation while changing the reader.

### STG-JOURNAL-01 — Saturday parent note defaults to Monday; teacher defaults to Friday

**Personas:** Pak Budi and Bu Sari. **Completed:** yes, with misleading date context. **Severity:** major. **Evidence:** current staging composer, real note create/edit and teacher readback; [observation transcript](assets/2026-11-14-cross-role-ux/staging-followup-evidence.txt).

On Saturday 14 November, parent selected **UAT 14 Nov — Anak Audit** and opened **Tulis catatan**. The composer did not name the child and preselected **Monday 9 November**. Saving a unique `UAT-20261114-PARENT` note put it in the thread under **9 Nov**, with time displayed as **13.10**. Editing preserved that date in a disabled field; the amended body saved.

The teacher signed in through Google as `ismail10rabbanii@gmail.com`. Home showed **Balasan wali** for **Anak Audit**, **DCARE**, **1 baru**; its link opened the correct child's thread containing the edited parent note under Monday 9 November with the **Orang Tua** badge. The teacher's **Tambah catatan untuk UAT 14 Nov — Anak Audit** composer explicitly named the child and defaulted to **Friday 13 November**. A uniquely tagged `UAT-20261114-TEACHER` reply saved. Parent subsequently saw its Home excerpt, the **Catatan sekolah** entry for Friday 13 November on attendance, and **Catatan · 1 baru** in Jurnal. The thread showed the reply as **Ustadzah**, **13 Nov · 13.12**, alongside the parent’s edited Monday 9 November note. Both directions delivered to the correct child.

This is an inconsistent default and context problem, not failed delivery: both interfaces saved their selected dates, and the teacher received the correct child and amended body. The source fallback in `components/student-journal/note-compose-dialog.tsx:60–68` selects the first option when today is absent; parent create supplies no initial date, while the teacher supplies `computeDefaultNoteDate`, which chooses Friday outside weekdays. The visible date mismatch is staging-observed; this source analysis explains a likely path rather than replacing the observation.

**Suggestion and exit tests:** show the child and chosen date at entry and confirmation; use a deliberate, consistent non-school-day default or require an explicit choice. Create, edit and read notes from both roles on a weekday and weekend, with two siblings; verify correct date, author and recipient after reload. Preserve the working unread reply link and own-note editing. Because note date is disabled during edit, make the initial choice unmistakable and decide how a user corrects an accidental date.

### STG-JOURNAL-02 — Home habit persists and teacher can read it

**Result: passed.** Parent checked **Membantu orang tua** for **Friday 13 November**; the tick survived reload. Teacher opened the same child's **Di rumah** week and saw that Friday habit filled and read-only. A hard reload was needed to refresh the newly seeded child list before the audit; that setup/cache transition is not classified as a product defect.

### STG-JOURNAL-03 — Sibling isolation and draft-discard protection work

**Result: passed at 390 px.** Anak Audit's **Catatan** showed both UAT notes. Switching to Hafizh showed the correct **KB 1** context and **Belum ada catatan**, with neither audit note leaking into the sibling thread. Hafizh's **Tulis catatan** still omitted the child name and defaulted to Monday 9 November, independently repeating STG-JOURNAL-01's context/default issue.

Typing the unsaved marker `UAT-20261114-DRAFT-CANCEL — tidak disimpan.` then choosing **Batal** opened **Buang catatan?**, with **Lanjut menulis** and **Buang**. **Lanjut menulis** retained the text. Repeating Batal and choosing Buang removed the draft; reopening showed an empty composer, **0/2000**, with **Simpan** disabled. No note was posted in this test. Preserve the discard guard, recoverable draft text and sibling isolation.

### STG-GATE-01 — Enabled arrival action rejects a child with no session

**Persona:** Bu Sari. **Completed:** no for the unscheduled arrival; backend correctly refused to create unsupported attendance. **Severity:** major for the misleading available action. **Evidence:** current staging Saturday, actual Chrome click and network response.

Gerbang offered an enabled **Masuk** action for existing **Bilal**, **TK A 1**. Clicking it returned HTTP **409**, body **Belum ada sesi kelas hari ini**. The response-headers timing field `receiveHeadersEnd` was 782.525 ms; this is not a complete response-body or click-to-visible measurement. No toast was captured, so the audit makes no claim that error feedback was absent. The defect is offering an unavailable workflow as actionable; the 409 protection is appropriate.

Current `app/teacher/gate/client.tsx` disables a row only while busy; the GET payload has no session-availability flag. The POST route attempts session reconciliation then returns this 409 if no session exists. **Suggestion:** expose the no-session/non-school-day state before the tap, with a clear next step. Exit tests must include both real scheduled days and genuine no-session days; the special audit session does not validate ordinary calendar generation.

### STG-ATTENDANCE-01 — Scheduled Gate arrival/pickup and session correction persist

**Result: passed through teacher and admin views; parent Saturday Home does not reflect the recorded attendance (fixture-conditioned follow-up below).**

- Teacher Home initially showed **0/11**. The session roster displayed all 11 rows as green **Hadir** by default. Changing only Anak Audit to **Sakit** displayed **Belum disimpan · ketuk Simpan absensi** and a button for **1 perubahan**. Navigation triggered the guard; discarding left this trial change unsaved.
- In Gerbang, the seeded **Anak Audit** session accepted arrival; the updated state appeared after 559 ms and showed **13.14 WIB**. In **Pulang** mode, **Ubah penjemput** → other-name entry → **Simpan** immediately recorded departure with `OTHER` and **UAT Penjemput Audit**.
- Session detail showed both arrival and departure at **13.14 WIB** and the named pickup. Editing the name to **UAT Penjemput Audit — revisi sesi** then saving **1 perubahan** showed **Semua perubahan tersimpan** after 533 ms; reload retained the amended name.
- Class attendance showed **Hadir 1**, **10 belum**, with only Anak Audit checked. This confirms the other green defaults had not all been saved. Current source sends changed session rows; do not describe the initial green roster as proof of persisted attendance or mass overwriting.

Admin daily attendance then showed one Anak Audit **Hadir** row. Admin used **Timpa** to keep the same Hadir status and add an audit note; monthly search for **UAT** showed Hadir 1, Sakit 0, Izin 0, Alpa 0, total 1. An **Ekspor CSV** click could not be verified because the automation download wait hung; export is inconclusive, not an application defect.

Preserve the dirty-state message, changed-row count, navigation guard, save confirmation, reload persistence and matching admin recap. **Candidate copy ambiguity, not a separate graded defect:** pickup-picker **Simpan** also completed departure rather than merely saving who would collect the child. A follow-up should check whether the surrounding context sufficiently announces that consequence and whether **Catat pulang** would be clearer. The displayed default **Hadir** remains a distinction worth testing with users against the actual **10 belum** state.

### STG-ATTENDANCE-02 — Saturday Home ignores a recorded audit attendance

**Status:** candidate major for supported weekend/daycare sessions; fixture-conditioned, not proof of ordinary weekday failure.

Parent Home still showed **Belum dicatat** for Anak Audit despite the persisted Saturday attendance confirmed in teacher/session/admin views. The parent weekly page displayed **Monday–Friday, 9–13 November**, with no attendance in that window; an empty weekday grid is expected for this Saturday-only record and is not a separate defect. The teacher reply remained visible on parent Home and attendance, so note delivery was not the failure.

Current `app/parent/page.tsx:58–80,134–143` constructs and queries only Monday–Friday; `:240–241` then looks up today's status in that result. Saturday was never queried. This source path explains the missing Saturday Home status without implying lost attendance storage.

The session was deliberately seeded on Saturday outside the available semester window. Verify whether real weekend/daycare sessions are supported and reproduce within a valid calendar before treating this as an unconditional production defect. If supported, today's card must query today independently of the school-week grid. A separate Friday handoff subsequently passed (below), so the observed Home mismatch is confined to the Saturday test condition in this audit.

### STG-ATTENDANCE-03 — Weekday teacher attendance reaches parent correctly

**Result: passed with explicitly backdated synthetic data.** On Friday **13 November**, teacher class attendance initially showed **0/11**. The teacher selected **Hadir** only for Anak Audit; reload showed **1 Hadir**, **10 belum**. Parent signed in afresh and opened `/parent/attendance?child=uat20261114_student`: the 9–13 November table showed **Friday Hadir**, Monday–Thursday **Belum dicatat**, and the teacher reply remained visible.

At **320×740**, page width was 320 px and the table x=24, width=272, with no page-level horizontal overflow. Read-only verification found row `cmwg1jimx000008l86wk2v18n`, PRESENT, linked to existing Friday session `seede2e1107_cs_2026-11-13`, with no arrival/pickup times. Only the audit child was changed. This is a backdated fixture before its 14 November enrollment; the pass establishes UI/persistence/parent visibility, not enrollment-date eligibility enforcement.

### STG-ACCESS-01 — Portal boundaries and unlinked-child fallback

**Result: passed for the sampled UI routes; not a complete role/tenant authorization audit.**

- Teacher navigating directly to `/admin/invoices` redirected to `/teacher` with normal teacher Home and no admin content.
- Parent navigating to `/admin/invoices` redirected to `/parent`.
- Parent opened `/parent/attendance?child=cmsa763at000004jre7miwdyc` for unlinked Alia. The page said **Anak yang dipilih tidak ditemukan di akun Anda. Menampilkan Bilal.** and displayed Bilal, with no Alia content. This is an explicit safe fallback in the observed UI, not an observed HTTP 403 or an exhaustive API authorization test.

### STG-LEAVE-01 — Teacher request reaches admin rejection workflow

**Result: passed — teacher submission, admin rejection and teacher decision/balance readback completed.**

Teacher submitted one day of annual leave for **16 November**, reason tagged `UAT-20261114-LEAVE`. **Cuti & Izin** then showed **11/12** balance with **1 menunggu**. At 320×740 the leave sheet measured x=0, y=69, width=320, height=671 and fit without overflow. The composer closed after 1,521 ms; the next snapshot showed **Pengajuan cuti terkirim**.

Admin Dasbor showed a count of 2; the queue opened the correct **Ismail** request with the expected date and reason. Admin selected **Tolak**, supplied `UAT-20261114-REJECT`, and the dialog closed after 1,021 ms. After a fresh teacher sign-in, Home showed **Cuti tahunan ditolak**, 16 November and the exact `UAT-20261114-REJECT` reason. **Lihat** opened **Cuti dan izin** at 320 px: annual balance returned to **12 sisa dari 12** (previously 11 with 1 pending), sick balance was **14 sisa dari 14**, and the request showed **Ditolak**, 16 November, 1 day, with the same reason and **Catatan admin**. No pending deduction remained visible. This completes the teacher → admin rejection → teacher feedback/balance handoff. Leave fixture ID: `cmwg0k59v000008l5qn95e6y6`. This is explicitly synthetic leave and was intended to be rejected.

### STG-PERF-01 — Leave submission feedback narrowly crosses the timing threshold

**Persona:** Bu Sari. **Severity:** provisional timing-major, one measured feedback sample. **Completed:** yes; submission and subsequent cross-role rejection readback succeeded.

The leave submission took **1,521 ms** from submit to composer hidden, crossing the global click-to-visible major threshold of **1,500 ms** by 21 ms. The success toast was seen only in the next snapshot, so 1,521 ms is not a settled confirmation/API duration. This isolated boundary sample is included because timing breaches must remain visible; it does not establish a sustained production slowdown. Repeat the same operation with browser-side start/success timing before selecting a performance change.

Admin rejection's **1,021 ms** dialog-close sample is within the global minor band. The current admin job separately budgets reject click-to-status-change under 1 second, but that exact status-change metric was not measured here; do not claim its pass or failure from the dialog-close measurement.

### Measurements and evidence limits

| Action | Observation | What it proves |
|---|---|---|
| Publish report | 1,369 ms to visible confirmation/button state | One UI-feedback sample; not isolated API or page-settled timing. |
| Open parent report | 330 ms to reader shell appearing | Shell appears promptly; not complete data/render readiness and not a layout pass. |
| Sandbox payment | Checkout success, merchant return, two tabs paid, PDF receipt and database/webhook readback | Tested success-path consistency. No end-to-end browser latency recorded. |
| Long report | Geometry unchanged after Control+Home/PageUp at 390 px and a touch scroll at 320 px; reopening repeats; Escape closes | Reading failure reproduced at both widths; keyboard dismissal works. |
| Rapor PDF | Correct named PDF and first-page child/class/term/narrative visible | Download/first-page pass only; full content/pages and comfortable mobile reading not verified. |
| Desktop Rapor opening | Fresh load and reopen start at scrollTop 1842/PDF focus; upward scroll returns to 0 | Minor recoverable start-position issue; cause not isolated. |
| Parent Rapor sibling switch | Hafizh/KB 1 unpublished; Anak Audit published | Sampled child context and published-state isolation passed. |
| Unpaid checkout return | Correct Rp5.000 invoice/child and generated link retained | Payment-link retry after fixture adjustment and unpaid merchant return passed; no method/payment chosen. |
| Parent weekday attendance | Friday Hadir after teacher save; page width 320 px, table x=24/width=272 | Controlled weekday handoff and sampled narrow layout passed; no enrollment eligibility claim. |
| Parent note save | 980 ms to composer closing | One feedback sample, not settled-thread/API timing; persistence confirmed separately by teacher readback. |
| Teacher reply save | 875 ms to composer closing | One feedback sample; parent readback subsequently passed through Home, attendance notes and Jurnal. |
| Gate no-session rejection | `receiveHeadersEnd=782.525 ms`, HTTP 409 | Response-headers timing only; no full-body/click-to-feedback latency or absent-toast claim. |
| Gate audit arrival | 559 ms to updated state | One visible-feedback sample; persistence checked in session view. |
| Session pickup-name save | 533 ms to saved feedback | One visible-feedback sample; reload confirmed the revised name. |
| Leave submission | 1,521 ms to composer hidden | Provisional timing-major under global click-to-visible gate; success toast seen next snapshot. |
| Leave rejection | 1,021 ms to dialog hidden | Global minor feedback sample; job-specific status-change timing not measured. |
| Attendance CSV export | Clicked; automation download wait stalled 800.9 s | Inconclusive export. Harness wait excluded from product performance findings. |

### Retained fixtures

Staging project `udbivhchbizpxoryejgz`, tenant `t_annisaa`; no bulk reset. The [full fixture ledger](assets/2026-11-14-cross-role-ux/staging-fixtures.txt) records exact IDs, generated dependencies, final states and cleanup boundaries. Summary of the five initial additive seed rows:

| Entity | ID and relationship |
|---|---|
| Student | `uat20261114_student`, UAT 14 Nov — Anak Audit |
| Guardian link | `uat20261114_guardian` → existing parent `cms41ayjp008si5x7le0o5qqb`, ACTIVE primary WALI |
| Enrollment | `uat20261114_enrollment` → DCARE `cms41afor001ri5x7sbppuagi`, ACTIVE |
| Session | `uat20261114_session`, FULL_DAY 14 November; teacher/default `cms41ahu9002gi5x7rf1kfhtj`; semester `cms8mpcr200006yx7pk4m6e4d` |
| Report | `uat20261114_report`, term `cms8yxdyl00001ex7qvyxdsvg`; long synthetic narrative, published through admin UI |

The parent now has a third synthetic child; existing siblings and role bindings were untouched. Current journal writes on that fixture include `UAT-20261114-PARENT` (Monday 9 November, subsequently edited), `UAT-20261114-TEACHER` (Friday 13 November), and a Friday home-habit tick; parent note ID `cmwg0bgez000107lbcw0r475h`, teacher reply ID `cmwg0dt6f000208lahg2f2loc`, HOME entry ID `cmwg0cd43000607lbf0hu6cs0` (indicator `cms41ah8r002di5x7z5nmtkcr`). The synthetic session has exactly one attendance row, `cmwg0g7x6004d08la1m7lelvw`, for Anak Audit, with arrival/departure, pickup-name revision and later admin audit note; inspect it before removing the session. Read-only verification found no Bilal attendance row after the rejected Gate attempt. A separate Friday attendance row `cmwg1jimx000008l86wk2v18n` was saved for only Anak Audit under existing session `seede2e1107_cs_2026-11-13`, PRESENT with no arrival/pickup times; this backdated fixture precedes its 14 November enrollment. Leave fixture `cmwg0k59v000008l5qn95e6y6` belongs to the staging teacher; rejection reason/status and restored balance were verified in the teacher portal. The separate audit invoice/payment IDs above belong to existing Bilal; **do not delete Bilal during cleanup**. No cleanup has been executed; fixtures remain for reproducibility.

The available semester ends 11 September and its term spans 20 July–11 September. The synthetic Saturday session deliberately references that semester, and the new child's report deliberately uses that earlier term. These exceptions are labeled test setup: publication/reader evidence does not prove academic aggregation, and the prepared session does not prove normal calendar generation. Future cleanup should inventory dependent rows and preserve audit/payment history, preferring reversible unpublish/inactive states. Do not rerun the existing one-shot enrichment script wholesale because it can duplicate students.

A second controlled invoice was prepared for unresolved-return testing: `uat20261114_pending_invoice`, number `UAT-20261114-PENDING`, for Anak Audit, total Rp5.000, initially SENT/paid Rp0, line `uat20261114_pending_line`. It initially has no gateway URL/session; no payment or gateway call was made by seeding. This fixture is separate from the successful Bilal sandbox payment. It was first exercised through synthetic callback/reload (STG-FINANCE-02), then through a real sandbox checkout creation and unpaid merchant return (STG-FINANCE-03); no payment was made. Its synthetic line label was normalized to **SPP Bulanan** after DOKU rejected the em-dash fixture label, and checkout retry passed. The adjustment and a plausible user-input source path are recorded as the ungraded STG-FINANCE-04 validation candidate, not a confirmed general product defect. Latest readback remains SENT, totalPaid 0, with a generated payment link. Include any later gateway state in cleanup inventory.

Current routes: admin `/admin/report-cards` (legacy `/admin/raport` redirects), report API `/api/admin/report-cards/<student>/<term>`, parent PDF `/api/guardian/report-cards/<student>/<term>/pdf`, teacher fixture `/teacher/sessions/uat20261114_session`. Sandbox procedure: [payments gateway runbook](../../runbooks/payments-gateway.md).

### Earlier recommendations and remaining coverage

| Recommendation | Evidence after this continuation |
|---|---|
| Payment confirmation after reload | **Current staging-confirmed major** with synthetic callback/reload (no actual payment on that fixture); separate immediate sandbox settlement passed. Real delayed-webhook behavior still untested. |
| Mobile Rapor | **Current staging-confirmed blocker**; earlier local evidence supplements it. |
| Attendance clarity | **Current staging-confirmed major**: enabled Bilal arrival rejects no session. Synthetic audit arrival/pickup/session correction persist in teacher views and match admin daily/monthly recap; guard and changed-row save work. Parent Saturday Home missing-status candidate is fixture-conditioned; separate Friday teacher → parent handoff passed. |
| Journal child/date/audience | **Current staging-confirmed major**: parent Monday default, actual save/edit and teacher readback; teacher Friday default. Home habit persisted and was readable by teacher. Reverse reply readback, sibling isolation and draft-discard guard passed; persisted-note deletion and error tests remain pending. |
| Admin work/counts | Earlier evidence retained; not repeated here. Earlier counts are historical, not current totals. |

Still incomplete in this continuation evidence: full Rapor PDF content/pages and mobile reading usability; UI-created fee-label gateway validation reproduction; valid-calendar weekend attendance support; attendance CSV download verification; persisted own-note deletion and note/home-habit error recovery; leave approval/error/cancellation paths; substitute coverage; payroll/export; public admissions/invitation/signatures/uploads/conversion; broader API/role/tenant negatives beyond sampled admin-route redirects and unlinked-child UI fallback; logout/back; offline/throttled-network recovery; full current-revision mobile sweep. The invoice receipt and Rapor PDF were checked separately; the Rapor check covers only download and its visible first page. Current JTBD catalogs are fresh (admin 13 November; teacher/parent 14 November); old root-checkout dates should not be used as staleness warnings.

### Documentation verification

- `bash scripts/audit-docs.sh` exited 0: 10 checks OK, one existing ADR-age warning, no failures.
- Report links resolve, all new finding/check IDs are unique and referenced correctly, all five original cycle sections remain, and Markdown fences are balanced.
- The pre-existing untracked report was preserved and enriched; it remains untracked, with no application fixes or commits made by this audit. Build and unit tests were not run for these documentation-only deliverables; live staging journeys above provide the behavioral evidence.
- Screenshots were inspected inline during Chrome testing. The saved transcript records measurements and limitations; this continuation does not claim exported screenshot files.

### Start a separate implementation session

```text
/spec fix the long mobile Rapor reader

Use docs/uat/reports/2026-11-14-cross-role-ux.md, STG-RAPOR-01.
Current staging ee955459 reproduces the failure with uat20261114_student /
uat20261114_report. At 390x844 the reader is 4320.97 px tall, title/close
above y=-3450, with no internal scroll range. Verify the CSS hypothesis,
then pass the mobile, keyboard, reopen and sibling-context exit tests.
Preserve the working publication guard and sandbox payment/receipt path.
```

## Five proposed cycles — original ordering retained

Current implementation priority is the staging-confirmed Rapor blocker, then payment pending-state persistence and journal date/context. The original numbering below remains stable for references. Payment reload is now reproduced on staging with a synthetic callback; real delayed-webhook behavior remains separate verification.

### 1. Make payment confirmation survive a reload

**Roles:** Parent and finance admin. **Severity:** Major, with duplicate-payment risk. **Evidence:** Promoted to current staging-confirmed synthetic callback/reload (STG-FINANCE-02), alongside a passing real sandbox settlement (STG-FINANCE-01). The following paragraph retains the earlier local reproduction; no actual duplicate charge was observed.

For the same unpaid invoice, a simulated successful provider return with reconciliation still unresolved hid **Bayar sekarang** and said payment was being checked. A hard reload after the return parameters cleared brought the pay button back with the same balance. No duplicate charge was made or observed. A separate real write against synthetic data proved the working handoff: admin recorded Rp10.000 cash and the parent saw Rp840.000 remaining, the dated payment, and a partial receipt.

Keep a durable attempt state attached to the correct invoice and child. Show the same actionable status in the invoice list and detail. Offer a check or a clear wait state while the provider outcome is unknown. Reconcile to the server balance when the result arrives. Preserve the amount, date, and receipt already working on the cash path.

**Exit test:** Simulate delayed confirmation, reload and reopen from another sibling, then verify the right bill stays pending and never invites a second payment. Repeat for confirmed, expired, failed, partial, and duplicate callback cases. Confirm that paid history and receipt follow the reconciled amount.

Evidence: [before reload](assets/2026-11-14-parent-ux-local/payment-return-pending.png), [after reload](assets/2026-11-14-parent-ux-local/payment-return-refresh.png), [cash handoff transcript](assets/2026-11-14-cross-role-ux/local-handoffs.txt).

### 2. Make Rapor readable from the first line on a phone

**Roles:** Parent primary; admin and teacher as publishers and sources. **Severity:** Blocker on mobile. **Evidence:** Promoted to current staging-confirmed at `ee955459` (STG-RAPOR-01). The following measurements remain the earlier local reproduction at `a0afa580`.

At 390×844, opening a long Rapor created a 1,668 px bottom sheet. The title was at y=−800 and the close button at y=−812. The sheet had no inner scroll range; scrolling up left both in the same place. At 320×720, the title was y=−1085. On desktop, focus moved to the PDF control and initially scrolled away from the start, though it was recoverable. The PDF returned HTTP 200 locally.

Use a reader that starts at the beginning, shows the child and period, bounds the scroll area to the viewport, and keeps a visible back or close action. Keep PDF as an option. Give admins a preview that uses the same parent reader with synthetic long content as a regression fixture.

**Exit test:** With a long published report, read from title to last section and back at 320×720 and 390×844; close by touch, keyboard and screen-reader action; reopen at the beginning with the correct sibling. Keep the unpublished state clear.

Evidence: [390 px long report as opened](assets/2026-11-14-parent-ux-local/report-reader-no-child.png), [measured geometry and PDF check](2026-11-14-parent-ux-local.md#p-rapor-01--long-reports-open-with-the-top-and-close-control-off-screen).

### 3. Give attendance one clear path for today

**Roles:** Teacher, admin and parent. **Severity:** Major. **Evidence:** Current staging no-session rejection confirmed (STG-GATE-01), and scheduled teacher/admin handoff passed (STG-ATTENDANCE-01); parent Saturday Home mismatch is fixture-conditioned (STG-ATTENDANCE-02), and a separate weekday teacher → parent handoff passed (STG-ATTENDANCE-03). The following paragraph retains earlier baseline/local observations.

Staging teacher Home offered both **Lanjutkan absensi** and **Absensi DCARE**; **Sesi & penjemputan** sat farther down. On staging Saturday, Gerbang offered 21 arrival buttons. The local no-session test accepted a tap on an enabled row before responding with HTTP 409, **Belum ada sesi kelas hari ini**. With a session, arrival and pickup did save. Gerbang and class attendance save on tap, whereas the session roster requires **Simpan absensi** and showed green **Hadir** before recording a result. The off-site check-in reached admin, but the teacher saw approval only through the disappearance of a badge. Parent Home on staging described Saturday as attendance **belum dicatat**.

Lead with the one action for the teacher’s class and date, keep campus-wide Gate explicit, and distinguish class roll, arrival, and pickup in plain labels. Show unavailable rows before tapping. Use the school calendar to distinguish no session, unrecorded, and absent. Tell the teacher what admin decided, and the parent what the school actually recorded.

**Exit test:** On a scheduled morning, record an arrival, exception, and pickup for a child with a similar name, and verify the settled state across the relevant views after reload. On a non-school day, show no actionable unavailable row or misleading missing-attendance prompt. An off-site request visibly transitions to approved or rejected for the teacher.

Evidence: [unscheduled Gate row](assets/2026-11-14-teacher-ux-local/02-gate-no-session.png), [320 px session roster](assets/2026-11-14-teacher-ux-local/04-session-320.png), [teacher job walkthrough](2026-11-14-teacher-ux-local.md).

### 4. Make the journal say who, when, and who sees it

**Roles:** Parent and teacher; admin monitors completion. **Severity:** Major. **Evidence:** Promoted to current staging-confirmed create/edit/read handoff (STG-JOURNAL-01). The observations below remain the earlier baseline and local supplement.

On Saturday 14 November, staging’s **Tulis catatan** preselected Monday 9 November with no child name in the composer. The local note saved and the teacher saw it with the **Orang Tua** label on Monday, not the date implied by the task. Delivery worked; the date and recipient were easy to misread. At 320 px the teacher’s roster also uses adjacent icon-only controls for today’s checklist, adding a note, and opening the week.

Keep child, date, and audience together at the point of entry and in the save confirmation. If today is outside the week, ask for a deliberate day or use a visibly explained latest school day. Name the teacher’s most important row actions and expose saved and retry states to assistive technology.

**Exit test:** From both children and both sides of the conversation, write, edit, and reopen a note on a school day and weekend. The recipient sees the same child, chosen school date, and author role. A failed save shows an actionable retry and never appears as a successful delivery.

Evidence: [local composer](assets/2026-11-14-parent-ux-local/note-date-default.png), [teacher indicator at 320 px](assets/2026-11-14-teacher-ux-local/05-journal-indicator-mobile.png). Staging opened the composer in 335 ms and showed the same date without submitting.

### 5. Put real admin work ahead of counts, and make the counts honest

**Roles:** Admin primary. **Severity:** Major. **Evidence:** Staging and local delayed-response reproduction.

At 390×844, the dashboard’s first specific action started at y=860; at the top, several large tiles included zero-work categories. The queue’s record links themselves worked. On staging, **Siswa** rendered “0 siswa terdaftar” before 40, and **Tagihan** rendered “0 tagihan” before 319. A local 1.3 s API delay made the false numbers linger alongside skeleton rows. Billing also uses the primary **Buat Tagihan** label while the manual single-student route sits under **Aksi lainnya → Tagihan Manual**.

Move a short list of the highest-priority actionable records above the fold. Show genuine pending work before zero-state categories. Use distinct loading, empty and failed states, and preserve the last valid counts during refresh. Make “bill one student” and “bill a group” distinguishable at the first choice. Keep search filters when returning from a record.

**Exit test:** At 390×844, a record-level action is visible without scrolling. Under delayed and failed requests, a populated list never announces zero. From Dasbor, open the right record and back to the same filter. Test that a user given a one-child billing task can choose the correct option on their first click.

Evidence: [Siswa loading state](assets/2026-11-14-cross-role-ux/students-false-zero.png), [Tagihan loading state](assets/2026-11-14-cross-role-ux/invoices-false-zero.png). Screenshots use synthetic data; staging counts and geometry are recorded above.

## Verification and boundaries — earlier baseline at `a0afa580`

| Check | Result |
|---|---|
| Staging admin document load, desktop sweep | 534–1,049 ms wall-clock samples; UI document load is not the same as data settled. |
| Staging parent and teacher 390 px sweeps | 490–1,262 ms parent, 473–1,030 ms teacher, one sample per screen. |
| Staging click to visible | Dashboard → queue 677 ms; queue → enrollment review 1,249 ms; Dashboard → overdue table 1,305 ms; student search detail/return 1,025/784 ms; parent sibling switch 558 ms; populated invoice sheet 532 ms. |
| Staging narrow layout | No page-level horizontal overflow on the sampled 320/390 px screens. The long report overlay is a separate local finding. |
| Staging search and child context | Admin preserved search on list return. Parent Tagihan → Kehadiran kept the selected sibling; invoice detail named the child and showed three line items. |
| Supplemental local timing | One local Home → overdue click took 4.45 s and a parent invoice full load took 4.52 s. Both cross the UAT blocker thresholds for their metrics; comparable staging runs did not reproduce them. Timing samples are not an SLA or a real Android network benchmark. |

The [teacher report](2026-11-14-teacher-ux-local.md) and [parent report](2026-11-14-parent-ux-local.md) give per-job timings, API results, and reproduction steps. The continuation above now reproduces the long report on staging and verifies normal sandbox payment settlement. The continuation also reproduces pending-state loss on staging using a synthetic callback/reload. Before shipping payment persistence work, extend that controlled test to real delayed/failed gateway outcomes. For each cycle, give one admin, one teacher, and one parent a task in their own words and watch their first click without coaching.

## Heuristic disclaimer

This is synthetic UAT. An LLM persona cannot replicate thumb reach, sunlight
glare, emotional distrust, or network conditions on a 4-year-old phone in
Bekasi traffic. Treat findings as a cheap first pass, not a substitute for
putting the app in front of a real teacher or parent.
