# Parent Portal — Jobs to be Done

> Last audited: 2026-10-10 in cycle `pendaftaran-fee-payment` (new JTBD-PARENT-ENROL-03: pendaftaran fee shown at Tinjau, paid through DOKU after sending, status on `/pendaftaran/[token]/pembayaran`). Prior: 2026-10-06 in cycle `enrollment-signature-handover-and-checklist` (new `enrollment-form` area: two-parent signature handover on `/pendaftaran/[token]` and Kelengkapan Berkas upload; first user-facing jobs for the public enrollment form). Prior: 2026-09-29 in cycle `finance-safety` (invoice sheet shows Total / Sudah dibayar / Sisa and a school-contact affordance when there is no payment link). Prior: 2026-06-23 `ui-shadcn-audit` (checked invoice search/filter/sort affordances for long lists)
> Role-redesign acceptance jobs updated: 2026-09-25; new browser verification pending, not representative-user UAT.
> Code and regression review: 2026-09-25 (child continuity, payment return, WIB week boundaries); this is not a new user UAT session.
> Portal root: `app/parent/`
> Default persona: Pak Budi (see `.claude/personas/pak-budi.md`)

This file is the living catalog of what a parent user can and should be able to do in this system. `/uat parent` reads it, picks jobs scoped to the requested area, and role-plays each one via Playwright MCP. When a cycle adds, removes, or materially changes a parent-facing capability, edit this file as part of that cycle and bump the "Last audited" date.

---

## Area: invoices

### JTBD-PARENT-INV-00 — Trust the payment return and keep the right child
- **Persona:** Pak Budi
- **Role:** GUARDIAN
- **Preconditions:** Logged in with two linked children; one child has a pending invoice, another has a partially paid invoice and a paid invoice.
- **Steps:**
  1. Choose the second child in Jurnal, then move through Tagihan, Kehadiran, Rapor, Profil, and back using tabs and links; reload and use browser back.
  2. Return from a payment provider with `paymentStatus=paid` while the invoice is still `SENT`, then after the server records a partial payment, then after it records `PAID`.
  3. Repeat with an invoice ID outside this guardian's linked children and with a conflicting `child` query.
  4. Check the attendance week at 00:30 WIB on Monday, while the server clock is still Sunday UTC.
- **Done when:** Every child-specific page stays on the linked selected child; the callback invoice selects its linked child; an unlinked ID never opens another family's invoice. The portal says payment is being checked for an unpaid invoice, acknowledges a partial payment and remaining balance, and says paid only after the server reports `PAID`. The displayed attendance day and week follow WIB.
- **Why this job matters:** A wrong child or premature paid message makes the portal's most sensitive information hard to trust.
- **Verification status:** Code review, automated regressions, and local production-browser verification against disposable data on 2026-09-25 passed for child context and authoritative payment states. Representative-user mobile UAT remains to be performed.


### JTBD-PARENT-INV-01 — Pay the oldest outstanding invoice
- **Persona:** Pak Budi
- **Role:** GUARDIAN
- **Preconditions:**
  - Logged in as a parent with ≥1 unpaid invoice (status `PENDING` or `OVERDUE`) in demo seed
  - Demo cookie set (pattern from `e2e/parent.spec.ts`)
- **Steps (user intent, not UI clicks):**
  1. Land on the parent portal home
  2. Find which invoice is due next (amount + due date visible)
  3. Initiate payment via the system's payment flow (Xendit or whatever the wired provider is)
  4. Reach a confirmation state they can trust — amount, reference number, visible success
