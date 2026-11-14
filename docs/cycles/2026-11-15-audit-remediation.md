# Complete the local cross-role usability audit fixes

## Context
The user approved fixing the completed local audit of 69 grouped findings, with sustained iteration and local verification. The immutable audit evidence is under /workspace/audit. Start from current staging and preserve already-shipped fixes.

## Decisions
- Fix all verified findings, prioritizing permission enforcement, billing correctness, lost edits, attendance and report integrity.
- Existing role grants must enforce reads and writes without exposing guardian invoices to student-only roles.
- Save/retry flows must preserve newest intent, prevent duplicate invoices, and reject or reconcile stale edits.
- Preserve existing product policies; improve validation, error recovery, accessible controls and mobile layouts.
- Additive persistence changes needed for idempotency/concurrency are within this remediation; no destructive migration, new service, production data change or production promotion.

## Acceptance criteria
- [ ] All 69 grouped findings are mapped to an implementation and verified regression or a documented pre-existing correction.
- [ ] Permission regressions deny missing grants while preserving legitimate role/tenant flows.
- [ ] Billing, enrollment, assessment, attendance, guardian and report changes preserve data under retries, concurrent edits and failures.
- [ ] Validation, loading/error, mobile and accessibility defects have useful recoverable behavior consistent with the design-system.
- [ ] Local build, lint, Vitest, API/RLS guards and production-build Playwright pass.

## Verify flows
1. Restricted admin attempts module reads/writes and guardian financial disclosure; normal role still completes authorized tasks.
2. Admin retries invoice after lost response, recalculates leave/bundle draft, and changes program with failed/reordered tariff loads.
3. Parent edits enrollment in two tabs; teacher rapidly assesses then changes week; verify reload persistence and visible failures.
4. Admin changes homeroom with failed write; teacher restores attendance; report absence totals and multiline export remain correct.
5. Walk corrected error, validation, keyboard and narrow-screen cases from each audit module.

## UX notes
Keep existing primary task tap counts; explicit retries/conflict recovery add an action only when needed. Use existing Indonesian voice, components and design-system.

## Test seams
Existing API/business-logic and component Vitest suites; targeted regressions at concurrency/permission seams; full local Playwright and audited browser reproductions.

## Non-goals
Production promotion, real payment settlement, real notification delivery, new features or source-only audit suspicions.

## Assumptions
The explicit instruction to work on the completed audit fixes authorizes this scoped remediation and the repository PR workflow without a repeated spec gate. Prior local testing and synthetic-data authorization remain applicable.

## Gate re-openers
Destructive migration, new dependency requiring a product tradeoff, live service or production writes.

## Tasks
- [x] T1 Permission and core boundaries.
- [x] T2 Finance and billing integrity/recovery.
- [x] T3 Students, guardians and enrollment integrity.
- [x] T4 Academic setup and curriculum assessments.
- [x] T5 HR, payroll and attendance.
- [x] T6 Report cards and journals.
- [ ] T7 Integrate, independently review, verify and deliver.

## Implementation
- Plan: driver=gpt-6, workers=gpt-6.1-sol; T1–T6 parallel by owned modules, T7 sequential integration and full verification. Driver owns cross-module design, integration and security review; workers implement and test slices.
- Authorization: user explicitly requested fixing the completed audit and working continuously for at least 1–2 hours.
- Base: current origin/staging 32731fd5, which already fixes explicit re-entry of voided attendance from AUD-09; verify rather than duplicate.

- T1 delivered: Permission checks cover reads, writes, exports and private student documents; shared field, idle-expiry and contrast fixes are verified.

- T2 delivered: Sticky invoice idempotency, tariff request isolation, stale payment recovery and completed billing-run state are verified.

- T3 delivered: Queued draft merging, latest-payload submission, guardian preservation, closed invitations and field validation are verified.

- T4 delivered: Ordered assessment writes, context resets, atomic homeroom replacement, program/class fields and valid curriculum dates are verified.

- T5 delivered: Payroll retries and export replay, read-only controls, attendance date totals and accessible keyboard details are verified.

