# Enrollment form: two-parent signature handover + Kelengkapan Berkas checklist

## Context

Admissions staff (Ais, 2026-10-06) reported that when a candidate's parents are in two different places, sharing the `/pendaftaran/[token]` link between them loses the first parent's signature. Root cause, from code reading:

1. `POST /api/enrollments/token/[token]/signature` stores the PNG and returns a `signatureToken`, but deliberately does not write it to the row. Only the draft autosave PATCH or the final submit persists it.
2. `uploadSignature` in `app/pendaftaran/[token]/client.tsx` never triggers autosave, and on the Persetujuan step **Lanjut** needs both signatures. The first parent therefore cannot force a save, and the token lives only in that browser tab. The "✓ Tersimpan" badge means "uploaded to storage", not "saved to the form".
3. The draft PATCH replaces every JSON blob wholesale, so two open tabs overwrite each other, signatures included.
4. `scheduleSave` reads its payload through a stale closure (`setX(v); scheduleSave()`), so each autosave sends the state from before the latest edit.

The intended outcome: each parent can open the same link, from anywhere and in any order, sign their own pad, and the signature persists. The form is submittable once both signatures are on the row.

The same cycle digitises the paper form's **KELENGKAPAN** checklist (photo from the user): fotokopi akta kelahiran, fotokopi KK, fotokopi KIA, fotokopi KTP kedua orang tua (@1 lembar), pas foto berwarna anak 3×4 (4 lembar), pas foto berwarna orang tua 3×4 (@1 lembar), surat keterangan sehat, surat keterangan pindah sekolah (only for children previously registered at another school), plus a blank "lainnya" line. Today the system tracks none of these for an application. The student-detail "Kelengkapan Berkas" rail (`app/admin/students/[id]/page.tsx:427`) only reports photo/KK/KTP uploads and the consent letter.

Prior cycle in this area: `docs/cycles/archive/2026-06-23-enrollment-application.md`. There is no UAT report for enrollment.

## Spec

### A. Signature handover

- [ ] `POST /api/enrollments/token/[token]/signature` persists the returned token into `consentData.<which>.signatureToken` on the row in the same request. The write is one atomic SQL `jsonb_set` that touches only that key and only while `status = 'INVITED'`.
- [ ] The draft `PATCH /api/enrollments/token/[token]` can never clear or replace a stored signature token. The client-sent `signatureToken` is ignored, and the stored tokens are carried over in the same UPDATE statement.
- [ ] `POST /submit` takes both signature tokens from the DB row, not the request body. A form submitted from a tab that never saw the other parent's signature still succeeds when the row has both. If either is missing, it returns 422 with the existing "Tanda tangan … wajib disimpan" message.
- [ ] Autosave always sends the latest state, with no stale closure.
- [ ] On the Persetujuan step, when exactly one signature is present, the form shows a handover note: "Tanda tangan Ibu/Ayah belum ada — bagikan link ini…". It includes a **Salin link** button and a **Periksa lagi** button that re-reads the signature status from the server, so the second parent's signature appears without a reload. Lanjut still requires both signatures.
- [ ] A new public `GET /api/enrollments/token/[token]/signature` returns `{ ayah: boolean, ibu: boolean }`. It is rate-limited and token-gated like its siblings, and never returns storage tokens.
- [ ] Vitest covers the signature persist, PATCH preservation, submit-reads-DB and GET status paths.

### B. Kelengkapan Berkas checklist

- [ ] New nullable `documentChecklist Json?` column on `EnrollmentApplication` (one additive migration).
- [ ] `lib/enrollment/document-checklist.ts` is the single source for the item list, using the paper form's labels and quantity notes. It has eight fixed items plus a free-text "lainnya", a zod schema, and a `checklistProgress()` helper. Surat pindah is marked conditional and is not counted as required.
- [ ] Admin enrollment detail (`/admin/enrollments/[id]`) gets a **Kelengkapan Berkas** card. Staff with `admissions.edit` tick the items received and fill in "lainnya"; users with `admissions.view` see it read-only. It shows "x / 7 berkas wajib diterima". Saving goes through the existing `PATCH /api/enrollments/[id]` with `documentChecklist`. A checklist-only update is allowed even after the application is converted to a student, because papers often arrive after acceptance. Every other field keeps the existing 409.
- [ ] The parent form's Tinjau step and the success screen show "Berkas yang perlu dibawa ke sekolah" as a read-only list built from the same source.
- [ ] Vitest covers the checklist schema, progress helper and admin PATCH (including the converted-application carve-out).

### Non-goals

- Parents uploading scans of documents online. This is physical-document tracking only, as on the paper form.
- Showing the checklist on the student detail rail, or carrying it into the student on convert. This is a possible follow-up.
- Changing the consent text, `CONSENT_VERSION`, or the admin signature viewer.
- Any change to the `/daftar` inquiry flow.

## Tasks

- [ ] **T1 — Signature persists server-side.** Make the signature POST write the token atomically (`$executeRaw` `jsonb_set`, guarded on `status='INVITED'`). Add the GET status endpoint. Add Vitest for both. *Accept:* upload → row has the token; GET reports booleans only; non-INVITED → 409. *Deps:* none.
- [ ] **T2 — Draft PATCH and submit can't lose signatures.** The PATCH writes `consentData` with stored tokens carried over in one UPDATE. Submit overlays the DB tokens before validation. Add Vitest. *Accept:* a PATCH with empty tokens leaves stored tokens intact; submit with body tokens missing but DB tokens present → 201; DB missing → 422. *Deps:* T1 (shared SQL helper).
- [ ] **T3 — Client handover UX + autosave fix.** Autosave reads the latest payload from a ref. The signature pad state comes from the server response. Add the handover note with Salin link and Periksa lagi. Add the "berkas yang perlu dibawa" list on Tinjau and the success screen (uses T5's item list). *Accept:* the build passes; local browser check shows the handover flow across two tabs. *Deps:* T1, T2, T5.
- [ ] **T4 — Migration.** Add the `documentChecklist Json?` column, migration SQL and `prisma generate`. *Accept:* `prisma migrate diff` is clean and the build passes. *Deps:* none.
- [ ] **T5 — Checklist domain module.** Add `lib/enrollment/document-checklist.ts` (items, zod, progress) with Vitest. *Accept:* tests cover parsing, unknown-key stripping and progress counting. *Deps:* none.
- [ ] **T6 — Admin API + UI.** `PATCH /api/enrollments/[id]` accepts `documentChecklist` with the converted carve-out, GET returns it, and the Kelengkapan Berkas card goes on the admin detail page (Shadcn Checkbox, design-system tokens). Add Vitest for the route. *Accept:* staff can tick and save; view-only users see it read-only; tests are green. *Deps:* T4, T5.
- [ ] **T7 — Docs.** Update the README enrollment row with signature handover and checklist. *Deps:* T1–T6.

## Implementation

## Verification

## Ship Notes
