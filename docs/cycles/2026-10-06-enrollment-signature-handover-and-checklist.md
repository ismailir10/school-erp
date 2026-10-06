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

- [x] **T1 — Signature persists server-side.** Add a shared atomic JSON-merge helper (`lib/enrollment/json-merge.ts`, `$executeRaw` `jsonb_set`, guarded on `status='INVITED'`). The signature POST writes the token through it, and a new GET status endpoint reports what is saved. Add Vitest. *Accept:* upload → row has the token; GET returns booleans only; a non-INVITED row → 409. *Deps:* none.
- [x] **T2 — Draft PATCH and submit can't lose signatures.** The PATCH carries stored tokens over in one UPDATE, and submit overlays the DB tokens before validation. Add Vitest. *Accept:* a PATCH with empty tokens leaves stored ones intact; submit with tokens missing from the body but present in the DB → 201; tokens missing from the DB → 422. *Deps:* T1.
- [x] **T3 — Signature client UX and autosave fix.** Autosave reads the latest state from a ref, and the handover note gets Salin link and Periksa lagi. *Accept:* the build passes, and a local browser check shows the two-tab handover. *Deps:* T1, T2.
- [x] **T4 — Migration.** Add the `documents Json?` column, its migration SQL and `prisma generate`. *Accept:* `prisma migrate diff` is clean and the build passes. *Deps:* none.
- [x] **T5 — Documents domain module.** Add `lib/enrollment/documents.ts` (items, zod, progress, admin redaction that drops `fileToken`). Add Vitest. *Deps:* none.
- [x] **T6 — Parent upload API.** Add POST and DELETE on `/api/enrollments/token/[token]/documents`, reusing `saveFile`, `detectMime`, the T1 helper and the rate limit. Add Vitest. *Deps:* T1, T4, T5.
- [x] **T7 — Berkas step in the form.** Add the step UI, browser image compression, the missing-items list on Tinjau and the success screen, and the `design-system` check. *Accept:* the build passes, and a local browser check covers upload, replace and remove. *Deps:* T3, T6.
- [x] **T8 — Admin documents.** Add the stream route, the PATCH `documentsReceived` carve-out, the GET field (redacted) and the Kelengkapan Berkas card. Add Vitest. *Deps:* T4, T5.
- [x] **T9 — Docs.** Update the README enrollment row and fill in Ship Notes. *Deps:* T1–T8.

## Implementation

