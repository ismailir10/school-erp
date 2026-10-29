# Harga paket sekolah + daycare — one price for a child who holds both placements

## Context

An admin sends the "SPP sekolah + daycare" invoice by hand every month because the app cannot price it. Her prices are bundles,
not a sum of two fees:

| Group | SPP sekolah | SPP sekolah + daycare | Daycare part |
|---|---|---|---|
| TK A | Rp 499.000 | Rp 1.560.000 | Rp 1.061.000 |
| TK B | Rp 504.000 | Rp 1.500.000 | Rp 996.000 |

Facts from the code (looked up, not asked):
- A child may hold one school placement (Program type SEMESTER) and one daycare placement (YEAR_ROUND) in a year (a third,
  SESSION, is possible). The Billing Run and "Catat SPP di muka" (SPP paid in advance) merge the placements into one invoice, but a
  fee component several programs carry (the shared SPP component) is **summed**: school SPP + the daycare program's single SPP.
- Fees are stored per program per year (`ProgramFeeStructure`). Daycare is one program, so it has one fee: it cannot be
  1.061.000 for TK A children and 996.000 for TK B children.
- Both billing paths go through one pure builder (`buildBillingRunRows`), fed by exactly two loaders (the Billing Run
  materializer and the SPP-prepay loader).
- **Pre-existing gap the bundle depends on:** the Billing Run prices only the placements in the classes the admin ticked. A run for
  "TK A" alone bills a TK A + daycare child the school price, and a later "Daycare" run for the same period then skips that child
  as already invoiced, so the daycare part is never billed and nothing warns. "Catat SPP di muka" already prices every active
  placement of the student.
- A keringanan on a merged component is applied once, to the merged amount; a percentage keringanan therefore follows the bundle.
- A child whose daycare placement is on leave (cuti) is billed school-only by the Billing Run (the leave drops that placement before
  pricing). "Catat SPP di muka" is deliberately leave-unaware and stays so.
- `Program.type` is not known to the pricing builder and can be edited after a program exists.

Plan reviewed by Opus 5.5 (verdict: approve with changes); every change is folded in below.

## Decisions

Taken on the product owner's behalf ("proceed with your best judgement"); each is cheap to change later.

1. **A bundle price is an explicit total for one fee component, for one school program + one daycare program, for one academic
   year.** When a child's billed placements include both programs, that component's merged line is the bundle amount **plus the
   amounts of any other programs** carrying the component (a pop-up class, say). It only applies when the component's merged line
   really comes from both programs and exactly one active bundle matches; otherwise today's summing, unchanged. A bundle can never
   create or replace a line only one program prices.
2. **Per school program, not per class** (TKIT-A and TKIT-B are separate programs): every TK A class shares TK A's price.
3. **Per component.** Only the component it is set for is replaced (normally SPP); other shared recurring fees (meals,
   activities) keep summing unless they get a bundle price too.
4. **The Billing Run now prices per student, as "Catat SPP di muka" already does:** a student is in a run if any of their active
   placements is in a ticked class, or they are explicitly included (exclusions still win); all their active placements in the
   year are then priced into the one invoice. (Without this, a run for one of the two classes would never use the bundle and the
   daycare part would be silently lost.) This is a deliberate change of an existing behaviour and is stated in the PR.
5. **Both billing paths price the bundle the same**: Billing Run (create and rebuild) and "Catat SPP di muka". Leave applies to the
   Billing Run only (a month with the daycare placement on cuti bills school-only); prepay stays leave-unaware, as today.
6. **Edited on the existing "Tarif per Program" screen**, in a section "Harga paket sekolah + daycare" for the selected academic
   year, one save for the whole year. Clearing a price deactivates it (soft delete); setting it again reactivates the same row.
7. **Server rules:** school program is SEMESTER, daycare program is YEAR_ROUND, different programs of the school; the component is
   enabled and recurring and **both programs have a fee row for it that year**; the amount is a whole rupiah above zero (a free
   bundle is a keringanan) and within the existing fee maximum. The loaders re-check the program types when reading, so a later
   type change turns a bundle off instead of mispricing.
