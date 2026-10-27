# Class ↔ program setup an admin can get right

## Context

An admin billing TK A (Kelas TK A 1/3/4, 2026/2027) saw Rp 504.000 SPP in the Buat Tagihan wizard, which is TK B's
rate. Tarif per Program was correct (TK A 499.000, TK B 504.000). Root cause, confirmed on production: all 35 active
TK A students sat in classes linked to the **TK B** program, so the wizard correctly billed TK B's fees. The program
link of a class is the only thing that picks the fee structure.

Why the admin could not catch or fix it themselves:
- Ubah Kelas locks Program after creation ("Kampus dan program tidak dapat diubah"), so a wrong link can only be
  fixed by a developer.
- Nothing on the billing wizard says which program a class or row belongs to, so a wrong rate looks plausible.
- Tarif per Program does not say which classes use a program.
- Program names on production are easy to confuse ("TK  B" with a double space, codes `TKIT` vs `RA/TKIT`).

Already done outside this cycle: the three production classes were relinked to the TK A program (data fix, no code).

## Decisions

1. **Program is editable on an existing class** (current or planning year, never archived), because a locked wrong
   link has no admin remedy. The dialog shows impact before saving: old → new recurring fee per period (what a billing run bills, which is the SPP when SPP is the only recurring fee) and the number of active students.
2. **Blocked when the class's students already hold invoices for that year** — changing the program then would make
   issued invoices disagree with the class. The message names the reason and says what to do.
3. **Visibility lives where the mistake is made and where it is caught**: billing wizard (step 1 picker and step 2
   rows) and Tarif per Program. The Kelas list is untouched.
4. **Setup check in wizard step 1** warns, never blocks: a class with no fee structure for the chosen year, or whose
   name points at a different program than the one it is linked to. Only names are compared (A/B after a TK/KB/RA/TKIT
   prefix, against the group a program name carries); the class's kelompok usia is required on every class, daycare
   included, so it is too weak a signal to warn on.
5. Program names are trimmed and whitespace-collapsed on save so near-duplicates like "TK  B" stop appearing.
6. (Added in build, from review.) A move to a program of a **different type** (school vs daycare) is refused when a
   student in the class would end up with two active enrolments of that type this year, the same rule the enrolment
   screens enforce. The fee preview needs the finance permission on top of the class permission, because it shows
   fee amounts.

## Acceptance criteria

- [ ] In Ubah Kelas, an admin can change a class's Program; for an archived year it stays read-only.
- [ ] Choosing a new program shows the old and new SPP and the active student count before saving.
- [ ] Saving changes the class's fee source: a rebuilt billing draft for that class uses the new program's rates.
- [ ] A move that would give a student two active enrolments of one program type in the year is refused and names the student and class.
- [ ] The fee preview is visible only to roles that can view fees.
- [ ] A class whose students already have invoices for that year cannot change program and says why.
- [ ] Billing wizard step 1 shows each class with its program and SPP in the picker.
- [ ] Billing wizard step 2 shows each row's program next to the class label.
- [ ] Step 1 shows a warning (not a blocker) for a selected class with no fee structure, or whose name suggests another program.
- [ ] Tarif per Program lists the classes (and student counts) that use the selected program and year, with a warning on a class that looks mislinked.
- [ ] Program names with doubled or edge whitespace are saved normalized.
- [ ] Changing a program is recorded in the audit log.

## Verify flows

1. **Fix a mislinked class (admin).** Start at Kelas, 2026/2027. Open Ubah Kelas on a class linked to the wrong program,
   change Program, read the impact line, save. Program column updates; Buat Tagihan for that class now shows the
   right SPP. Data: two programs with different SPP, a class with active students and no invoices.
2. **Catch it before billing.** Start at Tagihan → Buat Tagihan. Pick a class linked to the other program. Step 1 shows
   program and SPP in the picker and a warning; step 2 rows show the program. No commit needed.
3. **Edge: class with invoices.** Class whose students have an invoice for the year → Program field is disabled or save
   is refused with the reason; nothing changes.
4. **Error: archived year.** Open Kelas for an archived year → no edit action, Program stays read-only.

## UX notes