- Subagent plan: driver=claude-opus-5-5, dirty-work=sonnet. Backend slice (T1, T2, T4, T5, T6, T8-API + demo storage) and frontend slice (T3, T7, T8-UI) run **in parallel** against the frozen contract below. E2E and docs (T9) run sequentially after both. The driver reviews each diff and commits per task.
- Spec addition (test infra, recorded at build time): storage requires Supabase, and neither CI's Playwright job nor this harness has Supabase credentials. A **demo disk backend** was added to `lib/storage`. Tokens look like `demo:v1:<path>` and files live under `os.tmpdir()/talib-demo-storage`. It is active only when `DEMO_MODE=true`, `SUPABASE_SERVICE_ROLE_KEY` is unset and `VERCEL` is unset, so it can never engage on a deployment. Without it, neither real signature/document uploads in E2E nor local usability checks are possible.
- Contract (frozen before fan-out):
  - `lib/enrollment/json-merge.ts`
    - `mergeJsonKey(id, column: "consentData"|"documents", key, patch: Record<string, unknown>, { requireInvited }) → Promise<boolean>`: one `UPDATE … SET col = COALESCE(col,'{}') || jsonb_build_object(key, COALESCE(col->key,'{}') || patch)`. Returns false when 0 rows match.
    - `removeJsonFields(id, column, key, fields[], opts)` removes the listed fields from that key.
  - Signature routes:
    - `POST /api/enrollments/token/[token]/signature?which=` → `{ saved: true }`, and the token is persisted. A non-INVITED row returns 409.
    - `GET` on the same path → `{ ayah: boolean, ibu: boolean }`.
  - Draft PATCH: ignores client `signatureToken`. `consentData` is written in one UPDATE that carries the stored `ayah/ibu.signatureToken` over. `documents` is never accepted.
  - Submit: overlays the DB `consentData.{ayah,ibu}.signatureToken` onto the body before validation.
  - Documents routes:
    - `POST /api/enrollments/token/[token]/documents?key=` (multipart `file`, optional `label` for `lainnya`) → `{ key, fileName, mimeType, size, uploadedAt, label? }`.
    - `DELETE ?key=` → `{ ok: true }`.
    - Limits: 4 MB, JPEG/PNG/PDF by magic bytes.
  - `lib/enrollment/documents.ts`:
    - `DOCUMENT_ITEMS`
    - `DocumentKey`
    - `toPublicDocuments(raw)` → `{ [key]: { fileName, mimeType, size, uploadedAt, label? } }`, with no tokens
    - `toAdminDocuments(raw)` → `{ [key]: { hasFile, fileName, mimeType, size, uploadedAt, label?, receivedPhysical, receivedAt } }`
    - `documentProgress(raw)` → `{ done, required }`
    - `missingRequiredDocuments(publicOrAdmin)` → `DocumentKey[]`
  - Page prefill: `consentData` becomes `{ agreed, ayah: { name, signed }, ibu: { name, signed } }` (no raw tokens), and a new `documents` prop is the `toPublicDocuments` output.
  - Admin:
    - `GET /api/enrollments/[id]` adds `documents: toAdminDocuments(...)`.
    - `GET /api/enrollments/[id]/documents/[key]` streams the file (`admissions.view`, tenant, `no-store`).
    - `PATCH { documentsReceived: { [key]: boolean } }` is allowed on a converted application only when it is the sole field.

- Demo storage (test infra): `lib/storage/index.ts`, `lib/storage/__tests__/demo-storage.test.ts`. Adds the `demo:v1:` disk backend, gated as described above. Its tokens are refused outside demo mode, and the existing `parseToken` traversal guards apply.

- Task 1: Signature persists server-side. Files: `lib/enrollment/json-merge.ts` (+test) and `app/api/enrollments/token/[token]/signature/route.ts` (+new `__tests__`).
  - POST merges the token into `consentData.<which>` in one INVITED-guarded `jsonb` UPDATE and returns `{ saved: true }`.
  - The new GET returns `{ ayah, ibu, ayahName, ibuName }`, never tokens.
  - The helpers were verified against a real local Postgres: NULL column, non-object values, a concurrent merge to two keys, the status guard, and token carry-over.

- Task 2: Draft PATCH and submit can't lose signatures. Files: `app/api/enrollments/token/[token]/route.ts` and `submit/route.ts`, plus tests.
  - Draft PATCH strips client `signatureToken`/`signedAt` and writes `consentData` through `writeConsentPreservingSignatures` (one UPDATE that carries the stored tokens over).
  - The remaining fields go through `updateMany` guarded on INVITED (409 when lost); `documents` is never accepted.
  - Submit overlays the DB tokens before validation, so client tokens are ignored and a missing one returns 422.

- Task 4: Migration. `prisma/schema.prisma` gets `documents Json?`, and `prisma/migrations/20261006000000_add_enrollment_application_documents/migration.sql` adds `ALTER TABLE "EnrollmentApplication" ADD COLUMN "documents" JSONB;`. The change is additive and nullable.

