# Harga paket sekolah + daycare — one price for a child who holds both placements

## Context

An admin sends the "SPP sekolah + daycare" invoice by hand every month because the app cannot price it. Her prices are bundles,
not a sum of two fees:

| Group | SPP sekolah | SPP sekolah + daycare | Daycare part |
|---|---|---|---|
| TK A | Rp 499.000 | Rp 1.560.000 | Rp 1.061.000 |
| TK B | Rp 504.000 | Rp 1.500.000 | Rp 996.000 |

Facts from the code (looked up, not asked):
- A child may hold one school placement (Program type SEMESTER) and one daycare placement (YEAR_ROUND) in a year. The Billing
  Run and "Catat SPP di muka" (SPP paid in advance) already merge the two into one invoice, but a fee component both programs
  carry (the shared SPP component) is **summed**: school SPP + the daycare program's single SPP.
- Fees are stored per program per year (`ProgramFeeStructure`). Daycare is one program, so it has one fee: it cannot be
  1.061.000 for TK A children and 996.000 for TK B children.
- Both billing paths go through one pure builder (`buildBillingRunRows`), fed by exactly two loaders (the Billing Run
  materializer and the SPP-prepay loader), which must keep pricing identically.
- A keringanan on a merged component is applied once to the merged (summed) amount; that must keep working with a bundle.
- A child whose daycare placement is on leave (cuti) is billed school-only (the leave drops that placement before pricing).

## Decisions

Taken on the product owner's behalf ("proceed with your best judgement"); each is cheap to change later.

1. **A bundle price is an explicit amount for one fee component, for one school program + one daycare program, for one academic
   year.** When a child's billed placements are exactly that school program and that daycare program, that component's line is
   the bundle amount instead of the sum. No bundle price set → today's summing, unchanged.
2. **Per school program, not per class**: every TK A class shares TK A's bundle price (in the app TKIT-A and TKIT-B are separate
   programs). The pair is the key, so any school program can have its own bundle with the daycare program.
3. **Per component.** The bundle replaces only the component it is set for (normally SPP). Other shared recurring fees (meals,
   activities) keep summing unless a bundle price is set for them too. The admin screen offers every recurring component both
   programs carry, with the normal sum shown as the hint.
4. **Both billing paths price it the same**: the Billing Run (create and rebuild) and "Catat SPP di muka".
5. **Edited on the existing "Tarif per Program" screen** in a new section "Harga paket sekolah + daycare", for the selected
   academic year. Clearing an amount removes the bundle price for that component (back to summing).
6. **Needs `fees.edit` to change, `fees.view` to read**; every change is audit-logged (create, change, remove).
7. **The invoice line keeps its label** ("SPP Bulanan (D'Care + TKIT-A)"); only the amount differs. A keringanan on that
   component applies to the bundle amount.
8. **Leave and bundle**: if the daycare placement is on cuti for the month, the child is billed the school price only.
9. **Not in this cycle**: the per-class "SPP Rp 499.000" hint in the class picker stays the school-only price (a class cannot
   know who also takes daycare); the Ubah Kelas fee-change preview is not bundle-aware; one-time registration fees are untouched.

## Acceptance criteria

- [ ] An admin with fee-edit rights can set, change and clear a "SPP sekolah + daycare" amount for a school program on the Tarif
      per Program screen; the screen shows the normal sum beside it, saves only what changed, and warns about unsaved edits.
- [ ] A Billing Run for a child holding that school program and the daycare program bills that component at the bundle amount
      (TK A child → Rp 1.560.000, TK B child → Rp 1.500.000 with the example prices), in one invoice with the school and
      daycare programs named on the line.
- [ ] A child holding only the school program is billed the school price; only daycare, the daycare price (unchanged).
- [ ] With no bundle price for the pair, the child is billed the sum, exactly as today.
- [ ] Other shared recurring fees without a bundle price still sum.
- [ ] A percentage keringanan on the component is computed from the bundle amount.
- [ ] "Catat SPP di muka" prices the same child the same way (preview and settlement).
- [ ] A child whose daycare placement is on leave for the month is billed school-only.
- [ ] Rebuilding an existing draft after a bundle price changes uses the new price.
- [ ] A bundle price can only be set between a school program (not daycare) and a daycare program of the same school, for a
      recurring fee component of the school, with an amount above zero; another school's data is refused.
- [ ] A user without fee-edit rights cannot change a bundle price; every change is audit-logged.