- **Done when:** User sees a clear success state with amount + reference. If Xendit redirect is involved, the redirect back to the portal shows the invoice as `PAID` or `PENDING_CONFIRMATION`.
- **Why this job matters:** Pak Budi's #1 priority. If this is slow or confusing, he stops trusting the whole ERP.
- **Expected perf:** invoices list load <1.5s; tap "Bayar" click-to-Xendit-redirect <2s; return-to-portal reconciliation visible <3s.
- **Known friction:** BLOCKER resolved 2026-04-17 (cycle `parent-uat-fixes`): demo invoices lacked `xenditPaymentUrl`; seed now populates deterministic placeholder. Duplicate "sedang disiapkan" message also removed. BACKFILL resolved 2026-04-18 (cycle `fix-parent-payment-backfill`): seed idempotency guard now patches existing null-URL SENT/PARTIALLY_PAID/OVERDUE rows on re-run; previously skipped them unconditionally.

---

### JTBD-PARENT-INV-02 — Understand an invoice's line-item breakdown
- **Persona:** Pak Budi
- **Role:** GUARDIAN
- **Preconditions:** Logged in as a parent with ≥1 invoice that has multiple fee components (SPP, uang kegiatan, etc.)
- **Steps:**
  1. Open the parent portal → Tagihan
  2. Tap into an invoice
  3. See every line item with its label and amount, plus Total tagihan, Sudah dibayar and Sisa tagihan
  4. On an unpaid invoice without a payment link, see how to reach the school (WhatsApp/telephone when configured, and the invoice number to quote)
- **Done when:** Pak Budi can tell his wife exactly what the Rp X amount is made of, component by component. No opaque "Tagihan bulan Maret" with just a total. A payment the school later reversed does not appear in his history or in "Sudah dibayar".
- **Why this job matters:** Trust builder. When SPP goes up or a new fee appears, parents compare notes in WhatsApp. If the breakdown is hidden, the school looks shady.
- **Expected perf:** detail page load <1.5s; all line items visible without horizontal scroll on 375px viewport.

---

### JTBD-PARENT-INV-03 — Review paid-invoice history (last 3 months)
- **Persona:** Pak Budi
- **Role:** GUARDIAN
- **Preconditions:** Logged in as a parent with ≥2 paid invoices in the last 90 days
- **Steps:**
  1. Open the parent portal → Tagihan
  2. When the child has more than 10 invoice/payment rows, use the search input to find a period or invoice number
  3. Use the status filter to show `LUNAS`, then use the sort control to review newest payment or largest amount ordering
  4. Confirm each paid invoice shows status `LUNAS`, paid date, and amount
- **Done when:** Pak Budi can prove to his wife "we already paid March and April". Paid invoices are listed (not hidden after payment) with a clear paid indicator and date. Long invoice lists expose search, status filter, sort, reset, and an empty state when the current filters match nothing.
- **Why this job matters:** Recordkeeping. When a school admin mistakenly sends a reminder for an already-paid invoice, Pak Budi needs evidence to push back. If paid invoices disappear from the list, he has nothing.
- **Expected perf:** history list load <1.5s; paid indicator + paid-date visible without opening each item.
- **Error scenarios to verify:**
  - Search/status/sort combination with no matches → empty state explains that no invoice matches the current filters
  - Reset clears search, returns status to all, and restores due-date ascending sort

---

## Area: attendance

### JTBD-PARENT-ATT-01 — Check child's attendance this week
- **Persona:** Pak Budi
- **Role:** GUARDIAN
- **Preconditions:** Logged in as a parent whose child has attendance records in the current week
- **Steps:**
  1. Open the parent portal
  2. Navigate to the attendance view
  3. See at a glance: how many days present, any absences, any late arrivals for this week
- **Done when:** User can count today's status and this week's status without scrolling. Status is shown as a badge or icon, not just a word in a table.
- **Why this job matters:** Second most common reason Pak Budi opens the app. If it takes more than 2 navigations to find this, he assumes Aisha was absent and panics.
- **Expected perf:** home card shows today's status <1.5s after page load; weekly view load <1.5s.
- **Known friction:** MAJOR addressed 2026-04-17 (cycle `parent-uat-fixes`): home Kehadiran card now shows today's `StatusBadge` or "Belum dicatat", eliminating the extra navigation to determine today's attendance.