- Tasks 3, 5, 6 and 7 (one commit, because `client.tsx` carries both the T3 handover and the T7 step and the hunks interleave): parent side of the form.
  - `lib/enrollment/documents.ts` (+test): item list, parsers that never expose `fileToken`, progress, name/label sanitizers. `resolve-token.ts` now selects `documents`.
  - `app/api/enrollments/token/[token]/documents/route.ts` (+test): POST/DELETE. Token-gated, rate-limited, key whitelist, 4 MB, magic bytes, INVITED-guarded atomic merge. The old object is deleted only once no key references it.
  - `app/pendaftaran/[token]/page.tsx` sends signed booleans instead of raw tokens, plus public documents.
  - `client.tsx`:
    - 7 steps.
    - Autosave goes through a latest-payload ref, with a keepalive flush on pagehide/hidden/unmount; a failed submit re-arms it.
    - Handover note with Salin link / Periksa lagi; the latter refreshes signatures and fills empty names.
    - Berkas review and success-screen lists.
  - `components/enrollment/documents-step.tsx` (+`useDocumentUploads` hook, owned by client.tsx so busy state survives leaving the step).
  - `components/enrollment/signature-pad.tsx`: saved overlay, 44px buttons on mobile.
  - `lib/enrollment/compress-image.ts` (+test): ≤2000px JPEG re-encode, EXIF orientation, white fill, never larger than the original, WebP/GIF/HEIC re-encoded so the server accepts them.
  - `README.md` public form row updated.

- Task 8: Admin documents.
  - `app/api/enrollments/[id]/route.ts` (+test):
    - GET returns `toAdminDocuments`, with no tokens.
    - PATCH `documentsReceived` is merged per key and is allowed on a converted application only as the sole field.
    - An admin `consentData` edit can no longer set or clear signature tokens: client values are stripped and the stored ones carried over.
  - `app/api/enrollments/[id]/documents/[key]/route.ts` (+test) streams a file. It requires `admissions.view`, is tenant-scoped, and sends `no-store`, `nosniff` and an ASCII-safe filename.
  - `components/admin/enrollment-documents-card.tsx` (+test): the card on `/admin/enrollments/[id]`.
    - Rows show Diunggah/Diterima fisik/Belum, a Lihat link and "x / 9 berkas lengkap".
    - The tick is optimistic and reverts on failure with mapped copy.
  - `README.md` admin row updated.

- E2E:
  - `e2e/enrollment-application.spec.ts` updated. Client-only tokens now return 422; real PNG signatures go through the route; a KK PDF upload returns no token; the admin stream serves `%PDF-`; `documentsReceived` works on a converted application while a status change there returns 409.
  - New `e2e/enrollment-signature-handover.spec.ts`, the regression: device A signs Ayah; device B, a fresh context, sees it saved and signs Ibu; A taps Periksa lagi and submits; admin streams both PNGs.
  - New `e2e/enrollment-documents.spec.ts`: Berkas upload, delete, re-upload, the missing list on Tinjau and the success screen, and the admin card tick.
  - New shared setup in `e2e/helpers/enrollment.ts`. `CLAUDE.md` counts regenerated.

- JTBD library: `docs/uat/jobs/parent.md` gets a new `## Area: enrollment-form` with JTBD-PARENT-ENROL-01 (two-device signing) and ENROL-02 (upload berkas from a phone). `docs/uat/jobs/admin.md` gets JTBD-ADMIN-ADM-02 (check Kelengkapan Berkas, open a file, tick papers received). Last-audited lines bumped.

- Usability fixes from the heuristic UAT (`docs/uat/reports/2026-10-06-enrollment-form.md`):
  - An oversized file is rejected on the client before upload. Before the fix it took 55 s on throttled 4G to show the 413.
  - Compression is tightened to 1600 px at JPEG quality 0.8, re-encoding anything over 800 KB.
  - Kirim is blocked while any upload or delete is in flight ("Menunggu unggahan selesai…"), with an in-flight note on Tinjau. Before the fix, a submit during an upload silently lost the file.
  - The handover note moved above the signature pads.
  - "Wajib" badges are dropped (the step is optional); optional items read "Jika ada".
  - The admin Kelengkapan Berkas card moved to the top of the detail page.
  - Files: `documents-step.tsx`, `compress-image.ts`, `client.tsx`, `app/admin/enrollments/[id]/page.tsx`, plus tests.

