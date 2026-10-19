# Wali detail page: answer first, act second (2026-10-19)

## Context

Request: "improve the student and parent detail page, applying don't-make-me-think while making sure admin can do their key task and flexibility. Propose to me." The user approved the proposal and the clickable mockup (the Claude canvas "Student & Wali detail mockup") and said "proceed". This is **cycle A of two**: the wali page plus the shared building blocks. Cycle B (the student page) follows in its own doc and reuses what lands here.

"Parent detail page" = the admin Wali Murid dossier at `/admin/guardians/[id]`, not the parent portal.

Facts from reading the page, its API route and its tests:

- **The money is under-reported.** The page's API returns only the latest 20 invoices. The "Tagihan" count, "belum lunas" and **Piutang** are all computed from those 20, so a family with more than 20 invoices sees a smaller debt than it owes. The same number then drives the rail tile.
- **The most common admin job is buried.** Contacting a wali (WhatsApp / call) only exists in a rail card. On a phone the rail falls to the very end of the document. The header shows "N siswa terdaftar" and no phone number.
- **Nothing says what to do next.** Piutang is a tile in the rail; a missing KK is a checklist line in the rail. The admin has to scan to find the problem.
- **Missing data vanishes.** The view mode hides every empty field, so "no email" and "not shown" look the same.
- **Heavy and risky by default.** Two 192 px KTP/KK previews load immediately on every visit (personal data under UU PDP).
- **Failures read wrong.** Any load failure says "Wali tidak ditemukan", where the student page has separate not-found, denied and retry states.
- **Children are thin.** Rows show name and relationship only, no class, no amount owed, and there is no way to link a child from the wali side (UAT CORE-22, 2026-09-29, possibly stale: later cycles touched these files).
- **Label drift.** This page says "Ubah", the voice standard says "Edit" is the generic word (Ubah data is for the formulir only).
- The invoice module already has a per-invoice WhatsApp reminder (`POST /api/invoices/[id]/reminder`: stamps "Terakhir diingatkan", writes an audit row, needs `payments.record`) and pure helpers in `lib/finance/invoice-reminder.ts`.

## Decisions

Approved by the user with the proposal (all recommended options):

1. **Scope:** the admin Wali Murid page. Structure stays the single-scroll Dossier (Recipe 2b); no tabs.
2. **Answer first.** A "Perlu perhatian" strip under the header appears only when something needs action (money owed, missing KK/KTP, no linked student), one button per row.
3. **Contact in the header.** WhatsApp and Telepon sit in the header on every viewport.
4. **Collapsed means summarised.** `DossierSection` gains an optional one-line `summary`, shown only while collapsed.
5. **Two cycles.** A (this) = wali page + shared blocks + the invoice-total fix. B = student page.
6. **Include** "Ingatkan via WhatsApp" and "Tautkan anak" on the wali page.

Made while building:

- **Totals come from the server over all invoices.** The route selects the minimal fields for every invoice of the wali, summarises them with the existing pure `summarizeStudentInvoices`, and returns the summary; the list is capped at 10 rows, unpaid first. Per-child owed amounts come from the same rows.
- **Ingatkan via WhatsApp** opens `wa.me` to *this wali's* number with one message listing the unpaid invoices, then stamps each remindable invoice through the existing per-invoice endpoint so "Terakhir diingatkan" on the invoice screens stays truthful. It is shown only to a viewer with `payments.record` (new `canRemind` flag in the payload). A stamp that fails (409/422/429) does not block the message; the toast says how many were recorded.
- **Tautkan anak** reuses `StudentPicker` and `POST /api/students/[id]/guardians` with `parentId` (the existing link branch). No new route.
- **Dokumen** starts collapsed and each file's preview opens only on "Lihat" (no new route; the existing auth-proxied GET is requested on demand).
- **Back link restore** (the student page remembers the list's search/page) is out of scope: the guardians list does not mirror its query yet.
- Work happens on the harness-assigned branch `claude/serene-ptolemy-rsgsk1` instead of `feat/<slug>` in a worktree (the session was started on it), as the previous cycles did.

## Acceptance criteria

- [ ] A wali with more than 20 invoices shows the correct Piutang, unpaid count and overdue count (all invoices), while the list shows at most 10 rows, unpaid first, with a link to the full invoice list.
- [ ] The header shows the phone and WhatsApp / Telepon buttons (only the ones that have a usable number); on a phone they are in the first screen, above the sections.
- [ ] "Perlu perhatian" lists: money owed (amount, count, how many overdue), missing KTP, missing KK, no linked student. It is absent when nothing applies.
- [ ] Each collapsed section shows a one-line summary; expanding hides it. Deep links `#profile`, `#documents`, `#children`, `#invoices` still expand and scroll.
- [ ] Empty contact fields read "Belum diisi" (not hidden); NIK stays masked.
- [ ] Anak Terdaftar rows show class and the amount owed per child, and link to the student.
- [ ] "Tautkan anak" links an ACTIVE student to this wali; a student already linked is rejected with the existing message; the list refreshes.
- [ ] "Ingatkan via WhatsApp" opens a prefilled chat to this wali's number for all unpaid invoices and records the reminder; it is absent without `payments.record` or without a usable number.
- [ ] KTP/KK previews load only after "Lihat"; Unggah / Ganti / Hapus (with its confirm) still work.
- [ ] Not-found, denied and failed loads show different states; failed offers "Coba Lagi".
- [ ] The edit action reads "Edit".
- [ ] Vitest, lint and the build are green; existing e2e specs for the wali page pass.

## Verify flows

1. **Chase a debt, desktop.** `u_super_admin`, a wali with unpaid invoices: open the wali page. Expect the amount owed in "Perlu perhatian", WhatsApp / Telepon in the header, "Ingatkan via WhatsApp" opens wa.me with the invoice list and the invoice shows "Terakhir diingatkan". Edge: a wali with 25+ invoices shows the full total. Error: a wali with no phone shows no contact buttons and no reminder, and Data Wali says "Belum diisi".
2. **Phone, 390×844.** Same wali: header contact buttons are in the first screen and ≥ 44 px; groups collapse with their summaries; the Dokumen header reads "KTP ada · KK belum ada".
3. **Link a child.** "Tautkan anak" → pick a student and a relationship → the child appears with class and amount owed. Error: linking the same student again shows "Wali ini sudah tertaut ke siswa tersebut."
4. **Documents.** Open Dokumen: no preview is requested until "Lihat"; upload and delete still confirm and refresh the checklist.

## UX notes

Primary action per screen: contact (WhatsApp) in the header, the strip's button when something is wrong. Labels: "Perlu perhatian", "Ingatkan via WhatsApp", "Tautkan anak", "Belum diisi", "Lihat semua N tagihan", "Edit". Voice follows `voice.md` (Indonesian, courteous, no exclamation). Empty states: no children → "Belum ada anak terdaftar" + the Tautkan anak button; no invoices → "Belum ada tagihan". The design-system reference was checked for tokens (teal primary, status colours, `font-currency` for amounts).

## Test seams

- Vitest (node): the parent detail route (all-invoices summary, list cap and order, per-child owed, `canRemind`, tenant scoping); pure helpers for the attention items and the family reminder text.
- Vitest (jsdom): `DossierSection` summary, `AttentionStrip`, `ContactActions`; the wali page (strip, header contact, Belum diisi, error states, on-demand preview, Tautkan anak, reminder).
- Playwright: extend `e2e/admin-guardian-detail.spec.ts` (header contact, strip, link a child); `e2e/mobile-layout.spec.ts` keeps covering 390 px.

## Non-goals

The student page (cycle B); tabs; the guardians list; the parent portal; a new reminder route or reminder wording change; recording payments from this page; the list-query back link; any schema, permission or lifecycle-rule change.

## Assumptions

1. A wali's invoices are the ones billed to that wali (`Invoice.parentId`), as today.
2. A tenant's wali has tens of invoices at most, so selecting the minimal fields of all of them is cheap.
3. `payments.record` is the right gate for reminders (it is what the invoice endpoint requires).
4. Existing labels are kept unless named above.

## Gate re-openers

None expected: no schema change (additive response fields only), no new dependency. The route is a sensitive path (`app/api/**`), so it gets the security review. The personal-data exposure goes *down* (previews on demand).

## Tasks

- [x] T1 Wali invoice truth: route returns the all-invoices summary, a capped unpaid-first list with student names, per-child class and owed, `canRemind` — accept: route tests incl. 25 invoices (deps: none, reuse: `summarizeStudentInvoices`, `pickPrimaryEnrollment`) — parallel with T2
- [x] T2 Shared blocks: `DossierSection` `summary`, `AttentionStrip`, `ContactActions` — accept: component tests (deps: none, reuse: `telHref`, `whatsappHref`, `DetailRail` look) — parallel with T1
- [x] T3 Wali page restructure: header contact, strip, summaries and default open state, Belum diisi, children rows, error states, "Edit" label, tiles from the server summary — accept: page tests + updated section test (deps: T1, T2)
- [x] T4 Dokumen on demand: preview only after "Lihat" — accept: test no preview request before click (deps: T3)
- [x] T5 Tautkan anak dialog — accept: test link and duplicate (deps: T3, reuse: `StudentPicker`, `ResponsiveFormDialog`, `RELATIONSHIP_OPTIONS`)
- [ ] T6 Ingatkan via WhatsApp — accept: helper + page test (deps: T3, reuse: `invoice-reminder.ts`, `POST /api/invoices/[id]/reminder`)
- [ ] T7 Docs and e2e: admin JTBD (GUARD jobs), README module line, e2e spec update, counts via `audit-docs.sh --write` (deps: T3–T6)

## Implementation

- Plan: driver=claude-sonnet-5-5, workers=claude-sonnet-5-5 (subagents; no cheaper tier is available for the driver). T1 and T2 parallel (disjoint files), T3 then T4, T5, T6 sequential (all edit the wali page, one worker or the driver per slice), T7 inline (docs, small).
- T1: `app/api/parents/[id]/route.ts`, `lib/parent/detail-invoices.ts` (+ tests) — GET now selects every invoice of the wali (tenant + parent scoped, minimal fields, no cap) and returns `invoiceSummary`, a 10-row unpaid-first `invoices` list with `studentName`, `unpaidInvoices` (25, oldest due first), per-guardian `outstanding` and `student.className`, and `canRemind` (`payments.record`). Amounts are numbers now. Driver reviewed the diff for the sensitive-path checklist: session, admin role, tenant filter and rate limit unchanged; ktp/kk tokens still stripped; enrollments used only to name the class and stripped from the response.
- T2: `components/admin/dossier-section.tsx`, `attention-strip.tsx`, `contact-actions.tsx` (+ 3 test files) — `DossierSection` takes an optional `summary` shown only while collapsed (design-system tokens, wraps under the label on a phone); `AttentionStrip` renders nothing when empty, one outline button per row, message text in `text-foreground` because `text-status-late-text` on `status-late-subtle` measures 4.35:1 (under AA), count badge `bg-status-late-text` white text 4.72:1; `ContactActions` shows WhatsApp / Telepon only for usable numbers and falls back from a blank WhatsApp to the phone. Gate: eslint + tsc clean, `vitest` on students, guardians, classes and components/admin 441 passed.
- T3: `app/admin/guardians/[id]/page.tsx` (now a thin orchestrator), `components/admin/guardians/detail/{types,summaries,profile-view,children-list,invoices-list,documents-section,guardian-rail}` + tests (`dossier-sections`, `document-delete-confirm`, new `page`, `page-mobile`, shared `parent-fixture`) — order Anak Terdaftar, Tagihan, Data Wali, Dokumen; "Perlu perhatian" strip and header contact; per-section summaries; Dokumen closed by default (phone: only children + invoices open); "Belum diisi" view mode; child rows with class and owed; invoice total block with a capped-list footer linking each child's `#keuangan`; desktop-only rail tiles (Piutang, Anak Terdaftar, Berkas) via `hidden lg:flex`; separate not-found / denied / retry states; "Edit" label (starting an edit opens a collapsed Data Wali). design-system tokens only (status-late tones, `font-currency`, DossierSection/StatTile).
- T4: `components/admin/guardians/detail/documents-section.tsx` + `document-preview.test.tsx` — KTP and KK are rows (`Ada` / `Belum ada` badge, Lihat, Ganti or Unggah, Hapus); the 192 px `<embed>` is gone and the auth-proxied file is requested only after Lihat (button reads Tutup while open, with `aria-expanded`); upload validation, toasts and the delete confirm are unchanged; deleting closes an open preview.
- T5: `components/admin/guardians/link-student-dialog.tsx`, `lib/validations/guardian.ts` (`linkChildFormSchema`: student + relationship; the page adds `parentId`), the wali page, README `students` row (+ tests in `components/admin/guardians/__tests__` and `page-link-child.test.tsx`) — `ResponsiveFormDialog` with `StudentPicker` and a relationship select (Ayah, Ibu, Wali default, Lainnya; legacy PARENT excluded); POSTs `{ parentId, relationship }` (no `isPrimary`) to the existing `/api/students/[id]/guardians`; 409 `GUARDIAN_LINK_EXISTS` lands on the student field, other failures in the form's root error; entry points are the Anak Terdaftar section action, its empty state and the "Belum tertaut ke siswa" strip row, all `canEdit` only. README row trimmed elsewhere to stay under 600 chars.

## Verification

## Ship Notes