---

## Area: reports

### JTBD-PARENT-REP-01 — View latest report card
- **Persona:** Pak Budi
- **Role:** GUARDIAN
- **Preconditions:** Logged in as a parent whose child has ≥1 published report card in seed
- **Steps:**
  1. Open the parent portal
  2. Navigate to the reports area
  3. Open the most recent report card and see scores/assessments
- **Done when:** User reaches the published report card. If there is no report yet, the empty state explains when it will be available (not a blank page).
- **Why this job matters:** Low frequency (once per quarter) but high emotional weight. Pak Budi wants to read it without being a power user.
- **Expected perf:** report list load <2s; opening a single report (sheet/detail) click-to-visible <2s on 4G.
- **Known friction:** MAJOR resolved 2026-04-17 (cycle `parent-uat-fixes`): replaced 5-col DataTable with mobile card stack; "Lihat" button now fully visible at 375px. BLOCKER (timing) resolved 2026-04-18 (cycle `fix-parent-payment-backfill`): list query now uses `select` with only list-level fields; categories/indicators/scores lazy-loaded via `/api/guardian/assessments/[id]` on sheet open. Page load reduced from 5.3s to expected sub-2s.

---

### JTBD-PARENT-REP-02 — Read the report card indicator by indicator
- **Persona:** Pak Budi
- **Role:** GUARDIAN
- **Preconditions:** Logged in as a parent whose child has ≥1 published report with multiple categories and indicators (e.g. "Akhlak", "Kognitif", "Bahasa")
- **Steps:**
  1. Open the parent portal → Rapor
  2. Open the latest report
  3. Read each category → each indicator → the score/descriptor
- **Done when:** Pak Budi can point at any single indicator (e.g. "Mampu menyebut huruf hijaiyah 1-10") and see its specific score or narrative, not just a category-level roll-up.
- **Why this job matters:** This is where the report card earns its keep. PAUD/TKIT parents want narrative formative feedback, not letter grades. If the UI flattens everything to a single score per category, the report loses its whole reason to exist.
- **Expected perf:** opening a report with 3+ categories and 10+ indicators renders fully <2s; no lazy-loaded blocks should still be spinning after 3s.

---

## Area: student-journal

### JTBD-PARENT-JOURNAL-01 — Read this week's school-side journal entries
- **Persona:** Pak Budi
- **Role:** GUARDIAN
- **Preconditions:**
  - Logged in as a parent whose child has ≥1 school-side journal entry this week (teacher filled the class-day checklist + wrote ≥1 note)
  - Demo cookie set (pattern from `e2e/parent.spec.ts`)
- **Steps (user intent, not UI clicks):**
  1. Open the parent portal → Jurnal
  2. Confirm the right child is selected (multi-child households)
  3. Land on the "Sekolah" tab
  4. Read each day's checklist status (what the teacher filled) and any notes the teacher wrote this week
- **Done when:** Pak Budi can answer his wife's question "what did Aisha do at school this week?" without calling the teacher. Each day's indicator checklist is readable at a glance; notes are grouped by date with the author role visible as `GURU` / `WALI`.
- **Why this job matters:** the Jurnal (Buku Penghubung, staff-side) is the primary trust artifact for PAUD/TKIT parents — they pay for visibility into the school day. If this page fails to render the teacher's daily entries, the school looks absent.
- **Expected perf:** week grid load <1.5s; week navigation prev/next click-to-update <1s.
- **Error scenarios to verify:**
  - No entries for the week yet → empty state reads "Belum ada catatan minggu ini" (not a blank grid)
  - Network error on `/api/student-journal/children/{id}/week` → toast + retry CTA, never a white screen
- **Known friction (from last UAT):** <filled by /uat reports>

---

