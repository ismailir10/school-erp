# Parent portal + public forms — honest attendance/invoice signals, readable dates, sturdier admission forms

## Context
The 2026-10-07 persona UAT (Pak Budi on a 390×844 and 360×640 Android profile, slow 3G, plus anonymous public visitors; local production build on a disposable Postgres) found no scoping leak — every cross-family probe was blocked — but a cluster of misleading signals and fragile public forms:

- **PARX-4 (major)** The Kehadiran banner says "tercatat sakit pekan ini, semoga lekas sehat" in a week where today is Alpa; the unexplained absence, the one that needs the parent to act, is never mentioned (`lib/parent-attendance-banner.ts` ranks Sakit over Alpa).
- **X-12 / X-13** The parent attendance grid prints dates as MM/DD ("10/05" for 5 Oktober reads as 10 Mei) and labels the status row "Hadir" though it holds ✓/S/I/A.
- **FIN-22 / PAR-9 / PARX-8 / PARX-1 / PARX-9** Invoices: a red "Lewat tempo" chip next to "4 tagihan" when only 2 are overdue; the overdue marker is truncated off the row; the detail sheet says "Belum dibayar" for an overdue invoice and keeps "Bayar sekarang" active right after the gateway said "Pembayaran sedang diperiksa"; a "Cara bayar: Virtual Account" card appears with no VA number when the invoice has no payment link; the kuitansi PDF prints raw enum names ("CASH").
- **PARX-2 (major)** The bottom-centred toast sits over the next dialog's Simpan button for ~4 s, so a tap lands on the toast.
- **PAR-10 / PAR-11 / PAR-14 / PARX-10 / PARX-7** Child tabs call the child by the first word of the legal name while the rest of the portal uses the nickname; a foreign `?child=` is silently replaced; small tap targets; Perkembangan's "Perlu" means nothing on its own; sign-out is one unconfirmed tap.
- **Public (/daftar, /pendaftaran/[token], /legal)**: PAR-2 selects without labels; PAR-4 32 px controls / 14 px selects; PAR-5 gender radio without an indicator; PAR-6 + PUBX-3 enrollment-form phone/email format errors appear only at final submit, at the top of the page, without naming whose field; PAR-15 confirmation shows a raw database id; PUBX-1 a refresh loses the whole /daftar form; PUBX-2 birth dates in 2035 or 1900 accepted and identical double submissions create duplicate inquiries; PUBX-4 resuming the enrollment form restarts at step 1; PUBX-5 expired-link pages give no contact; PUBX-6 no privacy/terms link on forms that collect a child's data; PAR-3 legal pages render as unstyled text with no way back.

The user asked for an uninterrupted multi-hour UAT-and-fix session ("work 5 hours straight, dont stop"), which is the authorization for running this cycle without stopping at the Spec gate.

## Spec
- [ ] PARX-4: the attendance banner names the Alpa days when there are any (with the "hubungi Ustadzah" line) even if the week also has Sakit days; Sakit-only weeks keep the get-well line.
- [ ] X-12/X-13: parent attendance column headers read DD/MM; the status row is labelled "Status".
- [ ] FIN-22: the invoices summary says how many are overdue ("2 lewat tempo"), not a bare chip beside the total. PAR-9: the overdue marker is never truncated off a row.
- [ ] PARX-8: an overdue invoice's sheet says "Lewat tempo"; after a return with "sedang diperiksa", "Bayar sekarang" is replaced by a pending note until the status changes. PARX-1: the Virtual Account card shows only when there is a payment link.
- [ ] PARX-9: the kuitansi PDF prints Indonesian method labels (Tunai, Transfer bank, …).
- [ ] PARX-2: toasts never cover a dialog's action buttons on mobile.
- [ ] PAR-10: child tabs use the same short name as the rest of the parent portal. PAR-11: a `?child=` that is not the parent's child shows a one-line notice and the URL is corrected.
- [ ] PAR-14: the "Pilih anak" back link, "Tulis catatan" and Home "Rapor" tap targets are ≥ 44 px. PARX-10: Perkembangan shows full level names with a short legend. PARX-7: sign-out asks for confirmation.
- [ ] /daftar: gender radio shows a visible indicator (PAR-5); confirmation shows a short human reference instead of a cuid (PAR-15); the form survives a refresh within the session (PUBX-1); the email field explains that it is needed to receive the enrollment form (PUBX-1); birth date must be within a plausible PAUD/TK range (PUBX-2, client `min`/`max` + server validation); an identical submission within 10 minutes returns the existing inquiry instead of a duplicate (PUBX-2).
- [ ] /pendaftaran/[token]: every select has an associated label (PAR-2); phone/email format is checked when leaving the step, with the message under the field (PAR-6/PUBX-3); the submit error names the step and parent; reopening the link resumes at the furthest step reached (PUBX-4); expired/invalid pages show the school contact when configured (PUBX-5).
- [ ] Public form controls are ≥ 44 px tall with 16 px text (PAR-4), scoped to the public forms. /daftar and /pendaftaran link to Kebijakan Privasi and Ketentuan (PUBX-6). Legal pages have readable headings/lists and a link back (PAR-3).