- Codex PR review fixes (6 findings, all verified real):
  - (P1) Draft autosave keeps a stored signer name when the incoming one is blank, so a stale tab can't erase the other parent's name. Same single UPDATE.
  - (P2) Every upload gets a unique storage path (`doc-<key>-<rand>`, `<which>-signature-<rand>`), so check-then-delete cleanup can never remove an object that is referenced again. Shared `lib/enrollment/stored-files.ts`.
  - (P2) Superseded signature images are deleted once unreferenced, and a 409 after upload deletes the new object (signatures and documents).
  - (P2) Submit runs lock (`SELECT … FOR UPDATE`), read, validate and transition in one transaction. `programBelongsToTenant` accepts `tx`.
  - (P2) Hapus asks for confirmation with an AlertDialog, per voice.md.
  - (P2) An in-flight signature save blocks Lanjut and Kirim.
  - The e2e documents spec now cancels and then confirms the delete dialog.

## Verification
- Baseline (unchanged staging, before this cycle): build exited 0. Vitest with `DEMO_MODE=true` leaked into the runner had 22 failures across 3 files (xendit-client-classifier, auth-rate-limit, storage); without it they all pass, as in CI's unit job. Unit gates here therefore run without `DEMO_MODE`, matching `.github/workflows/ci.yml`. Build and Playwright run with it.
- Full gate after both slices landed, before review fixes: `npm run build` exited 0, `npx vitest run` gave 490 files passed / 2 skipped, 4522 tests passed.
- Reviews: independent backend security review found no exploitable issue and 5 nits (stale-object cleanup race, an unguarded second write in draft PATCH, names on the signature GET, admin `consentData` able to set tokens, length precheck), all fixed. The driver relaxed the strict 411 so a *missing* `Content-Length` is tolerated, because an HTTP/2 hop may drop it and rejecting would break every upload on that path. The frontend review found focus loss when buttons unmount and lost draft edits after a failed submit, plus minor items; all are being fixed.