8. **Needs `fees.edit` to change and `fees.view` to read** (both on top of the admin role), rate-limited, one transaction,
   every create/change/clear audit-logged in the same transaction. An unchanged cell writes nothing.
9. **The invoice line keeps its label** ("SPP Bulanan (D'Care + TKIT-A)"); only the amount differs.
10. **Drafts:** a bundle change reaches an open draft through "Hitung ulang" (rebuild); the save message says so. Invoices already
    created, and runs already committing, are not re-priced.
11. **Not in this cycle**: the per-class "SPP Rp 499.000" hint in the class picker stays the school-only price; the Ubah Kelas
    fee-change preview is not bundle-aware; one-time registration fees are untouched.

## Acceptance criteria

- [ ] An admin with fee-edit rights can set, change and clear a "SPP sekolah + daycare" amount per school program and component
      on Tarif per Program; the section shows the normal sum beside each, saves only what changed, warns about unsaved edits
      (including when switching the academic year), and is read-only without fee-edit rights.
- [ ] A Billing Run in which **only the TK A class is ticked** bills a TK A + daycare child the bundle amount (Rp 1.560.000 with the
      example prices) in one invoice; a run in which **only the daycare class is ticked** bills the same child the same; a TK B
      child gets TK B's price (Rp 1.500.000), never TK A's.
- [ ] Running the school class and then the daycare class for the same period does not bill the child twice.
- [ ] A child holding only the school program is billed the school price; only daycare, the daycare price.
- [ ] With no bundle price for the pair (or a cleared one), the child is billed the sum, exactly as today; other shared recurring
      fees without a bundle price still sum; a component only one program prices is untouched.
- [ ] With a third (pop-up) placement the bundle still applies and the third program's amount is added.
- [ ] A percentage keringanan on the component is computed from the bundle amount.
- [ ] "Catat SPP di muka" prices the same child the same way (preview and settlement).
- [ ] With the daycare placement on cuti for the month, the Billing Run bills school-only.
- [ ] Rebuilding a draft after a bundle price changes uses the new price.
- [ ] A bundle price cannot be set between wrong program types, for a component that is disabled, one-time or priced by only one
      of the programs, with an amount of zero or less, or against another school's data; a user without fee-edit rights is
      refused; every change is audit-logged.

## Verify flows

1. **Admin, set and bill:** on Tarif per Program, pick the active year, enter a bundle price for the TKIT school program's SPP,
   save. Register a child in a TKIT class and in the daycare class. Open the Billing Run wizard, tick **only the TKIT class**: the
   child's row shows the bundle amount and the line names both programs. Rebuild with only the daycare class ticked: same amount.
2. **Fallback:** clear the price, rebuild the draft: the row is the sum again.
3. **Edge:** the daycare placement on cuti for the month: school price only; a second school program's child uses its own price.
4. **Error:** an amount of 0 is refused with a clear message; a user without fee-edit rights cannot save.
5. **SPP di muka:** the preview for the same child shows the bundle price per month.

## UX notes

- A card under the program fee table: "Harga paket sekolah + daycare", with "Isi kalau anak yang ikut sekolah dan daycare ditagih
  satu harga paket. Kosongkan untuk memakai jumlah biasa: tarif sekolah + tarif daycare."
- Rows: school program × recurring component that both the school program and the daycare program price (sum above zero), or
  already have a bundle price (so it can be cleared). Columns: Program sekolah, Komponen, "Jumlah biasa" (saved school + daycare
  fee, read-only), "Harga paket" (Rupiah input, empty = not set). One block per daycare program.
- The "Jumlah biasa" hint reads the saved fees (refetched after "Simpan Tarif"), never unsaved grid edits.
- Empty state: a plain sentence that a paket needs a school program and a daycare program with the same fee component.
- Save message: "Harga paket disimpan. Draf tagihan yang sudah dibuat perlu dihitung ulang."
- Existing Shadcn table/Rupiah input; no new visual language (design-system respected).

## Test seams