- Impact line in Ubah Kelas, Indonesian per `voice.md`: "Tagihan rutin per periode berubah dari Rp 504.000 ke Rp 499.000 untuk 13 siswa aktif. Draf tagihan yang sudah dibuat perlu dibuat ulang."
- Program shown as secondary text under the class label in the wizard picker, with the rate: "TK A · SPP Bulanan Rp 499.000" for one recurring fee (its own name, never a bare total), "Rp 604.000 / periode (2 komponen)" for several, "belum ada tarif rutin" for none. Only the program name may truncate on a phone, never the rate. Review rows show "class · program".
- Wizard warning is an inline Alert in step 1 directly under the class picker (next to the selection it is about, so it does not shift the picker), in an always-mounted live region, listing class names; no modal.
- Tarif per Program: a "Dipakai oleh" section (h2) below the fee table; empty state "Belum ada kelas yang memakai program ini di tahun ajaran ini…"; a quiet note, not an error, for a role without class access.
- Frontend gate: verify against `design-system` and the `crud.md`, `patterns.md`, `voice.md` standards.

## Test seams

- Vitest: class update API (program change allowed/blocked, audit, archived year, tenant scope).
- Vitest: pure setup-check helper (no fee structure, name-vs-program mismatch).
- Vitest + jsdom: Ubah Kelas impact line; wizard step 1 warning; step 2 program text; Tarif "Dipakai oleh".
- Playwright (local, `e2e` label): admin fixes a class program and sees the corrected SPP in the wizard.

## Non-goals