- Task 1: `npx vitest run app/api/enrollments lib/enrollment lib/storage` green (part of the 232-test scoped run); full gate above.
- Task 2: token-route suites green (67 tests across 4 files after the driver's 411 change).
- Task 4: applied to the local Postgres with psql, then `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` reported "This is an empty migration".
- Tasks 3/5/6/7: full gate on the combined tree: `npm run build` exited 0, `npx vitest run` gave 490 files passed / 2 skipped, 4547 tests passed. Review fixes were checked by the frontend reviewer's follow-up (focus stays on busy buttons, focus after delete, failed-submit re-arm, concurrent uploads, busy state across step changes).
- design-system: the Berkas step and handover note use existing Shadcn primitives (Button, Alert, Input, Badge, Spinner) and the page's existing emerald brand tokens; no new colors or arbitrary hex beyond what the form already used.
- Task 8: covered by the combined gate above plus `e2e/enrollment-documents.spec.ts`. The admin card shows "1 / 9", ticking Akta moves it to "2 / 9", and the tick survives a reload.
- Playwright (local, production build with `DEMO_MODE=true` against disposable local Postgres 16, Chromium via a local-only browser-path shim): `npx playwright test e2e/enrollment-application.spec.ts e2e/enrollment-signature-handover.spec.ts e2e/enrollment-documents.spec.ts e2e/admin-admission-convert-parity.spec.ts e2e/daftar-public.spec.ts` gave **12 passed (19.6s)**, with no retries.
- After the UAT fixes: `npm run build` exited 0; `npx vitest run` gave 490 files passed / 2 skipped, 4551 tests passed; the enrollment Playwright set gave 12 passed (19.5s). CI on `0532c3b` (all code before the UAT fixes) passed all four required checks, including `Playwright E2E` with the new specs.
- Heuristic UAT, local DEMO_MODE pre-merge run on emulated mid-range Android (390x844, CPU 4x, 150 ms RTT, 1.6/0.75 Mbps) plus desktop admin. Report: `docs/uat/reports/2026-10-06-enrollment-form.md`.
  - First run: 2 blockers, 1 major, 6 minors. All 3 JTBDs completed.
  - After the fixes: **0 blockers, 1 major, 6 minors**.
    - Oversize PDF error: 54.8 s → 76 ms.
    - Kirim during an upload: now blocked; the file lands on the row.
    - Handover note is inside the viewport; admin card at the top.
  - **Accepted major (driver decision):** a 5 MB 4000x3000 phone photo compresses to 294 KB, and its POST takes 3.3 s on a 750 kbps uplink, which is bound by the uplink. Going below ~200 KB would put the small print on a KK/akta at risk. Busy feedback shows at 86 ms, and the parent can keep working while it uploads.
  - Remaining minors, not fixed this cycle:
    - Simpan shifts 196 px when the handover note appears.
    - The Lanjut-with-one-signature error has no share hint.
    - The second parent needs 5 Lanjut taps to reach the pads.
    - Hapus has no confirmation.
    - The admin card says "Opsional" where the form says "Jika ada".
- Local verification passed for source SHA 415cff6 (route = demo-auth browser + disposable local Postgres). Flows:
  - two-device signature handover;
  - Berkas upload, replace and delete;
  - submit blocked while an upload is in flight;
  - admin Kelengkapan Berkas: view, Lihat, tick.

  No console errors and no 5xx; the only 4xx were the intended 409/413/415 probes.
- After the Codex fixes:
  - `npm run build` exited 0, and `npx vitest run` reported 491 files passed / 2 skipped, 4571 tests passed.
  - Enrollment Playwright set: 12 passed (20.1s), after the documents spec was updated for the new confirm dialog. The first run failed exactly there, as expected.
  - The backend agent re-verified the name carry-over SQL against real Postgres. It also showed that a `FOR UPDATE` submit transaction blocks a concurrent signature merge, which then returns false with the token unchanged.

## Ship Notes

- **Migration:** `20261006000000_add_enrollment_application_documents` adds the nullable `documents JSONB` column. It is purely additive and is applied automatically by `prisma migrate deploy` in `scripts/vercel-build.sh` on the staging and main builds. No backfill is needed.
- **Env vars:** none new. The demo storage backend needs no configuration, and on Vercel it is inert because `VERCEL` is set and Supabase storage is configured. Uploads use the existing Supabase `attachments` bucket under `enrollment/<applicationId>/doc-<key>-<hash>.<ext>`.
- **Verification route:** Local (demo auth + disposable local Postgres). This is not auth-impacting:
  - `proxy.ts`, session, cookie and auth code are unchanged.
  - The new public routes sit under the already-public `/api/enrollments/token/` prefix and are gated by the existing access-token check.
  - The new admin route uses the same `getSession` + `admissions.view` + tenant pattern as the existing signature route.
  - So no `needs-staging-verify` label.
- **Behaviour change for in-flight forms:**
  - Applications still INVITED keep working; their prefilled data loads as before.
  - A signature that was drawn before this deploy but never reached the row (the reported bug) is not recoverable. That parent signs once more, and it then persists.
  - Admissions staff can tell Ais: share the same link with the other parent; each signs on their own phone; whoever finishes taps Kirim.
- **Vercel request limit:** uploads are capped at 4 MB server-side, under Vercel's 4.5 MB body limit. Phone photos are downscaled in the browser first.
- **Rollback:** revert the PR. The `documents` column can stay; nothing reads it after a revert. Signature tokens written into `consentData` by the new route are the same shape the old submit wrote, so old code reads them fine.
- **Follow-ups (non-goals, not done):**
  - Copy uploaded KK/KTP into the guardian record on convert.
  - Show documents on the student detail rail.
  - Optionally require specific documents before submit.