- Pure builder: bundle replaces the summed component for the matching pair; third program added on top; one-program component
  untouched; two matching bundles fall back to the sum; leave drops daycare (no bundle); PERCENT + FIXED keringanan on a bundle;
  TK A vs TK B; disabled component invents no line; no bundles → byte-identical to today.
- Per-student scope: builder and materializer (a student with one ticked placement is priced for all, exclusions win, a student
  with no ticked placement and no include is out).
- Loaders: both read the active bundle rows for the year and programs involved with the same filters (tenant, active, types,
  billable component); no query when fewer than two programs.
- API: permissions, tenant, program types, component rules, amount rules, atomic upsert/clear, audit, no duplicate triple.
- Component: renders, edits, saves, dirty gate incl. year switch, read-only without edit rights; the fees page test mock covers
  the new fetch.
- One e2e: set a bundle price, give a child both placements, tick one class, the draft shows the bundle amount, clearing restores
  the sum.

## Non-goals

- A per-class or per-student price, a package of more than two programs, a bundle for one-time (registration) fees.
- Changing the class picker hint, the Ubah Kelas preview or `Program.enrollmentFee`.
- Auto-creating the daycare enrolment from the application form's daycare add-on tick.
- Re-pricing invoices already created or runs already committing (the manual invoices the admin sent stay as they are).
- Making "Catat SPP di muka" leave-aware.

## Assumptions

1. The school's groups map to programs (TKIT-A, TKIT-B) as in the staging data; a tenant that keeps one program with several
   classes gets one bundle price for all of them.
2. A daycare program is type YEAR_ROUND and a school program SEMESTER (the streams the enrolment rule already uses).
3. A bundle price is a monthly amount for the component, like the program fees it replaces.
4. Run scope semantics: the run's class ticks decide **which students** are billed; each billed student is priced for everything
   they hold that year.

## Gate re-openers

Schema migration: one new table `ProgramBundleFee` (additive, tenant-scoped, RLS policy, Restrict FKs). A deliberate behaviour
change to the Billing Run's scope (Decision 4), stated above and in the PR. No new dependency, no auth/session change (a new route on
existing permissions), no production write by the agent.

## Tasks

- [x] T1 Schema + migration: `ProgramBundleFee` (tenantId, academicYearId, schoolProgramId, daycareProgramId, feeComponentId,
      amount, status ACTIVE|INACTIVE, createdAt, updatedAt; unique on the four ids; index tenant+year+status; named relations;
      back-relations), RLS migration `20261029010000_add_program_bundle_fee`, seed `deleteMany` before fee structures, `lib/db.ts`
      parity note — accept: `db push` + seed clean, `verify-rls-coverage.sh` green (reuse: EnrollmentLeave migration)
- [x] T2a Per-student run scope: builder admits a student when any enrollment is ticked or the student is included (exclude
      wins) and groups all of that student's enrollments; the materializer fetches all of an admitted student's active
      enrollments that year — accept: builder + materializer tests, existing rule tests green (deps: T1 not needed; sequence
      before T2)
- [x] T2 Bundle pricing: `lib/finance/bundle-fees.ts` (`loadBundleFees`), optional `bundleFees` into `buildBillingRunRows`
      (contains-the-pair rule, exactly one match, both-program component only), both loaders call it, mocks updated — accept:
      builder, bundle-fees, materialize, prepay-load tests (deps: T1, T2a)
- [x] T3 API `app/api/fee-bundles` (GET year + saved program fees + `canEdit`, one atomic PUT, validation, `fees.view`/`fees.edit`,
      rate limit, audit, no caching) — accept: route tests (deps: T1; parallel with T2a/T2)
- [x] T4 UI: `components/admin/fees/bundle-fees-section.tsx` on Tarif per Program, shared dirty gate, read-only without edit —
      accept: component tests, fees page test mock (deps: T3)
- [x] T5 e2e + docs: e2e spec, README, UAT job, glossary row "Harga paket", counts, full local gate, PR (deps: T2–T4)

## Implementation

- Plan: driver=claude-sonnet-5-5 (plan reviewed by Opus 5.5), workers=sonnet; T1 inline (tiny, the table everything reads); then in parallel:
  worker A = T2a then T2 (same builder/loader files, strictly sequential), worker B = T3 then T4 (API shape feeds the UI; disjoint files from A);
  T5 inline/worker after both (e2e, docs, gate, PR).
