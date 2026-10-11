# Pendaftaran simplify — one pipeline from lead to student

Cycle: 2026-10-11 · Branch: `claude/intelligent-archimedes-i25p8i` · Role: cto

## Context

Today a family goes through **two lists, two status machines and two "convert" routes**:

1. Admin logs a *Pertanyaan* (16-field dialog; only child + parent name required; PUT silently drops 3 of the fields and cannot clear a field).
2. Admin clicks *Kirim Formulir* — blocked (`NO_EMAIL`) when the parent has no email, which kills every walk-in.
3. Parent fills a 7-step form alone. The admin screen for that form is **read-only**: nothing can be corrected on the parent's behalf.
4. Admin switches to the other tab ("Formulir"), clicks *Mulai Tinjau*, *Terima*, then *Konversi ke Siswa* (two confirm dialogs back to back).
5. A second, older convert path (inquiry → `ADMITTED` → thin Student) still exists beside the rich one, with its own duplicate/merge dialogs; the rich one has none.

`VISIT_SCHEDULED` / `VISITED` and `UNDER_REVIEW` are clicked through but nothing reads them. The public `/daftar` form asks three steps of required child data although the full formulir is sent anyway.

Feedback that started this (Ais, 10 Oct): pay the formulir fee first. That is **not** in this cycle (see Non-goals), but this cycle fixes the program / Day Care choice at "Kirim Formulir", which makes it a small change next.

Inputs: UAT `2026-10-06-enrollment-form` (0 blockers, 1 major on slow-uplink upload — not touched here); `2026-09-29-full-e2e` majors X-1 and CORE-1 already fixed in round 2. Prior cycles constrain: `2026-10-10-pendaftaran-fee-payment` (A3: an unpaid application stays convertible with a warning, never a block; fee is its own `EnrollmentFee` row).

## Decisions