### Non-goals
- No change to `proxy.ts` (anonymous deep-link return path PAR-13 and the `/_vercel` matcher noise X-19 are auth-adjacent; a separate cycle with signed-in staging verification).
- No schema migration, no new dependency. No parent profile editing (PAR-16), no parent-side absence notice (PARX-5), no unread badge in the bottom nav (PARX-6), no review state for assessments (X-14).
- No change to `components/student-journal/*` (being edited by the teacher-robustness cycle).

### Assumptions
1. "Plausible birth date" for /daftar = between 1 and 8 years before today (PAUD/TK, Day Care starts young); enforced server-side with an Indonesian message.
2. Duplicate = same parent phone (normalised digits) + same child name (case-insensitive, trimmed) + same birth date within 10 minutes; the API answers 200 with the existing inquiry, so the family sees the same confirmation.
3. The short human reference for /daftar is derived from the existing row (e.g. last 6 characters upper-cased) — no new column.
4. Toast fix = position toasts at the top on small screens (sonner `position`), which also clears the bottom nav.

## Tasks
- [x] **T1 — Parent attendance.** `lib/parent-attendance-banner.ts`, `app/parent/attendance/**` (+ tests). PARX-4, X-12, X-13. Independent.
- [ ] **T2 — Parent invoices + kuitansi.** `app/parent/invoices/**`, `app/api/guardian/invoices/[id]/pdf/route.ts` and the kuitansi PDF component (+ tests). FIN-22, PAR-9, PARX-8, PARX-1, PARX-9. Independent.
- [ ] **T3 — Parent chrome.** `components/ui/sonner.tsx`, `components/parent/**`, `lib/parent-helpers.ts`, `app/parent/perkembangan/**`, `app/parent/profile/**`, `app/parent/page.tsx`/home client, `app/parent/student-journal/**` page only (+ tests). PARX-2, PAR-10, PAR-11, PAR-14, PARX-10, PARX-7. Independent.
- [ ] **T4 — /daftar + legal.** `app/daftar/**`, `app/api/admission/submit/route.ts`, `lib/validations/admission.ts`, `app/legal/**` (+ tests). PAR-5, PAR-15, PUBX-1, PUBX-2, PUBX-6, PAR-3, PAR-4 (public scope). Independent.
- [ ] **T5 — /pendaftaran/[token].** `app/pendaftaran/**` (+ tests). PAR-2, PAR-6/PUBX-3, PUBX-4, PUBX-5, PAR-4/PUBX-6 for this page. Independent.
- [ ] **T6 — End-of-cycle gate, browser verification, Ship Notes.** Depends on T1–T5.

## Implementation
- Subagent plan: driver=claude-opus-5-5, dirty-work=claude-sonnet-5-5; tasks [T1,T2,T3,T4,T5] parallel (disjoint file sets, one subagent each, no git writes), T6 sequential by the driver. The driver reviews each diff and commits per task.
- T1 (PARX-4, X-12, X-13, PARX-12): `attendanceBannerState` ranks Alpa over Sakit and reports `alsoSick`; the Kehadiran banner now leads with the unexplained absence ("… tidak hadir tanpa keterangan. Hubungi Ustadzah jika ada kabar."; a mixed week reads "… pekan ini sempat sakit, dan ada hari tidak hadir tanpa keterangan…"), and the get-well line is reserved for Sakit-only weeks. Grid headers are DD/MM (`shortDayMonth`), the status row is "Status", `WeekNavigator` gets `todayHref` off the current week, sticky column uses `bg-background`. Tests: banner unit tests + `app/parent/attendance/__tests__/summary.test.ts` (15).

## Verification
- Frontend diffs checked against `.claude/standards/design-system.html` tokens (surface `bg-background`, 44 px targets); no new colours.
- T1: `npx vitest run lib/__tests__/parent-attendance-banner.test.ts app/parent/attendance` → 15 passed. Full `npm run build && npx vitest run` runs at T6 once the parallel slices are in.

## Ship Notes