- Bulk relink of many classes at once.
- Changing the shared ClassTrack plumbing or backfilling track programs (billing and roll-forward read the section's program).
- Redesigning Tarif per Program or the wizard flow beyond the additions above.
- Fixing already-issued invoices.

## Assumptions

1. "Already has invoices" means any non-void invoice for a student enrolled in that class in that academic year.
2. Name-vs-program mismatch is a simple heuristic (class name starts with "TK A"/"TK B"/"KB" etc. versus the linked program's name); a false warning is harmless because it never blocks.
3. Only users with `academic.edit` can change the program, same as today's class edit.
4. Program name normalization applies to new saves only; existing rows are not rewritten.
5. No schema migration: only `ClassSection.programId` is updated.

## Gate re-openers

None (no migration, dependency, auth/PII change, production write or paid API). Sensitive-path note: touches
`app/api/**` and tenant-scoped writes, so the security standard applies.

## Tasks

- [x] T1 Allow program change in class update API — accept: PATCH with `programId` works for active/planning year, 409 with reason when students have invoices, audited, tenant-scoped (deps: none)
- [x] T2 Pure setup-check helper (missing fee structure, name vs program) — accept: unit tests cover both warnings and the clean case (deps: none; parallel with T1)
- [x] T3 Ubah Kelas: editable Program with impact line — accept: shows old → new SPP and student count; disabled for archived year / invoiced class (deps: T1)
- [x] T4 Wizard step 1: program + SPP in class picker and setup warning — accept: warning appears for a mislinked or fee-less class, does not block (deps: T2)
- [x] T5 Wizard step 2: program next to class label on each row — accept: row shows program name (deps: none)
- [x] T6 Tarif per Program: "Dipakai oleh" class list with warning — accept: lists classes and counts for selected program+year (deps: T2)
- [x] T7 Normalize program names on save — accept: "TK  B " saves as "TK B" (deps: none; parallel)
- [ ] T8 Playwright: fix a class program, see corrected SPP — accept: passes locally (deps: T1, T3, T5)

## Implementation

- Plan: driver=claude-sonnet-5-5, workers=claude-sonnet-5-5 (independent review subagents; no cheaper tier was used). T1, T2, T7 are independent and done inline in sequence, because each is a small slice sharing the same read context; T3→T4/T5/T6 follow in dependency order; reviews run per API/UI slice on the staged diff.
- T1: `app/api/admin/classes/[id]/route.ts`, `…/program-impact/route.ts`, `lib/classes/program-change.ts`, `lib/finance/billable-fees.ts` (+ `materialize-billing-run.ts` using it), `lib/validations/class.ts`, two route test files — PATCH accepts `programId` (ACTIVE program of the tenant; advisory lock; compare-and-set write; audited as `class.program_change`); 409 when students already hold invoices (billing-run link or created since the year's Jakarta start) or when a different-type move would double a student's stream; new read-only `program-impact` route for the dialog (needs `academic.view` and `fees.view`). The impact shows the recurring fee total a billing run would bill per period, which equals SPP when SPP is the only recurring fee; T3 words it "tagihan rutin per periode". Independent standards/spec and security reviews raised: fees.view gate, stream-conflict rule, UTC vs Jakarta cutoff, billing-run link for pre-start invoices, race/CAS, missing archived/planning tests — all fixed; `ClassTrack.programId` deliberately left alone (Non-goals). Query shapes verified against real Postgres (seeded local DB).
- T2: `lib/classes/setup-check.ts` (+ test) — pure `checkClassSetup`: NO_FEE_STRUCTURE and PROGRAM_NAME_MISMATCH (the A/B group a class name carries vs the one its program name carries; names only); warnings only.
- T7: `lib/validations/program.ts` (+ test) — program name collapses inner whitespace and trims, on create, update and the admin form schema; existing rows untouched (an admin renames "TK  B" from the Program screen). Pinned by five schema tests.

- T3: `app/admin/classes/client.tsx`, `components/admin/classes/program-change-impact.tsx` (+ tests) — Program is editable in Ubah Kelas (Kampus stays locked); choosing another program mounts the impact panel (old → new per-period fee, active students, "draf perlu dibuat ulang"; destructive Alert and disabled Simpan when the server would refuse; plain fallback note when the preview 403s/fails, save still allowed since the server enforces the guards); `programId` is sent only when changed. The panel ignores a response that was superseded by a newer choice (race caught by its own test). Cross-checked against `design-system` (Field/FieldDescription forms, shared Alert) and `crud.md`/`voice.md`.
- T4: `app/api/class-sections/route.ts` (opt-in `?include=fees` → `recurringFeeTotal`, left out for a role with neither `fees.view` nor `invoices.view`), `components/admin/class-section-picker.tsx` (opt-in `showProgram`: second line "TK A · Rp 499.000 / periode"), `components/admin/classes/class-setup-warnings.tsx`, `step-1-scope.tsx` — the picker names each class's program and rate; a non-blocking Alert lists selected classes with no fee structure or whose name points at another program.
- T5: `app/api/billing-runs/[id]/route.ts`, `step-2-review.tsx`, `types.ts` — each review row shows "class · program". The label is derived on read from current active enrolments with the builder's own scope rule (no schema change); it shows the new program if a class was moved after the draft was built, which is the cue to rebuild.
- T6: `components/admin/fees/program-classes-usage.tsx`, `app/admin/fees/page.tsx` — Tarif per Program gets "Dipakai oleh": the active classes of the selected program and year with campus and student count, plus the mismatch warning.
- T2/T4/T5/T6 share the setup-check helper and the README line, so they are one commit (the `feat` hook wants README staged with each); fixes from the reviews follow as their own commit. The API security/correctness review is already applied here (fee totals gated, enrolment query matches the builder); the UI/spec review had not reported at commit time.
- T8: `e2e/admin-class-program.spec.ts` — two flows: an admin moves a class to another program in Ubah Kelas (impact line, save) and sees the program and rate in the billing wizard picker; a class whose students are invoiced shows the reason, disables Simpan, and the API answers 409. Written and lint/type-clean; **not yet run** (not ticked) — it runs in verify-local against the production build.
- Review fixes (UI/spec reviewer): the picker no longer calls a sum of several components "SPP" (`/api/class-sections?include=fees` now also returns `recurringFeeLines` and the lone component's label); rate stays untruncated on a phone; "Dipakai oleh" is an h2 with a full-width link and a quiet 403 note; the setup warning lives in an always-mounted live region with terser copy; one phrase ("belum ada tarif rutin") on every screen; the program check recognises "TKB", "TK-B", "TK B (Reguler)"; the kelompok-usia fallback was dropped (too weak a signal); fragile picker test rewritten with realistic ids.
- Browser walk polish: with several mislinked classes the warning repeated "Jika salah, ubah program di Kelas → Ubah Kelas…" on every line; each class now gets a short line and the guidance appears once below the list.

## Verification

## Ship Notes