## Finding closure ledger

All rows below describe implemented behavior; final local verification is recorded separately. Original audit IDs remain stable.

| Finding | Change |
|---|---|
| AUD-01 (ACA-01, CORE-04, FIN-02, STU-07, JRN-01) | Enforce module grants on writes, reads, exports and student subresources; retain legitimate dependent dropdown reads. |
| AUD-02 (STU-02) | Skip family financial queries and hide financial UI without invoices.view. |
| AUD-03 (FIN-03) | Each tariff fetch clears previous context, binds successful data to program/year key, ignores obsolete response generations and gates inputs/save until current context successfully loaded. Failed lookups render persistent explicit retry. |
| AUD-04 (CURR-03) | Per-cell promise queue serializes network writes. Version checks ignore stale failures/retries; rollback restores last committed value; unrelated failed cells remain in error state. |
| AUD-05 (CURR-05) | Weekly form remounts by week/class/start date; date membership checked before writes; unmounted retry closures cannot write. |
| AUD-06 (STU-04) | serialized client queue plus locked per-leaf three-way merge; independent tabs merge and conflicts visible; submit drains pending saves and merges current stored data |
| AUD-07 (FIN-07) | Manual creates carry a sticky UUID attempt key for the dialog, retained across retries and edited payloads until success/explicit close. Tenant-scoped unique Invoice key plus SHA256 payload hash enforces replay and conflicting-details rejection; concurrent loser returns existing invoice without duplicate audit/gateway. Hash mismatch returns original invoiceId only with invoices.view; UI provides Buka tagihan sebelumnya link. Additive migration only. |
| AUD-08 (FIN-08) | Leave invalidation discovers existing materialized rows for the student even if draft scope includes school class only; existing leave route parks unclaimed PENDING rows as EXCLUDED without repricing their frozen amounts. Year/month/tenant filters remain enforced. |
| AUD-09 (ATT-004) | Already corrected on staging32731fd5; retain and reverify explicit attendance restoration. |
| AUD-10 (STU-09) | guardian create uses create only; existing email conflict409 preserves shared profile; race unique conflict409 |
| AUD-11 (ATT-003, RAPOR-06) | Report draft shares date deduplication (student/date across placements) and cannot count three sick session records as three dates. |
| AUD-12 (ACA-09) | Confirmed replacement is one advisory-locked transaction; expected assignment guards stale confirmations; failed creation rolls back original deletion. UI sends one POST, never DELETE first. |
| ACA-02 (ACA-02) | Archived roll-forward target rejected server-side before any clone; copy action hidden on archived rows. |
| ACA-03 (ACA-03) | Program update schema retains code, PUT writes it and rejects duplicate tenant codes. |
| ACA-04 (ACA-04) | Create/form/update validate minimum<=maximum; partial PUT validates against stored counterpart. |
| ACA-05 (ACA-05) | Teacher selects supply explicit value-label items, including add and substitution dialogs. |
| ACA-06 (ACA-06) | Academic loads catch HTTP/network failures, leave skeleton state, expose persistent local retry. |
| ATT-001 (ATT-001) | Successful override and void refresh today summary alongside list. |
| ATT-002 (ATT-002) | Monthly recap clears rows on each request, persistent error/retry replaces false empty or stale data; CSV disabled while rows unavailable. |
| CORE-05 (CORE-05) | Idle expiry clears authentication cookies before redirect. |
| CORE-06 (CORE-06) | Use accessible semantic text colors and opaque metadata. |
| CORE-08 (CORE-08) | Discard outdated campus filter responses. |
| CURR-01 (CURR-01) | Week creation/date update/reactivation must be Monday-Friday same week and fully inside parent semester. Legacy invalid weeks can still be deactivated. |
| CURR-02 (CURR-02) | Resolver filters active subtheme/theme/semester; weekly and center indicator queries filter active objective/semester; writes reject inactive indicators/objectives. Semester date bounds exclude out-of-semester legacy dates. |
| CURR-04 (CURR-04) | Date/sentra/roster context load clears activity and hydrates exact saved activity, including empty sessions. |
| CURR-06 (CURR-06) | Monitor class display includes campus name, distinguishing same-name campus classes. |
| CURR-07 (CURR-07) | PROMES UI displays field and reason for preview/commit validation errors; server supplies element/TP/IKTP identity context. |
| FIN-01 (FIN-01) | Mobile invoice identity now contains total and remainder; standalone amount column hides below md so sticky actions do not obscure amounts. |
| FIN-04 (FIN-04) | Save catches transport errors, always releases saving state, preserves edited values, and shows persistent retry guidance. |
| FIN-05 (FIN-05) | Failed catalogue load renders persistent load-error view with retry instead of genuine-empty state or create actions. |
| FIN-06 (FIN-06) | Payment failure refreshes persisted invoice before showing corrected form/review, updating balance used for status prediction. |
| FIN-09 (FIN-09) | All-resolved DRAFT finish replays a skipped row through idempotent commit to persist COMMITTED. Empty zero-row DRAFT is explicitly cancelled. Failures retain wizard and retry, lost response verifies persisted COMMITTED/CANCELLED status. |
| HR-001 (HR-001) | Payroll, employee list and daily staff roster now distinguish read failures with ErrorState and retry. |
| HR-005 (HR-005) | Payroll generation forwards server fieldErrors to applyServerErrors, including periodStart. |
| HR-006 (HR-006) | APPROVED/EXPORTED/SLIPS_SENT allow repeated BSI downloads; CAS records first export without regressing later states, rechecks concurrent status. |
| HR-007 (HR-007) | Fail-closed client grants hide employee/salary/payroll writes and staff attendance correction controls. Detail salary editor is read-only without payroll.edit. |
| HR-008 (HR-008) | Calendar detail uses shared accessible Dialog with initial/trapped focus, Escape dismissal, explicit finalFocus to originating date. |
| HR-009 (HR-009) | Monthly summary and CSV count LEAVE/SICK/PERMISSION as excused days; monthly cells use Indonesian Sakit/Izin labels and status colors. |
| HR-010 (HR-010) | Override save catches network rejection and always clears saving in finally; current correction stays available for retry. |
| JRN-02 (JRN-02) | Admin category/class/student loading failures persist locally with explicit retry, preventing empty-data claims. |
| JRN-03 (JRN-03) | Parent week failures show persistent readable load failure and retry. |
| JRN-06 (JRN-06) | Picker validates future cap, future deep links recover to picker, and server batch schema rejects future dates. |
| JRN-07 (JRN-07) | Query all seven calendar days; display five baseline school dates plus observed weekend activity. Completeness remains five-day baseline for ordinary weeks. Correct Sab/Min labels use actual weekday. |
| JRN-09 (JRN-09) | Read-watermark POST occurs only after successful current note-page load; failed list load preserves unread; successful retry can mark read. |
| RAPOR-01 (RAPOR-01) | Published saves expire the parent report cache immediately. |
| RAPOR-02 (RAPOR-02) | Atomic upsert revision predicate rejects stale saves with409; editor retains unsaved text and persistent reload recovery. |
| RAPOR-03 (RAPOR-03) | Read/write/publish capabilities disable unavailable authoring, sync and publication controls. |
| RAPOR-04 (RAPOR-04) | Monotonic roster request token discards old class responses and errors. |
| RAPOR-05 (RAPOR-05) | Bundled OFL Noto Sans Arabic font renders shaped Arabic runs while retaining Latin fallback. |
| RAPOR-07 (RAPOR-07) | Report sections can paginate; explicit newlines become independently measured text blocks; page-level margins remain on continuations. |
| STU-01 (STU-01) | future birthdate rejected on next and final server validation |
| STU-05 (STU-05) | visible save state/error/retry; exact uncertain request retried before later edits |
| STU-08 (STU-08) | metadata and health editors register unsaved guards |
| STU-10 (STU-10) | cancelled lead closes token classification/page/API; submit rechecks inside locked transaction |
| STU-11 (STU-11) | shared server/client health schema with nonnegative maxima and integral sibling counts |
| STU-12 (STU-12) | Keep guardian filters mounted and restore list context on return. |
| ACA-07 (ACA-07) | Detail edit now includes program and age group, program picker retry, billing-impact preview and shared guarded PATCH. |
| ACA-08 (ACA-08) | Historical roster count separates ACTIVE enrollments from historical students. |
| CORE-01 (CORE-01) | Trim campus names before validating updates. |
| CORE-02 (CORE-02) | Validate real calendar dates. |
| CORE-03 (CORE-03) | Malformed configuration JSON returns a structured 400. |
| CORE-07 (CORE-07) | Remove unsupported aria-required from labels; native required inputs remain. |
| HR-003 (HR-003) | Employee list defaults to ACTIVE; explicit All/Inactive filters remain. |
| HR-004 (HR-004) | Salary list checks HTTP status and array shape, shows local recoverable error for 403/500. |
| JRN-04 (JRN-04) | Controlled expanded-category IDs survive refresh/loading after indicator create/update/reorder. |
| JRN-05 (JRN-05) | Mobile history stacks readable before/after values; indicator/date context is visible; raw IDs and JSON are secondary details. |
| JRN-08 (JRN-08) | Forbidden grid loads explain changed access, offer another class and suppress misleading connectivity/raw Forbidden copy. |
| STU-03 (STU-03) | invalid photo content receives actionable Indonesian copy |
| STU-06 (STU-06) | Scroll focused invalid fields with their explanatory message into view. |