1. **One pipeline, one list.** `/admin/admissions` ("Pendaftaran") becomes the only list. Each row shows a derived **Tahap**: *Baru* → *Formulir dikirim* → *Formulir masuk* → *Diterima* → *Siswa*, plus *Batal* / *Ditolak*. The separate "Formulir" list is retired; `/admin/enrollments` redirects there and old links keep working. The detail page `/admin/enrollments/[id]` stays.
2. **Stage is derived, not clicked.** Lead status shrinks to Baru / Batal. Everything after comes from the formulir (sent, submitted, accepted) and from the student link. `VISIT_SCHEDULED`, `VISITED` and `UNDER_REVIEW` are removed from every screen and transition. Rows already holding those values are **read as their neighbour** (visit steps = *Baru*, under review = *Formulir masuk*); no data is rewritten.
3. **Lead form = who and how to reach them.** Required: Nama orang tua + at least one of No. HP/WhatsApp or Email. Also: Ayah/Ibu/Wali. Optional (collapsed under "Data anak"): nama anak, tanggal lahir, jenis kelamin, program. Plus catatan. Gone from the form: pendidikan, pekerjaan, penghasilan, preferensi kampus, tanggal tindak lanjut, sumber (set automatically: Website / Datang langsung). Same short form for the public `/daftar` (one page, no stepper).
4. **Admin can override anything.** Every field of the lead and of the formulir (anak, Ayah, Ibu, program, Day Care, catatan) is editable by staff with `admissions.edit` at any stage until the student exists, via an **Ubah data** mode on the detail page. Format is validated, completeness is not (staff can save a half-filled form). Clearing a field now works. After conversion, corrections happen on the student / wali pages as today.
5. **Walk-ins work.** *Kirim Formulir* no longer needs an email. It opens a result card with **Kirim lewat WhatsApp**, **Salin tautan**, **Isi bersama orang tua** (opens the real parent form on the admin's device so the parent can sign on screen) and, only when an email exists, sends the email too.
6. **Staff can submit on the parent's behalf.** *Tandai formulir masuk* moves a not-yet-submitted formulir to *Formulir masuk* without digital signatures; consent is recorded as "disetujui langsung di sekolah" with who and when, and an audit row. Signatures stay evidence only the parent writes.
7. **One convert, one click.** *Terima & Jadikan Siswa* from *Formulir masuk* (single confirm; the unpaid-fee warning from A3 stays). *Tolak* stays in the overflow menu. Convert is also allowed straight from *Formulir dikirim* when staff filled the data. It needs only child name + one parent name; anything missing is named in the error. The old inquiry-row convert route, its dialogs and `conversion.ts` are deleted; the **duplicate-student / existing-wali confirmation moves into the one route** (it has none today).
8. **Repricing.** Changing program or Day Care on an `UNPAID` fee recomputes it (staff discount percent kept, stale payment link dropped). On `PAID` / `WAIVED` the fee is left alone and the screen says so.
9. **Labels.** Keep glossary words: *Pertanyaan*, *Formulir*, *Kirim Formulir*, *Konversi → Jadikan Siswa*. Button *Catat Pertanyaan* stays. Copy follows `voice.md` (Pak Budi persona for staff).
10. **Branch.** Worked on the harness-assigned branch `claude/intelligent-archimedes-i25p8i`, not a `feat/*` worktree; the cloud session is already isolated.

## Acceptance criteria

- [ ] Catat Pertanyaan saves with only Nama orang tua + one contact; child fields are optional and may be blank.
- [ ] Editing a lead can clear any field, and no field is silently dropped on save.
- [ ] `/daftar` is one short page with the same required set; submitting creates a *Baru* row; an existing duplicate within 10 minutes still returns the existing one.
- [ ] A lead without email can get a formulir link; the card offers WhatsApp, copy, "Isi bersama orang tua", and sends email only when one exists.
- [ ] One list shows Tahap and Pembayaran for every row; filters for Tahap and *Belum bayar*; WhatsApp fee reminder reachable from the row; no duplicate date column; stats load in one request.
- [ ] `/admin/enrollments` redirects to the unified list; `/admin/enrollments/[id]` still opens.
- [ ] Rows stored as `VISIT_SCHEDULED`/`VISITED`/`UNDER_REVIEW` display and behave as *Baru*/*Formulir masuk* and can continue; no screen offers those steps.
- [ ] *Ubah data* edits every formulir section, rejects malformed phone/email/date with inline errors and changes nothing on failure, and is hidden for viewers without `admissions.edit` and after conversion.
- [ ] Changing program/Day Care re-prices an unpaid fee; leaves a paid or waived fee alone and says so.
- [ ] *Tandai formulir masuk* works from *Formulir dikirim*, writes the consent note + audit row, creates the fee row like a parent submit, and never fabricates a signature.
- [ ] *Terima & Jadikan Siswa* creates Student, Ayah/Ibu wali links and links the lead in one confirm; unpaid fee warns, does not block; a possible duplicate student or existing wali asks before merging; missing child/parent name names what is missing.
- [ ] `POST /api/admissions/[id]/convert`, its dialogs and `conversion.ts` are gone with no dangling import or test.
- [ ] README, `/panduan` admissions slide, UAT jobs ADM-01/03/04, crud standard and the ADR table match the new flow; `scripts/audit-docs.sh` exits 0.

## Verify flows

Data: demo auth, disposable local Postgres, seeded school-admin (`u_school_admin`).

1. **Walk-in, no email.** Admin: Pendaftaran → Catat Pertanyaan with parent name + phone only → row *Baru* → Kirim Formulir → result card → *Isi bersama orang tua* → fill and sign on screen → submit → row *Formulir masuk*, *Belum bayar* → *Terima & Jadikan Siswa* → student and two wali exist, row *Siswa*.
2. **Parent online, then a correction.** Public `/daftar` short form → row *Baru* → Kirim Formulir (with email) → parent submits via token → admin sees a wrong phone → Ubah data fixes it, changes Day Care → unpaid fee re-prices → convert. **Edge:** same child name + DOB as an existing student → convert asks first.
3. **Errors.** Ubah data with a malformed phone: inline error, nothing saved. Convert from *Formulir dikirim* with no child name: error names it. Clear the lead's email in edit: stays cleared. Viewer role: no edit/convert controls.
4. **Legacy.** A lead stored as `VISITED` shows *Baru*, can receive a formulir and continue.

## UX notes

- Primary action per row follows the stage: *Baru* → Kirim Formulir · *Formulir dikirim* → Salin/Kirim ulang tautan · *Formulir masuk* → Terima & Jadikan Siswa · *Siswa* → Lihat siswa. Edit, Batalkan, Tolak sit in the overflow menu.
- Row click opens the detail when a formulir exists, otherwise the lead dialog.
- Empty list: "Belum ada calon siswa. Catat pertanyaan pertama." with the same button.
- Errors are named in Indonesian (what is missing, how to fix); never a raw caught error.
- Mobile-first table per existing admin patterns; follow `design-system.html`, `ui.md` (Shadcn first, ResponsiveFormDialog), `better-accessibility` for dialogs.

## Test seams

- Vitest API routes: admissions create/update, invite (no email), enrollments PATCH (validation + reprice + submit-on-behalf), enrollments convert (relaxed preconditions, duplicate confirm).
- Vitest jsdom: unified list (stage, filters, actions), lead dialog, Ubah data form, result card.
- Playwright (kept lean): one cross-module admin walk-in spec replacing `admin-admission-convert-parity`; update `daftar-public`, `enrollment-application`, `enrollment-fee-payment`, `admin` status-machine and `admin-dialogs` specs.

## Non-goals

- **Pay-first** (fee before the formulir opens). Separate next cycle; needs the school's answer on refunds. This cycle only fixes program/Day Care at send time.
- Assigning a class during convert (stays the student page's *Daftarkan ke Kelas*).
- Moving the pendaftaran fee into `Invoice`; automatic reminders; discount tiers.
- Changing the parent form's steps, consent text or document rules.
- Rewriting existing rows in the database.

## Assumptions

1. A lead with no child name is stored with an empty child name (column stays required; the UI shows "Belum diisi"). No migration.
2. Source is set automatically: Website for `/daftar`, Datang langsung for staff-created.
3. "Disetujui langsung di sekolah" is acceptable to the school as consent when the parent is physically present and staff submit for them.
4. Staff with `admissions.edit` may edit parent PII on a formulir; every edit is audited.
5. Unpaid fee never blocks convert (A3 stands).
6. Existing student/wali edit screens already cover post-convert corrections.
7. Old `/admin/enrollments` bookmarks only need a redirect.

## Gate re-openers

- **Auth/PII (stated here, approved with this spec):** staff edit of parent and child PII on a formulir, staff submit on the parent's behalf with a recorded "disetujui di sekolah" consent, invite links without email.
- Schema migration: **none**. New dependency: **none**. Production write: **none**. Paid API: **none**.
- Deleting one API route (`POST /api/admissions/[id]/convert`); no data deleted.

## Tasks

- [ ] T1 Lead model and API — slim create/update schema (parent + contact required, child optional), PUT writes every field incl. clears, audit rows, legacy statuses read as neighbours, auto source — accept: route + schema tests green (reuse: `lib/validations/admission.ts`, `app/api/admissions/**`)
- [ ] T2 Public `/daftar` one short page — accept: e2e `daftar-public` updated and green; duplicate window kept (deps: T1, parallel with T3)
- [ ] T3 Invite without email + result card (WhatsApp, copy, Isi bersama orang tua) — accept: invite route test for no-email; card test (deps: T1, reuse: `lib/enrollment/follow-up.ts`)
- [ ] T4 Admin editing of the formulir — validated PATCH, reprice unpaid fee, *Ubah data* UI, *Tandai formulir masuk* with consent note — accept: route + component tests (deps: T3, reuse: `lib/enrollment/submit-validation.ts`, form-logic field specs)
- [ ] T5 One convert — relax preconditions, move duplicate/wali confirmation into the rich route, single-click *Terima & Jadikan Siswa*, drop Mulai Tinjau/UNDER_REVIEW from UI, delete inquiry convert route + dialogs + `conversion.ts` — accept: convert tests incl. duplicate and missing-name (deps: T4)
- [ ] T6 Unified Pendaftaran list — Tahap + Pembayaran columns and filters, stage-driven actions, single stats call, drop duplicate date column, `/admin/enrollments` redirect, fix inbound links — accept: list tests; redirect test (deps: T5)
- [ ] T7 Docs, deck and e2e sweep — README, `/panduan` slide, UAT jobs ADM-01/03/04, crud.md, ADR row, e2e specs, `bash scripts/audit-docs.sh --write` — accept: `audit-docs.sh` exits 0 (deps: T6)

## Implementation

## Verification

## Ship Notes
