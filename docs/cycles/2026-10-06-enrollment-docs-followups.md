# Enrollment documents follow-ups: guardian copy, student page, required-before-submit

## Context

PR #605 (`docs/cycles/2026-10-06-enrollment-signature-handover-and-checklist.md`) shipped parent uploads of the Kelengkapan Berkas documents on `/pendaftaran/[token]` and the staff card on `/admin/enrollments/[id]`. It left three follow-ups as non-goals. The user asked for all three on 2026-10-06 ("get the not built list done, then promote to main"):

1. **Copy KK/KTP into the guardian record on convert.** Converting an application creates or reuses the Ayah/Ibu `Parent` rows, but their `ktpUrl`/`kkUrl` stay empty even when the parent uploaded them. Staff have to re-upload on `/admin/guardians/[id]`.
2. **Show the documents on the student page.** After convert, the documents are only visible on the application page. The student dossier already has a read-only Pendaftaran section and a "Kelengkapan Berkas" rail checklist, and neither shows them.
3. **Optionally require specific documents before submit.** Today every upload is optional. Which documents a school requires is a policy choice, so it is made configurable per school rather than hard-coded.

## Spec

### 1. Guardian copy on convert
- [ ] After the convert transaction commits, copy the stored objects (best-effort, outside the DB transaction) into the guardian's own storage path (`entity: "parents"`, field `ktp`/`kk`). The guardian then owns an independent copy, so neither side's delete can break the other.
  - `ktp_ayah` → Ayah `Parent.ktpUrl`
  - `ktp_ibu` → Ibu `Parent.ktpUrl`
  - `kk` → Ayah `Parent.kkUrl` (Ibu's when there is no Ayah), since the student page resolves KK through the primary guardian.
- [ ] Never overwrite: each write is a conditional `updateMany({ where: { id, ktpUrl: null } })` (or `kkUrl`). If the column was filled in the meantime, the copied object is deleted again.
- [ ] A copy failure never fails the convert. The response gains `documentsCopied: { ktpAyah, ktpIbu, kk }` (`"copied" | "skipped_existing" | "missing" | "failed"`), and the convert success toast mentions what was copied.

### 2. Student page
- [ ] `GET /api/students/[id]/enrollment-application` also returns `documents` via `toAdminDocuments` (no tokens) and `canEditDocuments` (`admissions.edit`).
- [ ] The dossier's Pendaftaran section renders the existing `EnrollmentDocumentsCard`, the same component as the application page, so staff can open files and tick "Diterima fisik" from the student page.
- [ ] The rail checklist gains one row, "Berkas pendaftaran (x / N)", which counts as present when every required document is uploaded or received. It only appears for students converted from an application. `/api/students/[id]/overview` supplies the counts.

### 3. Required before submit (configurable, default none)
- [ ] New `OrgConfig.enrollmentRequiredDocuments String[] @default([])`, one additive migration. The default is empty, so production behaviour is unchanged until staff configure it.
- [ ] Settings page `/admin/settings/pendaftaran` ("Berkas wajib pendaftaran") with one checkbox per document item. It saves through `GET/PUT /api/config/enrollment`, which requires `admissions.edit`, is tenant-scoped and validates keys against `DOCUMENT_KEYS`. If the tenant has no OrgConfig row, it is created with the same defaults the org-config route uses. A link is added to the settings hub/nav.
- [ ] The parent form receives the required list from `page.tsx`:
  - The Berkas step labels those items "Wajib diunggah" and adjusts its intro: some documents must be uploaded, and the rest can be brought to school.
  - Lanjut on the Berkas step is blocked until they are uploaded, and the step lists what is missing.
  - Tinjau and the success screen are unchanged.
- [ ] Submit enforces the list server-side inside the existing `FOR UPDATE` transaction, using the row's `documents`. A missing upload returns 422 `fields.documents: "Berkas wajib belum diunggah: …"`.
- [ ] The admin card's progress counter and the Required/Opsional badges are unchanged. "Required" in the counter remains the paper-form checklist (9).
- [ ] Vitest covers all new routes and branches. E2E covers the convert copy (guardian KTP present after convert) and required-before-submit (configure → parent blocked → upload → submit OK). README and the UAT jobs are updated.

### Non-goals
- Per-application overrides of the required list.
- Requiring physical receipt before convert.
- Moving or deduplicating already-stored guardian files.

### Assumptions
- The user's instruction to do all three and then promote to main is the approval for this cycle. There is no separate spec gate, because the user is away. The one policy decision (which documents are required) is left to the school as a setting, so it isn't guessed.
- A guardian reused from a sibling keeps its existing KTP/KK (never overwritten).

## Tasks

- [x] **T1 — Migration + config API.** Add `OrgConfig.enrollmentRequiredDocuments`, its migration, and `GET/PUT /api/config/enrollment` with tests. *Deps:* none.
- [x] **T2 — Settings page.** Add `/admin/settings/pendaftaran` and a nav/hub link, with tests. *Deps:* T1.
- [x] **T3 — Enforce on the form + submit.** Server 422, `page.tsx` prop, Berkas step validation and copy, tests. *Deps:* T1.
- [ ] **T4 — Guardian copy on convert.** Storage copy helper, convert route post-transaction copy, `documentsCopied`, toast copy, tests. *Deps:* none.
- [ ] **T5 — Student page.** `enrollment-application` route documents, Pendaftaran section card, overview counts and rail row, tests. *Deps:* none.
- [ ] **T6 — E2E + docs.** Specs, README, UAT jobs, Ship Notes. *Deps:* T1–T5.

## Implementation

- Subagent plan: driver=claude-opus-5-5, dirty-work=sonnet.
  - Parallel: a backend slice (T1, T3 server, T4, T5 API) and a frontend slice (T2, T3 form, T4 toast, T5 UI) against a frozen contract, plus an E2E agent.
  - The driver reviewed, and an independent review agent checked security and correctness.
  - Commits are grouped T1–T3 / T4–T5 / E2E, because the commit-msg hook needs a README hunk per `feat` commit touching app/lib and the README has room for two lines.
- **Review-driven design change:** the setting moved from `OrgConfig` to `Tenant.enrollmentRequiredDocuments`.
  - Creating an OrgConfig row for a tenant without one would have silently changed attendance lateness (`attendance/check-in`), let payroll run on a 21/20 period nobody chose (`payroll/generate`), and narrowed class working days (`admin/classes`). Those readers treat "no row" differently from "row with defaults".
  - The migration had not shipped, so the move was free.
- Tasks 1–3: required-before-submit, configurable per school.
  - **Data:** `prisma/schema.prisma` adds `Tenant.enrollmentRequiredDocuments String[] @default([])`, with migration `20261006010000_add_tenant_enrollment_required_documents`.
  - **Reading:** `lib/enrollment/required-documents.ts` `getRequiredDocuments` filters unknown keys and keeps item order. `lib/enrollment/documents.ts` gains `missingUploads`, where a physical tick does not count.
  - **API:** `app/api/config/enrollment` serves GET (`admissions.view`, plus `canEdit`) and PUT (`admissions.edit`, rate-limited, keys validated then deduped by `lib/validations/enrollment-config.ts`). It only ever does `tenant.update`.
  - **Submit:** the route enforces the list inside the existing `FOR UPDATE` transaction, returning 422 `fields.documents`.
  - **Settings UI:** `/admin/settings/pendaftaran` is a checkbox list. It is read-only when `canEdit` is false and shows a no-access message on a 403. The nav item "Berkas Wajib Pendaftaran" is gated on `admissions.view`.
  - **Parent form:** `page.tsx` passes `requiredDocuments`, falling back to `[]` if the read fails because the server still enforces. The Berkas step shows the "Wajib diunggah" badge and changes its intro, and Lanjut is blocked with "<label> wajib diunggah." until the file is uploaded.
  - README public row updated.

## Verification

- Full gate after review fixes: `npm run build` exit 0; `npx vitest run` (no DEMO_MODE) 495 files passed / 2 skipped, 4645 tests passed; `verify-api-auth` 203/203; `verify-rls-coverage` 42/42; local migration applied, and `prisma migrate diff` reports empty.
- Playwright (local prod build, DEMO_MODE, disposable Postgres): `e2e/enrollment-docs-followups.spec.ts` plus the enrollment set gave **16 passed (27.5s)**, with no retries.
- design-system: the settings page follows the existing work-hours settings layout with Shadcn Checkbox/Button/Alert. The parent badge and the student-page card reuse existing components and tokens; no new colours.

## Ship Notes