## Verification
- Initial integration typecheck/lint found missing variable scopes, unused directives and new test-helper type mismatches; corrected before final gate.
- Independent security review found additional student read/export/overview financial leaks and uncertain edited invoice retries; fixed with targeted regression coverage.
- Independent academic review found an obsolete assessment retry could overwrite newer intent; guarded by cell revision and covered by a regression.
- Current runtime build passed (`build-frozen.log`); root independently reran finance, academic, enrollment, report/journal and HR/attendance browser reproductions on that build. Targeted cases all passed, including exact lost-response replay, concurrent writes, restricted grants and failed-load recovery.
- Mobile/desktop contrast scan waits for the rendered calendar (not its loading skeleton); all ten page/width combinations passed. Narrow-screen invalid-field visibility, campus response races and guardian search restoration passed. Cross-checked design-system semantic ink, field spacing and keyboard focus.
- Exact 49-line / 4,088-character report stress fixture exports five intact pages. Root inspected all five; all weeks and final markers remain, Arabic is shaped, and both serverless PDF bundles trace the licensed font.
- Source was fast-forwarded to staging e97b4437 (documentation only), preserving upstream deployed verification history and this cycle's acceptance changes. Runtime checksum manifest is recorded locally.
- The first complete production-build Playwright run passed299/299. Subsequent root review reproduced a final-submit closure race (edits made while autosave drains); the client now reads the latest payload ref and distinguishes draft conflicts from an already-submitted receipt. Focused regressions pass; rebuilding and rerunning the full gate on this last change.
- Full regression gate remains in progress. Initial integration failures in old grant/date/draft fixtures were corrected without weakening business assertions. Two existing SPP tests exposed redundant DOM-query cost and stale-preview synchronization under concurrent build load; tests now wait for the current preview and retain all assertions and global timeouts.

## Ship Notes
One additive migration adds nullable manual invoice request key/hash columns and a tenant-scoped unique index; no existing rows are rewritten. A licensed Arabic font is bundled for report exports. No new package dependency or environment variable. Staging deploy applies the migration through scripts/vercel-build.sh. Rollback: revert application commits while retaining the additive nullable columns/index; existing invoice rows remain unchanged.

Auth-impacting: needs-staging-verify required before merge; verify real Supabase idle expiry and restricted admin module access, billing creation/retry, parent enrollment and teacher assessment/report in signed-in staging. No production promotion. Local runtime uses only disposable databases and dummy provider credentials.
