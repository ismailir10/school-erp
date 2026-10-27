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
   link has no admin remedy. The dialog shows impact before saving: old → new SPP and the number of active students.
2. **Blocked when the class's students already hold invoices for that year** — changing the program then would make
   issued invoices disagree with the class. The message names the reason and says what to do.
3. **Visibility lives where the mistake is made and where it is caught**: billing wizard (step 1 picker and step 2
   rows) and Tarif per Program. The Kelas list is untouched.
4. **Setup check in wizard step 1** warns, never blocks: a class with no fee structure for the chosen year, or whose
   name points at a different program than the one it is linked to.
5. Program names are trimmed and whitespace-collapsed on save so near-duplicates like "TK  B" stop appearing.

## Acceptance criteria

- [ ] In Ubah Kelas, an admin can change a class's Program; for an archived year it stays read-only.
- [ ] Choosing a new program shows the old and new SPP and the active student count before saving.
- [ ] Saving changes the class's fee source: a rebuilt billing draft for that class uses the new program's rates.
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

- Impact line in Ubah Kelas, Indonesian per `voice.md`, e.g. "SPP berubah dari Rp 504.000 ke Rp 499.000 untuk 13 siswa aktif. Draf tagihan yang sudah dibuat perlu dibuat ulang."
- Program shown as secondary text under the class label in the wizard (muted, same pattern as campus in lists).
- Wizard warning is an inline Alert in step 1 above the class picker, listing class names; no modal.
- Tarif per Program: a "Dipakai oleh" section below the fee table; empty state "Belum ada kelas yang memakai program ini".
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

- [ ] T1 Allow program change in class update API — accept: PATCH with `programId` works for active/planning year, 409 with reason when students have invoices, audited, tenant-scoped (deps: none)
- [ ] T2 Pure setup-check helper (missing fee structure, name vs program) — accept: unit tests cover both warnings and the clean case (deps: none; parallel with T1)
- [ ] T3 Ubah Kelas: editable Program with impact line — accept: shows old → new SPP and student count; disabled for archived year / invoiced class (deps: T1)
- [ ] T4 Wizard step 1: program + SPP in class picker and setup warning — accept: warning appears for a mislinked or fee-less class, does not block (deps: T2)
- [ ] T5 Wizard step 2: program next to class label on each row — accept: row shows program name (deps: none)
- [ ] T6 Tarif per Program: "Dipakai oleh" class list with warning — accept: lists classes and counts for selected program+year (deps: T2)
- [ ] T7 Normalize program names on save — accept: "TK  B " saves as "TK B" (deps: none; parallel)
- [ ] T8 Playwright: fix a class program, see corrected SPP — accept: passes locally (deps: T1, T3, T5)

## Implementation

## Verification

## Ship Notes
