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

- [x] In Ubah Kelas, an admin can change a class's Program; for an archived year it stays read-only.
- [x] Choosing a new program shows the old and new SPP and the active student count before saving.
- [x] Saving changes the class's fee source: a rebuilt billing draft for that class uses the new program's rates.
- [x] A move that would give a student two active enrolments of one program type in the year is refused and names the student and class.
- [x] The fee preview is visible only to roles that can view fees.
- [x] A class whose students already have invoices for that year cannot change program and says why.
- [x] Billing wizard step 1 shows each class with its program and SPP in the picker.
- [x] Billing wizard step 2 shows each row's program next to the class label.
- [x] Step 1 shows a warning (not a blocker) for a selected class with no fee structure, or whose name suggests another program.
- [x] Tarif per Program lists the classes (and student counts) that use the selected program and year, with a warning on a class that looks mislinked.
- [x] Program names with doubled or edge whitespace are saved normalized.
- [x] Changing a program is recorded in the audit log.

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
- [x] T8 Playwright: fix a class program, see corrected SPP — accept: passes locally (deps: T1, T3, T5)

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
- T8: `e2e/admin-class-program.spec.ts` — two flows: an admin moves a class to another program in Ubah Kelas (impact line, save) and sees the program and rate in the billing wizard picker; a class whose students are invoiced shows the reason, disables Simpan, and the API answers 409. Passes on the production build against a fresh local Postgres (see Verification).
- Review fixes (UI/spec reviewer): the picker no longer calls a sum of several components "SPP" (`/api/class-sections?include=fees` now also returns `recurringFeeLines` and the lone component's label); rate stays untruncated on a phone; "Dipakai oleh" is an h2 with a full-width link and a quiet 403 note; the setup warning lives in an always-mounted live region with terser copy; one phrase ("belum ada tarif rutin") on every screen; the program check recognises "TKB", "TK-B", "TK B (Reguler)"; the kelompok-usia fallback was dropped (too weak a signal); fragile picker test rewritten with realistic ids.
- Browser walk polish: with several mislinked classes the warning repeated "Jika salah, ubah program di Kelas → Ubah Kelas…" on every line; each class now gets a short line and the guidance appears once below the list.

## Verification

Diff classification: compared `origin/staging...HEAD` (merge base `fa56e3e1`, head `83907c5a` for code). Changed paths: `app/api/{admin/classes,class-sections,billing-runs}`, `app/admin/{classes,fees}`, `components/admin/{classes,fees,invoices,class-section-picker}`, `lib/{classes,finance,validations}`, `e2e/`, `README.md`, `docs/`. No auth, session, cookie, guard, dependency or schema file → **other code** (verify-local only, no signed-in staging check). The new routes add `academic.*` / `fees.view` permission checks through the existing `requirePermission` / `hasPermission`; no guard logic changed. Soft-skip delta vs `origin/staging`: 26 → 26 (0).

### Verified locally — 83907c5a, 2026-10-27
- Gate: `npm run lint` → exit 0 (run without my local git-excluded Playwright helper); `verify-rls-coverage.sh` → "RLS coverage OK: 44 / 44"; `verify-api-auth.sh` → "API auth coverage OK: 219 / 219"; `npx vitest run` (no DEMO_MODE) → "Test Files 709 passed | 2 skipped (711), Tests 8389 passed | 42 todo"; `DEMO_MODE=true npm run build` → exit 0; `npx playwright test` (production build, Chromium, workers 1, **fresh seeded local DB**) → "252 passed (6.9m)", including the two new `admin-class-program` flows. `bash scripts/audit-docs.sh` → 0 fail.
- App: production build on http://localhost:3000, demo auth (`u_super_admin`), disposable local Postgres 16, Xendit/DOKU test stubs.
- Walked (admin, 1440×900 and 390×844): Buat Tagihan step 1 (picker shows "TK B · SPP Bulanan Rp 504.000" per class; selecting a TK A class linked to TK B shows "Periksa sebelum lanjut" with the fix stated once) → step 2 (rows read "TK A … · TK B") → Tarif per Program → Dipakai oleh (warning + class list) → Ubah Kelas: Program editable, "Tagihan rutin per periode berubah dari Rp 504.000 ke Rp 499.000 untuk 3 siswa aktif", saved, class re-read as TK A. Edge: a class with 0 students and one on a one-component program read correctly. Error case: a seeded invoiced class → "Program tidak bisa diubah karena 10 siswa … sudah punya tagihan", Simpan disabled, and the API answers 409 `PROGRAM_HAS_INVOICES` (Playwright). Phone: picker second line keeps the rate, no horizontal overflow. Also on the final build: a PLANNING-year class accepts the move (200); an ARCHIVED-year class list shows the banner with no Tambah Kelas and no row actions, and the API answers 403 `YEAR_ARCHIVED`; creating a program named "  TK    Z  " saves "TK Z"; the audit log holds `class.program_change` rows with before and after `programId`.
- Console/network: clean apart from `/_vercel/insights` and `/_vercel/speed-insights` script 404s, which exist only on Vercel hosting (pre-existing, unrelated). No 5xx, no dead clicks.
- Screenshots: highlight `1-wizard-picker-shows-program-and-rate.png`, `2-wizard-step1-warning.png`; also `3-wizard-step2-rows-name-program`, `4-tarif-dipakai-oleh-warning`, `5-ubah-kelas-impact`, `6-ubah-kelas-blocked`, `7-phone-picker` (desktop + phone), kept in the session scratchpad.
- Highlight: `1-wizard-picker-shows-program-and-rate.png`, `2-wizard-step1-warning.png`
- Rounds: 3 — fixed: stale preview response applied after a newer choice (caught by its own test); picker called a sum of several recurring fees "SPP" (now the lone component's own name or a component count); rate clipped on a phone; warning repeated its fix-it sentence per class; kelompok-usia fallback dropped as too weak a signal; program check missed "TKB"/"TK-B"; and API/security review items (fees.view gate, program-type stream rule, UTC vs Jakarta cutoff, billing-run link for pre-start invoices, compare-and-set write).
- Not checked: PR screenshot upload to `pr-assets` (`gh` has no valid token in this environment); a real Xendit/DOKU payment-link round trip (stubbed in e2e, untouched by this diff); the signed-in staging check (not required for this classification). One earlier Playwright pass on a *reused, polluted* local DB failed `journal-day-mark.spec.ts` ("a wali sees the keterangan…"); the pre-change code (`fa56e3e1`) fails it identically on that DB and passes on a pristine one, and the full suite is green on a fresh DB with this branch — a test-database artifact, not this diff.

## Ship Notes

- Migrations: none. Env vars: none. New routes: `GET /api/admin/classes/[id]/program-impact`; opt-in `?include=fees` on `GET /api/class-sections`; `programLabel` added to `GET /api/billing-runs/[id]` rows.
- **Production data already changed, outside this PR** (before the code, on explicit request): `ClassSection.programId` for TK A 1 / TK A 3 / TK A 4 (2026/2027) set from the TK B program (`program_61228711d354b0371994`) to TK A (`cmugxc7xs000004kwylwdu0xi`); ids `sec_7b1032e5fe852a45c8c7`, `sec_4d178d57027c8401702d`, `sec_f1e71ac88dcfcf37100b`. Anyone holding a Buat Tagihan draft built before that must "Hitung Ulang" / rebuild it. Rollback of the data = set those three `programId`s back.
- Known limits: the invoice guard is "non-cancelled invoice for a student of the class from a committed billing run of that year, or created since the year's Jakarta start" — a manual invoice issued before the start date is not seen. `ClassTrack.programId` is left as is when a class changes program (billing and roll-forward read the section's own program). Invoice creation takes no class lock, so a billing commit racing the program change can slip through the invoice check.
- Post-merge: staging deploy READY for the merge SHA; no signed-in check (not auth-impacting). Manual follow-up for the school: relink any other mislinked class from Kelas → Ubah Kelas; rebuild the existing TK A draft.
- Rollback: revert the squash commit; no data migration to undo.