- T1: prisma/schema.prisma, prisma/migrations/20261029010000_add_program_bundle_fee/migration.sql, prisma/seed.ts, lib/db.ts note — `ProgramBundleFee` (additive,
  RLS, Restrict FKs, named relations, soft-delete `status`), explicit short unique index name (the generated one exceeds Postgres' 63 chars). `verify-rls-coverage.sh`
  46/46; `db push` + seed clean on a freshly created database.
- T2a: lib/finance/build-billing-run.ts, lib/finance/materialize-billing-run.ts, app/api/billing-runs/[id]/route.ts (+ tests) — the run is now scoped per
  student: a student is in when any active placement is in a ticked class (or they are included; exclusions win) and is priced for ALL their active
  placements that year; the review row's program label lists them all. A deliberate change of an existing behaviour (before, a run for one class
  priced only that placement, so a school+daycare child ticked on one class lost the other fee and a later run skipped them as already invoiced).
  No existing builder rule test needed changing; the materialize `fakeDb` and one label test (which encoded the old rule) were updated.
- T2: lib/finance/bundle-fees.ts (new), build-billing-run.ts, materialize-billing-run.ts, spp-prepay-load.ts (+ tests) — `loadBundleFees` (active rows, tenant,
  both program types re-checked, billable component, no query for <2 programs) feeds an optional `bundleFees` into the builder: when a component's merged
  line comes from both programs of exactly one bundle, amount = bundle + any other program's amount; else the sum. Both loaders pass it; prepay stays
  leave-unaware. Worker reported 704 tests; re-run by the driver after the label fix: 43 files / 704 tests pass, `tsc` and eslint clean.
- T3: app/api/fee-bundles/route.ts, lib/validations/fee-bundle.ts + tests — GET (`fees.view`; programs, billable components, saved program fees, bundles incl. INACTIVE, `canEdit`)
  and one atomic PUT per year (`fees.edit`, rate limit, advisory lock, whole-rupiah > 0, school SEMESTER + daycare YEAR_ROUND, enabled recurring component both programs
  price, clearing always allowed and a soft delete, no write/audit when unchanged, `recordAudit` in the transaction). No `revalidate`. Re-run by the driver: 46 files / 945 tests,
  `tsc`, eslint, `verify-api-auth.sh` 225/225.
- T4: components/admin/fees/bundle-fees-section.tsx, app/admin/fees/page.tsx (+ tests) — "Harga paket sekolah + daycare" section on Tarif per Program: one block per daycare program,
  rows = school program × component both programs price (or already bundled), "Jumlah biasa" from saved fees, own save sending only changed cells, read-only without `fees.edit`,
  year-switch discard gate now covers bundle edits, hints refetch after "Simpan Tarif". Checked against design-system (existing Table, RupiahInput, SectionCard). Re-run by the driver:
  46 files / 945 tests pass.
- T4 follow-up (found by looking at a 390px screenshot of the built page): the four-column table scrolled sideways inside the card and hid the "Harga paket" input, the one field
  the admin must fill. Below `sm` each row now stacks (`max-sm:` utilities on the same cells, one DOM, one set of inputs, labels via `data-label` pseudo-content); at 640px and up
  the markup and look are unchanged. design-system respected (existing Table, RupiahInput, 44px touch floor, 16px input text below md).
- T5: e2e/admin-fee-bundle.spec.ts — one test: school class ticked only → SPP line is the sum; set a bundle price through the UI → rebuild → exactly the bundle amount; daycare class
  ticked only → same bundle amount for the same child (per-student scope); clear through the UI → rebuild → the sum again; cleanup withdraws the daycare placement, cancels runs
  and deactivates the price. Passed twice in a row on the production build. README (Billing line; a >600-char line the hook does not check was shortened), UAT job
  JTBD-ADMIN-FEE-03, glossary "Harga paket", counts via `audit-docs.sh --write`.

## Verification

## Ship Notes
