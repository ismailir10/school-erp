# Enrollment form: two-parent signature handover + Kelengkapan Berkas upload

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

### B. Kelengkapan Berkas — parent upload + staff checklist

Revised at the gate (2026-10-06): **parents upload the documents on the form**. Staff can still tick "diterima (fisik)" for anything handed in on paper.

- [ ] New nullable `documents Json?` column on `EnrollmentApplication` (one additive migration). Shape: `{ [key]: { fileToken?, fileName?, mimeType?, uploadedAt?, receivedPhysical?, receivedAt? }, otherLabel? }`.
- [ ] `lib/enrollment/documents.ts` is the single source for the item list. The keys follow the paper form, split per parent where the form says "@":
  - `akta` — Akta kelahiran
  - `kk` — Kartu Keluarga
  - `kia` — Kartu Identitas Anak
  - `ktp_ayah`, `ktp_ibu` — KTP Ayah and KTP Ibu
  - `foto_anak` — Pas foto anak 3×4 (the physical 4 lembar is still noted)
  - `foto_ayah`, `foto_ibu` — Pas foto orang tua
  - `surat_sehat` — Surat keterangan sehat
  - `surat_pindah` — Surat keterangan pindah sekolah (*conditional*: only for children previously registered at another school)
  - `lainnya` — free-text label plus a file

  The module also holds the zod shape and a `documentProgress()` helper. An item counts as complete when it is uploaded **or** staff marked it received. Surat pindah and lainnya don't count toward the required total (9).
- [ ] **New form step "Berkas"** between Program and Persetujuan, so the order is Data Anak → Ayah → Ibu → Program → **Berkas** → Persetujuan → Tinjau. Each item has an upload button that accepts a camera photo, gallery image or PDF, and shows the file name with **Ganti** / **Hapus** once uploaded. The step is **optional**: the parent can continue without uploading everything, and a note says the missing documents can be brought to school. Tinjau and the success screen list what is still missing.
- [ ] Images are compressed in the browser (longest side ≤ 2000 px, JPEG) before upload, so a 6 MB phone photo goes up at ~0.5 MB. The server caps uploads at **4 MB** (Vercel's request limit is 4.5 MB). It accepts JPEG/PNG/PDF, checked by magic bytes, not by the claimed type.
- [ ] Public `POST /api/enrollments/token/[token]/documents?key=…` uploads a file and `DELETE` removes it. Both are token-gated, rate-limited and `INVITED`-only, with a whitelisted `key`. Each write goes to the row atomically through the same `jsonb_set` helper as the signatures, so autosave can't clobber it. The draft PATCH and submit never touch `documents`. The response returns the file name only; storage tokens never reach the browser.
- [ ] Admin: `GET /api/enrollments/[id]/documents/[key]` streams a file. It is gated on `admissions.view`, tenant-scoped and `no-store`, mirroring the signature route. A **Kelengkapan Berkas** card on `/admin/enrollments/[id]` shows each item as one of: Diunggah (with Lihat), Diterima fisik (a checkbox for `admissions.edit` users) or Belum. It also shows "x / 9 berkas lengkap". The tick saves through `PATCH /api/enrollments/[id]` `{ documentsReceived: {key: boolean} }`, which is merged server-side and allowed even after conversion; every other field keeps the existing 409.
- [ ] Vitest covers the documents module, upload/delete (key whitelist, size, magic bytes, status guard, atomic write), the admin stream route and the admin PATCH carve-out.

### Non-goals

- Copying uploaded KK/KTP into the student's guardian record (`Parent.ktpUrl` / `kkUrl`) on convert. This is a natural follow-up.
- Showing the documents on the student detail rail.
- Letting parents upload after they have submitted. The token closes on submit as today, and anything missing goes in on paper and staff tick it.
- Parent-side preview of uploaded files. The parent sees the file name, and only staff can open the files.
- Changing the consent text, `CONSENT_VERSION`, the admin signature viewer or the `/daftar` inquiry flow.

## Tasks

- [ ] **T1 — Signature persists server-side.** Add a shared atomic JSON-merge helper (`lib/enrollment/json-merge.ts`, `$executeRaw` `jsonb_set`, guarded on `status='INVITED'`). The signature POST writes the token through it, and a new GET status endpoint reports what is saved. Add Vitest. *Accept:* upload → row has the token; GET returns booleans only; a non-INVITED row → 409. *Deps:* none.
- [ ] **T2 — Draft PATCH and submit can't lose signatures.** The PATCH carries stored tokens over in one UPDATE, and submit overlays the DB tokens before validation. Add Vitest. *Accept:* a PATCH with empty tokens leaves stored ones intact; submit with tokens missing from the body but present in the DB → 201; tokens missing from the DB → 422. *Deps:* T1.
- [ ] **T3 — Signature client UX and autosave fix.** Autosave reads the latest state from a ref, and the handover note gets Salin link and Periksa lagi. *Accept:* the build passes, and a local browser check shows the two-tab handover. *Deps:* T1, T2.
- [ ] **T4 — Migration.** Add the `documents Json?` column, its migration SQL and `prisma generate`. *Accept:* `prisma migrate diff` is clean and the build passes. *Deps:* none.
- [ ] **T5 — Documents domain module.** Add `lib/enrollment/documents.ts` (items, zod, progress, admin redaction that drops `fileToken`). Add Vitest. *Deps:* none.
- [ ] **T6 — Parent upload API.** Add POST and DELETE on `/api/enrollments/token/[token]/documents`, reusing `saveFile`, `detectMime`, the T1 helper and the rate limit. Add Vitest. *Deps:* T1, T4, T5.
- [ ] **T7 — Berkas step in the form.** Add the step UI, browser image compression, the missing-items list on Tinjau and the success screen, and the `design-system` check. *Accept:* the build passes, and a local browser check covers upload, replace and remove. *Deps:* T3, T6.
- [ ] **T8 — Admin documents.** Add the stream route, the PATCH `documentsReceived` carve-out, the GET field (redacted) and the Kelengkapan Berkas card. Add Vitest. *Deps:* T4, T5.
- [ ] **T9 — Docs.** Update the README enrollment row and fill in Ship Notes. *Deps:* T1–T8.

## Implementation

## Verification

## Ship Notes
