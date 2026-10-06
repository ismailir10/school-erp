# Enrollment form + convert UX polish

## Context

The 2026-10-07 signed-in staging walk of the enrollment-documents release (#605/#606) passed every acceptance check. Along the way it hit a handful of papercuts across the parent form, the admin enrollment page, the admissions list and the guardian page. None blocks a flow; together they make the flow feel unfinished.

- **Stale documents after a server rejection.** If another device (or staff) removes a required file, the parent's submit is rejected with 422 "Berkas wajib belum diunggah: …". The form still shows that file as "Terunggah", so the parent has no visible thing to fix. `useDocumentUploads` (`components/enrollment/documents-step.tsx`) has no way to drop entries, and the submit route returns only a prose string with no keys.
- **Errors outlive their fix.** The step Alert ("Akta kelahiran anak wajib diunggah.") stays after the parent uploads that very file. `validateStep` only re-runs on Lanjut/Kirim.
- **Phone prefill ignores WhatsApp.** The invite route prefills the parent block's "No. HP" from `Admission.parentPhone` only. The admin "Catat Pertanyaan" dialog has separate WhatsApp and phone fields, and staff often fill only WhatsApp, so No. HP arrives empty. (The staging report blamed phone mapping in general; the code does map `parentPhone`. The real gap is the missing WhatsApp fallback.)
- **Convert is buried.** After "Terima", the header offers only "Kembali ke Tinjau". "Konversi ke Siswa" sits in a bar at the very bottom of a long page, and the "Status diperbarui" toast lands on top of it. Once converted, the page says "Formulir ini sudah dikonversi menjadi data siswa." with no way to reach that student, even though the page already has `studentId`.
- **Cramped row menu.** Shared `DataTableRowActions` and the `DetailPageHeader` overflow menu inherit the dropdown primitive's `w-(--anchor-width) min-w-32`. The anchor is a 32px icon button, so menus are 128px wide and "Lanjutkan ke Jadwalkan Kunjungan" wraps one word per line.
- **Doubled title suffix.** `/pendaftaran/[token]` sets title "Formulir Pendaftaran Murid Baru — Talib" and the root template appends " · Talib". `/daftar` has the same bug.
- **Unconfirmed delete.** Guardian page KTP/KK "Hapus" deletes on click. `ui.md` says every destructive action goes through `<ConfirmDialog>`.

## Spec

- [ ] Submit 422 for missing required documents also returns `missingDocuments: DocumentKey[]` (additive — `fields.documents` text unchanged).
- [ ] On that 422 the form drops those keys from its document state, moves to the Berkas step, and shows the per-document "… wajib diunggah." errors; the rows read "Belum diunggah".
- [ ] While on Berkas, the error Alert re-validates whenever document state changes. Uploading a missing required file removes its message; the Alert disappears when nothing is left.
- [ ] Invite prefill uses `parentPhone ?? parentWhatsapp` for No. HP.
- [ ] `/admin/enrollments/[id]` with status ACCEPTED and not yet converted (and `canEdit`): the header's filled primary action is "Konversi ke Siswa", opening the existing confirm; "Kembali ke Tinjau" stays as outline. The bottom convert bar is removed, so the page has exactly one convert button.
- [ ] After conversion: the converted notice has a "Lihat siswa" link to `/admin/students/<studentId>`, and the convert success toast offers the same as an action.
- [ ] Row-action menus (`DataTableRowActions`) and the `DetailPageHeader` overflow menu size to their content with a sensible minimum, so no label wraps word-by-word. The dropdown primitive itself is unchanged.
- [ ] Titles render as "Formulir Pendaftaran Murid Baru · Talib" and "Pendaftaran Siswa Baru · Talib".
- [ ] Guardian page KTP/KK "Hapus" opens a destructive `ConfirmDialog` ("Hapus KTP?" / "Hapus KK?", consequence stated, confirm "Ya, Hapus", cancel "Batal"); the file is deleted only on confirm.
- [ ] Vitest covers: the submit route returns `missingDocuments`; the form's 422 → Berkas + rows reset; error clears after upload; invite WhatsApp fallback; enrollment page header convert action + "Lihat siswa" link; guardian Hapus requires confirm. Existing e2e selectors still resolve (exactly one "Konversi ke Siswa" button).

**Non-goals**
- Public `/daftar` inquiries have no `parentRelationship`, so their invite prefills neither parent block at all. Guessing Ayah vs Ibu is a product decision; flagged as a follow-up, not fixed here.
- A `GET /documents` refresh endpoint. Returning keys from the 422 covers the observed case without new public surface.
- Parent-side confirm label "Hapus" (vs `ui.md`'s admin "Ya, Hapus"): parent copy follows `voice.md`'s parent persona, left as is.
- Title-case → sentence-case sweep of existing admin labels.
- The dropdown primitive in `components/ui/dropdown-menu.tsx` (a fix there touches every select-like menu).

**Assumptions**
1. Jumping the parent to the Berkas step on this 422 is better than leaving them on Tinjau with an error. They have to upload there anyway.
2. Re-validating only while on the Berkas step is enough. On other steps the Alert already resets on Lanjut/Kembali.
3. Removing the bottom convert bar is fine. Its explanatory sentence is lost, but the confirm dialog already says what convert does ("Tindakan ini membuat data siswa dan data orang tua…").
4. Menu sizing: `w-auto min-w-40` (160px) on the two shared menus. "Lanjutkan ke Jadwalkan Kunjungan" fits on one line at the admin type scale.
5. Guardian confirm copy: title "Hapus <KTP|KK>?", body "<KTP|KK> <guardian name> akan dihapus. Unggah lagi jika masih diperlukan." Deleting the guardian's copy never touches the enrollment-application original (verified on staging).

## Tasks

- [x] **T1 — Server returns missing keys.** `app/api/enrollments/token/[token]/submit/route.ts` adds `missingDocuments` to the 422 body; extend its route test. *Accept:* test asserts `missingDocuments: ["akta"]` alongside the unchanged `fields.documents`.
- [ ] **T2 — Form recovers from stale documents (depends on T1).** `useDocumentUploads` gains `markMissing(keys)`; `app/pendaftaran/[token]/client.tsx` handles the 422 by marking missing, jumping to Berkas and setting the step errors; a `useEffect` on Berkas re-validates when documents change. *Accept:* new client tests for 422 → Berkas + "Belum diunggah", and error cleared after upload; existing client + documents-step tests green.
- [ ] **T3 — WhatsApp prefill fallback (independent).** `app/api/enrollments/invite/route.ts`. *Accept:* invite test: `parentPhone` null + `parentWhatsapp` set → `ayahData.phone` is the WhatsApp number; `parentPhone` still wins when both are set.
- [ ] **T4 — Convert in the header + link to student (independent).** `app/admin/enrollments/[id]/page.tsx`. *Accept:* page tests: ACCEPTED shows header "Konversi ke Siswa" opening the confirm, exactly one such button; converted shows "Lihat siswa" → `/admin/students/<id>`; e2e `enrollment-application.spec.ts` selectors still match.
- [ ] **T5 — Menu width + titles (independent).** `components/ui/data-table-row-actions.tsx`, `components/admin/detail-page-header.tsx`, `app/pendaftaran/[token]/page.tsx`, `app/daftar/page.tsx`. *Accept:* menu content carries the width classes (unit assertion); titles have no "— Talib".
- [ ] **T6 — Guardian Hapus confirm (independent).** `app/admin/guardians/[id]/page.tsx` `DocumentUploadCell` uses `ConfirmDialog`. *Accept:* test: clicking Hapus issues no DELETE until "Ya, Hapus" is confirmed; "Batal" issues none.

## Implementation

- Subagent plan: driver=claude-opus-5-5, dirty-work=claude-sonnet-5-5; T1→T2 sequential (T2 consumes T1's response field); T3–T6 independent but run sequentially in one implementer because they share this worktree's index and gates.
- **T1** — `submit/route.ts` returns `missingDocuments: missing` (the `DocumentKey[]` from `missingUploads`, a closed whitelist, so no file tokens or names) next to the unchanged `fields.documents`; route test asserts `["akta"]`, `["akta","kk"]`, and absence on schema-failure 422. Reviewers (feature-dev + superpowers): no issues.

## Verification

## Ship Notes