## Verify flows

1. **Admin, set and bill:** on Tarif per Program, pick the 2025/2026 year, open "Harga paket sekolah + daycare", enter the TK A
   SPP bundle price, save. Register a child in a TK A class and the daycare class (both active). Open the Billing Run wizard for
   that child's class: the row shows the bundle amount and the invoice line names both programs.
2. **Fallback:** clear the bundle price, rebuild the draft: the row returns to the sum.
3. **Edge:** a child with school + daycare on leave for the month bills the school price only; a TK B child uses the TK B price,
   not TK A's.
4. **Error:** entering 0 or a negative number is refused with a clear message; a user without fee-edit rights sees the section
   read-only (or refused on save).
5. **SPP di muka:** the preview for the same child shows the bundle price per month.

## UX notes

- A card under the program fee table: "Harga paket sekolah + daycare" with a one-line explanation ("Isi kalau anak yang ikut sekolah
  dan daycare ditagih satu harga paket. Kosongkan untuk memakai jumlah biasa: tarif sekolah + tarif daycare.").
- A table: one row per school program × recurring component both programs carry; columns Program sekolah, Komponen, "Jumlah biasa"
  (school + daycare, read-only), "Harga paket" (Rupiah input, empty = not set). One section per daycare program.
- Empty state when the year has no daycare program or no school program: a plain sentence saying a paket needs one of each.
- The page's own Simpan/unsaved-changes behaviour is mirrored (dirty gate, discard confirm) for this section's own save button.
- Existing Shadcn table/Rupiah input; no new visual language (design-system respected).

## Test seams

- Pure builder: bundle replaces the summed component for the exact pair; other components sum; no bundle → byte-identical to
  today; keringanan percent from the bundle; leave drops the daycare so no bundle; school-only and daycare-only unchanged.
- Loaders: both read the bundle rows for the year and the programs involved (materialize and SPP-prepay), keyed identically.
- API: permission, tenant, program/component validation, amount validation, upsert/remove, audit.
- Component: the section renders, edits, saves, warns on unsaved changes; the page test mock covers the new fetch.
- One e2e: set a bundle price, give a child both placements, a draft billing run shows the bundle amount, clearing it restores the sum.

## Non-goals

- A per-class or per-student price, packages for more than two programs, a bundle for one-time (registration) fees.
- Changing the class picker hint, the Ubah Kelas preview, or `Program.enrollmentFee`.
- Auto-creating the daycare enrolment from the application form's daycare add-on tick.
- Back-filling or recalculating invoices already sent (the manual ones the admin created stay as they are).

## Assumptions

1. The school's groups map to programs (TKIT-A, TKIT-B) as in the staging data; if a tenant keeps one program with several
   classes, one bundle price covers them all (a price per class is a follow-up).
2. A daycare program is one with type YEAR_ROUND and a school program one with type SEMESTER (the same streams the enrolment
   rule already uses); SESSION (pop-up) programs have no bundle.
3. A bundle price is an amount per month for the component, like the program fees it replaces.

## Gate re-openers

Schema migration: one new table `ProgramBundleFee` (additive, tenant-scoped, RLS policy like its siblings, Restrict FKs).
No new dependency, no auth or session change (a new route using the existing permissions), no production write by the agent.

## Tasks

- [ ] T1 Schema + migration: `ProgramBundleFee` (tenantId, academicYearId, schoolProgramId, daycareProgramId, feeComponentId,
      amount, createdAt, updatedAt; unique on the four ids; index tenant), RLS migration, seed `deleteMany` — accept:
      `db push` + seed clean, `verify-rls-coverage.sh` green (reuse: EnrollmentLeave migration)
- [ ] T2 Builder + both loaders: optional bundle map into `buildBillingRunRows`; materialize and SPP-prepay load the year's
      bundle rows for the programs involved — accept: builder, materialize, prepay-load unit tests (deps: T1)
- [ ] T3 API `app/api/fee-bundles` (GET year + program fees, PUT one pair's prices, validation, `fees.edit`, audit) — accept:
      route tests (deps: T1; parallel with T2)
- [ ] T4 UI: "Harga paket sekolah + daycare" section on Tarif per Program — accept: component tests, page test mock updated
      (deps: T3)
- [ ] T5 e2e + docs: e2e spec, README, UAT job, glossary row, counts, full local gate, PR (deps: T2–T4)

## Implementation

## Verification

## Ship Notes