### JTBD-PARENT-JOURNAL-02 — Fill today's home-side habits checklist
- **Persona:** Pak Budi
- **Role:** GUARDIAN
- **Preconditions:** Logged in as a parent whose child has at least one home-side journal indicator configured for this week
- **Steps:**
  1. Open the parent portal → Jurnal
  2. Switch to the "Rumah" tab
  3. For today's column, toggle the habits Aisha completed (e.g. sholat shubuh, mandi, tidur siang)
  4. Confirm the toggle persists immediately — no separate save button (`POST /api/student-journal/entries/home` fires synchronously on each tap, week re-fetches after)
- **Done when:** Toggled entries persist on reload. Any day from the Monday of the previous week through today is editable, so a missed day can still be filled later in the week; future days and anything before that floor are visually differentiated as read-only. Parent never accidentally overwrites yesterday's data thinking it was today's.
- **Why this job matters:** Home side is the parent's half of the journal contract — skip this and the teacher has no signal on home reinforcement. If the toggle fires for the wrong day, trust collapses immediately.
- **Expected perf:** toggle click-to-persisted <800ms (optimistic UI acceptable as long as rollback on failure is visible).
- **Error scenarios to verify:**
  - Tap a day outside the edit window (before the previous week's Monday, or any future day) → disabled cell, or error toast "Tanggal di luar jangkauan. Hanya bisa diubah dari Senin minggu lalu sampai hari ini."
  - `POST /api/student-journal/entries/home` 500 → toggle reverts after failed re-fetch, toast surfaces failure
- **Known friction (from last UAT):** <filled by /uat reports>

---

### JTBD-PARENT-JOURNAL-03 — Write, edit, then delete a parent note on a specific date
- **Persona:** Pak Budi
- **Role:** GUARDIAN
- **Preconditions:** Logged in as a parent whose child has an active journal for this week
- **Steps:**
  1. Open the parent portal → Jurnal → "Catatan" tab
  2. Pick today's date and write a note ("Aisha batuk semalam, mungkin kurang fit hari ini")
  3. Save. See the note appear in the thread with a `WALI` badge and today's date.
  4. Edit the note (correct a typo) and save again. See the updated text.
  5. Delete the note. Confirm via AlertDialog. See the note gone from the thread.
- **Done when:** Full CRUD round-trip persists across reloads. Delete requires an AlertDialog confirmation (per `.claude/standards/portal.md` destructive-action contract). The note never silently attaches to the wrong child in multi-child households.
- **Why this job matters:** Parent-written notes are how sakit, izin, and family context reach the teacher before morning circle. A stuck save or wrong-child attachment creates real miscommunication.
- **Expected perf:** note create click-to-visible <1s; edit-save <1s; delete confirm-to-removed <1s.
- **Error scenarios to verify:**
  - Empty note body → client-side validation blocks submit with inline message
  - Note body >2000 chars → server rejects with 400 + toast "Catatan terlalu panjang"
  - Delete cancelled in AlertDialog → note stays, no API call fired
  - Attempt to edit/delete a teacher-authored note → edit/delete CTAs absent (client-side `canEdit` guard checks `authorRole === "GUARDIAN"` and `authorUserId === currentUserId`; API does not independently 403 at the route level — UI is the sole enforcement boundary today)
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Area: profile

### JTBD-PARENT-PROFILE-01 — Review linked children and jump to one child's attendance
- **Persona:** Pak Budi
- **Role:** GUARDIAN
- **Preconditions:** Logged in as a parent linked to ≥2 children
- **Steps:**
  1. Open the parent portal → Profil
  2. Scan the identity block (name, "Wali murid" role, phone, email)
  3. Scroll to the children list
  4. Tap one child's card
  5. Land on `/parent/attendance?child=<studentId>` scoped to that child's data
- **Done when:** Each linked child appears with initials, name, and class. Tapping a child lands on attendance scoped correctly (URL query param set, week grid shows that child's records). The profile view itself is read-only — no edit CTAs are present (editing is not yet shipped).
- **Why this job matters:** Low-frequency page but it is how parents verify the school has the right guardian–child links on file. Wrong linkage here means wrong invoice routing and wrong report-card access.
- **Expected perf:** profile page load <1.5s; child-card tap to attendance page visible <1.5s.
- **Error scenarios to verify:**
  - Parent has zero linked children (edge case, bad seed) → empty state "Belum ada anak terhubung" with instruction to contact admin
  - Child card links to a studentId the parent isn't authorized for → backend 403, UI surfaces it as "Tidak dapat membuka data anak ini"
- **Known friction (from last UAT):** <filled by /uat reports>

---

### JTBD-PARENT-PROFILE-02 — Sign out cleanly
- **Persona:** Pak Budi
- **Role:** GUARDIAN
- **Preconditions:** Logged in as a parent on any portal page
- **Steps:**
  1. Open the parent portal → Profil
  2. Tap "Keluar"
  3. Confirm the sign-out action if an AlertDialog is presented
  4. Land on a safe signed-out state (login page or marketing landing)
- **Done when:** Session cookie cleared; attempting to visit `/parent/invoices` after sign-out redirects to login. The button is findable without zooming on a 375px viewport.
- **Why this job matters:** Shared-device households (one phone, two parents) — if sign-out is hard to find or silently fails, the other parent sees the first parent's data. Privacy breach.
- **Expected perf:** tap-to-signed-out-landing <2s including cookie clear + redirect.
- **Error scenarios to verify:**
  - Sign-out API failure → toast + stay signed in (never pretend to sign out while cookie persists)
  - Browser back button after sign-out → does NOT restore authenticated page (server re-checks session)
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Area: home

### JTBD-PARENT-HOME-01 — Morning household quick-check
- **Persona:** Pak Budi
- **Role:** GUARDIAN
- **Preconditions:** A guardian linked to multiple children, with saved and missing attendance, teacher notes, and authoritative outstanding invoices across more than one child. Include a payment-link-unavailable invoice and a partially paid invoice.
- **Steps:**
  1. Open the parent portal root `/parent`
  2. Read household actions first, then each child's full identity, today's recorded attendance, and teacher-note preview as available
  3. Decide whether any action is needed (pay, message teacher, none)
- **Done when:** The first viewport makes the household's next action clear. Compact cards remain readable while scrolling through multiple children. "Baca catatan" opens the named child's notes, and attendance/development/report/bill labels predict their destinations. A family total must not masquerade as a single child's payable amount. Missing attendance is unknown, and a guardian reply is never labeled as a teacher note or misattributed to another guardian.
- **Why this job matters:** This is the morning glance — Pak Budi opens the app between sholat shubuh and leaving for work. If the dashboard buries any of the three signals below the fold, he gives up and asks his wife instead.
- **Expected perf:** page full load <1.5s (SSR'd, three parallel Prisma queries via `Promise.all` in `app/parent/page.tsx` — threshold matches the global list-page rule in `SKILL.md`).
- **Error scenarios to verify:**
  - Child with zero attendance records yet → tile reads "Belum ada catatan" (not a blank card)
  - Unpaid-balance query fails but attendance succeeds → partial render (attendance still visible), balance tile shows "Gagal memuat, ketuk untuk muat ulang"
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Area: multi-child

### JTBD-PARENT-MULTI-01 — Switch from child A to child B across every data page
- **Persona:** Pak Budi
- **Role:** GUARDIAN
- **Preconditions:** Logged in as a parent linked to ≥2 children (Aisha + Yusuf) with distinct data in each area (different invoices, different attendance, different reports, different journal entries this week)
- **Steps:**
  1. On `/parent/invoices`, confirm Aisha is selected. Note her invoice list.
  2. Switch the child tab/pill to Yusuf. Confirm the invoice list updates to Yusuf's invoices (not Aisha's bleeding through).
  3. Navigate to `/parent/attendance`. Child selector should remember the last-chosen child OR default cleanly (either is acceptable, but must be consistent).
  4. Switch to Yusuf on attendance. Confirm his week grid shows.
  5. Repeat on `/parent/reports` and `/parent/student-journal`.
- **Done when:** Each of the four data areas (invoices, attendance, reports, journal) shows the correct child's data after the switch. The URL query param (`?child=<id>`) or state reflects the selected child. No "stale data from the previous child" bug where the list renders with Aisha's data while the tab highlights Yusuf.
- **Why this job matters:** The #1 silent correctness bug for multi-child households. If Pak Budi pays Yusuf's invoice thinking it's Aisha's, or reads Aisha's report thinking it's Yusuf's, trust is gone. This cross-cutting check is the regression canary for every portal page-state refactor.
- **Expected perf:** child switch click-to-new-data-visible <1s per page.
- **Error scenarios to verify:**
  - Child selector shows a child the parent isn't linked to (data bug) → either the child is hidden or tapping it 403s gracefully
  - Deep-link `/parent/invoices?child=<unauthorizedStudentId>` → backend 403, UI lands on "Tidak dapat membuka data anak ini" not a blank list
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Area: enrollment-form

> Public, token-gated page `/pendaftaran/[token]` (no login). Persona Pak Budi, Role: public token holder. Needs an `INVITED` enrollment application (admission inquiry → admin invite → form link).

### JTBD-PARENT-ENROL-01 — Sign the enrollment form when Ayah and Ibu are in two different places
- **Persona:** Pak Budi
- **Role:** public token holder (no login; the link is the credential)
- **Preconditions:** An `INVITED` application whose form link has been sent to Pak Budi; Bu Aisyah (Ibu) is at home on another phone and has the same link forwarded via WhatsApp. Ayah/Ibu names and the earlier steps are already filled.
- **Steps:**
  1. On his phone, open the form link and go to the Persetujuan step; tick the agreement and sign as Ayah.
  2. Realise Ibu must sign too and she is not next to him; work out how to get her to sign without losing his signature.
  3. Ibu opens the same link on her own phone, sees Ayah's signature is already there, signs as Ibu.
  4. Back on his phone, find out whether Ibu has signed (without reloading and losing his place), then continue to Tinjau and send the form. Either parent may be the one who submits.
- **Done when:** Each parent's signature shows "Tersimpan" the moment it is saved and survives closing the tab or opening the link elsewhere. When only one signature exists, the page says which one is missing and offers a way to share the link and a way to re-check. The second parent sees the first's signature on opening the link. Whoever finishes can submit, and the school receives both signatures.
- **Why this job matters:** Parents who live or work apart cannot always sign side by side. A lost signature means a re-do and a call to admissions; this was the 2026-10-06 report from the admissions desk.
- **Expected perf:** signature save click-to-"Tersimpan" <800ms on mobile 4G; "Periksa lagi" click-to-result <800ms.
- **Error scenarios to verify:**
  - "Periksa lagi" while the other parent has not signed yet → the page says so ("Belum ada tanda tangan baru"), not a silent no-op
  - Clipboard denied on "Salin link" → the link is shown in a field to copy by hand
- **Known friction (from last UAT):** <filled by /uat reports>

---

### JTBD-PARENT-ENROL-02 — Upload kelengkapan berkas from a phone and know what still has to be brought to school
- **Persona:** Pak Budi
- **Role:** public token holder (no login; the link is the credential)
- **Preconditions:** An `INVITED` application; a phone with a camera/gallery holding a large phone photo (4000×3000 JPEG, several MB) and a small PDF.
- **Steps:**
  1. Reach the Berkas step and decide whether it must be completed now or can be skipped.
  2. Upload the Kartu Keluarga from a photo and the akta kelahiran from a PDF.
  3. Notice a wrong upload and replace it; remove one that is not needed.
  4. Try a file that will be refused (over the size limit, or the wrong file type) and understand what to do next.
  5. At Tinjau and after sending, find the list of papers still to be brought to school.
- **Done when:** Each upload gives immediate visible feedback and ends with the file name shown with Ganti / Hapus. A large photo is made small enough automatically. A refused file gets an Indonesian message saying what is wrong and what to do. The step reads as optional; the form can be sent without every file; the missing list appears on Tinjau and on the success screen. Buttons are comfortable to hit with a thumb and nothing needs sideways scrolling at phone width.
- **Why this job matters:** Berkas is the most phone-hostile part of admission (big camera photos, 4G, shaky hands). If upload feels broken or mandatory, parents abandon the form and fall back to paper and WhatsApp.
- **Expected perf:** upload click-to-file-name-shown <3s for a compressed phone photo on mobile 4G; each upload API call <2s.
- **Error scenarios to verify:**
  - File over 4 MB that cannot be compressed (e.g. a large PDF) → "Ukuran berkas terlalu besar (maks. 4 MB)…"
  - A `.txt`/`.docx` renamed to `.jpg` → "Format tidak didukung…" in Indonesian
- **Known friction (from last UAT):** <filled by /uat reports>

---

### JTBD-PARENT-ENROL-03 — Pay the pendaftaran fee right after sending the form, or come back to it later
- **Persona:** Ibu Nur
- **Role:** public token holder (no login; the link is the credential)
- **Preconditions:** An `INVITED` application for a program with a pendaftaran fee (e.g. Rp300.000; Rp675.000 with the Day Care add-on); a phone; DOKU reachable.
- **Steps:**
  1. At Tinjau, read the "Biaya pendaftaran" block and see what will be charged and when.
  2. Send the form and read the thank-you card; find "Langkah terakhir: Bayar biaya pendaftaran".
  3. Tap "Bayar sekarang", land on the DOKU page, pay by Virtual Account (or stop and come back).
  4. Return to the school's page and see the payment status without doing anything technical.
  5. Later, open the same form link again and find the fee (still to pay, or paid).
- **Done when:** The amount at Tinjau, on the thank-you card, on DOKU and on the receipt are the same number, and a discount (if staff set one) is shown as normal fee, discount % and total. The pay button is one clear full-width action. Back from DOKU, the page says "Menunggu pembayaran" (with "Periksa lagi") until the payment is actually confirmed, then "Pembayaran diterima · Alhamdulillah" with amount and time in WIB. Reopening the form link shows the fee state instead of a dead end. Nothing needs sideways scrolling at phone width.
- **Why this job matters:** The fee is the first money a family hands the school. A payment step that is vague about the amount, or that says "paid" before it is, costs trust at the very first contact.
- **Expected perf:** form submit click-to-thank-you <2s; "Bayar sekarang" click-to-DOKU <3s; return page <2s.
- **Error scenarios to verify:**
  - DOKU cannot issue a link → "Tautan pembayaran belum bisa dibuat. Coba lagi sebentar." and the button stays usable.
  - Connection drops on tap → "Koneksi terputus. Coba lagi sebentar ya."
  - Back from DOKU after cancelling → "Pembayaran belum selesai", nothing charged, the button still works.
  - Paid by Virtual Account hours later → the return page or the form link shows paid once DOKU confirms.
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Appendix: jobs not yet seeded

These exist as ideas but are not shipped in code yet. Add them when a cycle builds the corresponding feature and update the "Last audited" date.

- School announcements / calendar
- Leave notifications / sakit reporting (parent-initiated — server-side flow not shipped; parent notes in JOURNAL-03 are the current workaround)
- Guardian self-service edit of contact/child info — write capability not yet shipped; `app/parent/profile/page.tsx` is read-only, JTBD-PARENT-PROFILE-01 only credits the read-only navigation job
