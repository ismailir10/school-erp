# Student detail page: answer first, five groups (2026-10-19)

## Context

Cycle B of two (cycle A, the wali page, shipped as #675). The user's request: "improve student and parent detail page, applying don't-make-me-think principles while making sure admin can do their key task and flexibility". The proposal and the clickable mockup (Claude canvas "Student & Wali detail mockup", Siswa desktop and mobile) were approved with "proceed". This cycle applies the same design to `/admin/students/[id]` and reuses the pieces cycle A shipped: `AttentionStrip`, `ContactActions`, `DossierSection` collapsed `summary`.

Facts from reading the page, its sections and its tests (2,659 lines of tests across six files):

- **Thirteen places to look.** The dossier has 13 sections and a 13-chip nav, plus a rail with 7 number tiles and 4 cards. "Berkas" appears three times (tile, rail checklist, Dokumen section). Usia, Kelas Aktif and Wali Aktif repeat what the header and the family section already say.
- **Nothing says what to do next.** An owed amount, a missing KK, a child with no class, no wali utama and a draft raport each live in a different tile or section; the admin scans to find the problem.
- **Contact is missing on a phone.** The "Kontak Cepat" card is part of the desktop-only rail; on mobile the page has no call or WhatsApp button for the family.
- **"Edit" is ambiguous.** The header button edits only the Data Anak section; Kesehatan and Informasi Tambahan have their own edit controls, and the edit form sits several screens below the button that starts it.
- **Header actions are not about the child's state.** "Daftarkan ke Kelas" is shown to every active student, placed or not; the one action an admin most needs depends on whether the child has a class.
- **Three words for one number.** The student page says "Tunggakan", the wali page rail says "Piutang" (the invoice list's school-wide KPI word) and the strip says "belum dibayar".
- UAT 2026-09-29 (possibly stale: later cycles touched these files) flagged on this page: Luluskan offered without an enrolment and Daftarkan ke Kelas shown for a withdrawn student (CORE-13), no warning when the primary wali is deactivated (CORE-4). Both are already handled by guards on the page; this cycle must not regress them.

## Decisions

Approved with the proposal (all recommended options):

1. **Structure:** grouped single scroll (Recipe 2b). Five groups: Profil, Keluarga & Berkas, Kelas & Akademik, Keuangan, Pendaftaran & Catatan. No tabs. All 13 existing sections stay reachable and keep their anchor ids and deep links (`#keuangan`, `#pendaftaran`, `#akademik`, `?aksi=daftarkan-kelas`).
2. **Answer first:** a "Perlu perhatian" strip under the header (only when something needs action, one button per row) and a family contact strip (WhatsApp / Telepon, the wali utama) in the first screen on every viewport.
3. **Collapsed means summarised:** every group shows a one-line summary while collapsed.
4. **Edit where you read:** the header keeps one action that depends on the child's state; "Edit" moves into the Data Anak section next to the data it edits.
5. **Slim rail:** only numbers the header does not already say.

Made while building:

- **Groups hold the old sections.** The 13 sections become sub-sections inside the five groups. Eager sub-sections (their data is already loaded) render as plain headed blocks; the five lazy ones (Kehadiran, Keringanan, Buku Penghubung, Akademik, Pendaftaran) stay collapsible rows that fetch only when first opened, exactly as before.
- **Header action by state.** Active and no class: **Daftarkan ke Kelas** (filled). Withdrawn or graduated: **Aktifkan kembali**. Active and placed: no visible button; Daftarkan ke Kelas (to add a day-care or second placement), Naik Kelas, Luluskan and Keluarkan live in the ⋯ menu with the same guards as today.
- **Ringkasan card goes.** Its facts move to where they belong: Status and class are in the header; NIS in Data Anak; Kelas, Tahun ajaran, Kampus and Masuk sejak in a "Kelas saat ini" block at the top of Kelas & Akademik; Jejak (dibuat / asal data) stays in the rail.
- **Terminology.** "Tunggakan" is what a family owes (student and wali pages). "Piutang" stays the school-wide receivable on the invoice list. The wali rail tile is renamed from Piutang to Tunggakan, and `voice.md` gets a glossary row.
- Work happens on the harness-assigned branch `claude/serene-ptolemy-rsgsk1`, restarted from the latest `staging` after #675 merged.

## Acceptance criteria

- [ ] The page shows five groups in the nav, in this order: Profil, Keluarga & Berkas, Kelas & Akademik, Keuangan, Pendaftaran & Catatan. Every one of the old 13 sections is still on the page and its anchor id still expands what contains it and scrolls to it (including from the URL hash and from `?aksi=daftarkan-kelas`).
- [ ] Profil, Keluarga & Berkas and Keuangan start open on desktop; Kelas & Akademik and Pendaftaran & Catatan start closed; on a phone only Profil starts open. A closed group shows its one-line summary; an open one does not.
- [ ] "Perlu perhatian" lists, only when they apply and in this order: money owed (amount, how many tagihan, how many overdue), no class (active student only), no wali utama / no wali, missing berkas (names them), raport still draft. It is absent when nothing applies. Each row's button does the thing (opens Daftarkan ke Kelas, or expands and scrolls to the right section).
- [ ] The family strip shows the wali utama (or first active wali) with relationship and number and the WhatsApp / Telepon buttons, on desktop and on a phone (≥ 44 px); "N wali · Lihat semua" jumps to Keluarga & Wali. With no usable number no dead button shows.
- [ ] The header shows one visible action chosen by the child's state (see Decisions); Naik Kelas, Luluskan, Keluarkan keep their guards and confirm dialogs; a withdrawn or graduated student still gets Aktifkan kembali and no Daftarkan ke Kelas.
- [ ] "Edit" sits in the Data Anak section header; edit, save, cancel and the unsaved-changes guard behave as before (including the "Simpan informasi tambahan dulu" guard).
- [ ] The rail has only Tunggakan, Hadir bulan ini and Raport tiles plus Jejak; no Usia, Kelas Aktif, Wali Aktif or Berkas tile, no Ringkasan, Kontak Cepat or Kelengkapan Berkas card, and no rail block above the sections on a phone.
- [ ] Kelas & Akademik opens with "Kelas saat ini" (kelas, tahun ajaran, kampus, masuk sejak) or "Belum terdaftar di kelas".
- [ ] The wali page rail says Tunggakan, not Piutang; `voice.md` records the three terms.
- [ ] Vitest, lint and the build are green; the existing student-page e2e specs pass (updated where a label or location moved on purpose).

## Verify flows

1. **Triage a child, desktop.** `u_super_admin`, a student with an owed invoice, a missing KK and a draft raport: the strip lists all three with working buttons, the family strip has WhatsApp / Telepon, groups show summaries. Edge: a student with nothing wrong shows no strip. Error: a student whose wali has no number shows no contact buttons and no dead link.
2. **Phone, 390×844.** Same student: header, strip and family contact are in the first screen, buttons ≥ 44 px, only Profil open, summaries on the other groups; opening Keuangan loads nothing extra; opening Kehadiran fetches once.
3. **State-driven header.** A placed active student shows no header button but the ⋯ menu; an unplaced one shows Daftarkan ke Kelas filled and the strip row; a withdrawn one shows Aktifkan kembali; Daftarkan ke Kelas (`?aksi=daftarkan-kelas`) still opens the dialog.
4. **Edit in place.** Edit in Data Anak → change nickname → Simpan: persists. With unsaved Informasi Tambahan rows, Edit is refused with the existing toast.

## UX notes

Primary action per screen: the family WhatsApp button and the strip's buttons; the header carries at most one visible action. Labels: "Perlu perhatian", "Lihat tagihan", "Daftarkan ke Kelas", "Lengkapi berkas", "Buka raport", "Kelas saat ini", "Edit". Summaries use "·" separators. Empty and loading states keep "Memuat…" vs "—" (never a bare 0 while a request is pending). Voice follows `voice.md`; the design-system tokens (status tints, `font-currency`, 44 px touch floor) are the same as cycle A.

## Test seams

- Vitest (jsdom): `DossierGroup` / `DossierSubsection`; pure helpers for the attention items and group summaries; the student page (strip, family strip, header by state, grouping, jump to a section inside a closed group, lazy latches, edit in Data Anak); the six existing student-page suites updated for the new structure.
- Playwright: `e2e/admin-students-full-crud.spec.ts` and `mobile-layout` updated where needed; one new spec for the strip, family contact and a deep link into a closed group.

## Non-goals

The wali page (done in A); tabs; the students list; the parent portal; lifecycle rules (promote, graduate, withdraw, reactivate) and their dialogs; any API, schema or permission change; Kesehatan, Informasi Tambahan, Keluarga & Wali and Dokumen internals beyond where they sit; moving the reminder to the student page.

## Assumptions

1. The data the strip needs is already on the page (student, invoices, overview aggregate); no new request is added.
2. Keeping each lazy section's own collapse preserves the "fetch only when opened" cost model.
3. Existing labels stay unless named above; tests that encode the old location of Edit or the old rail are updated, not removed.

## Gate re-openers

None expected: no schema, no new dependency, no API change. No auth or PII change (the page shows the same data; contact buttons reuse numbers already on the page).

## Tasks

- [x] T1 Shared groups: `DossierGroup` (card + collapsible group with summary while closed) and `DossierSubsection` (flat headed block, optionally collapsible with `keepMounted`) — accept: component tests (deps: none, reuse: `DossierSection`)
- [x] T2 Student page grouping: five groups holding the 13 sections as sub-sections, group nav, summaries, default open state, "Kelas saat ini" block, jump/hash/aksi handling that opens the right group then the right sub-section and fires the lazy latches — accept: deep links work, lazy fetch only on open (deps: T1)
- [x] T3 Header by state and Edit in Data Anak — accept: header per state, Edit relocated, guards intact (deps: T2)
- [ ] T4 "Perlu perhatian" strip, family contact strip, slim rail and no rail block on a phone — accept: strip items and contact per criteria (deps: T2, reuse: `AttentionStrip`, `ContactActions`)
- [ ] T5 Terminology and docs: wali rail Piutang → Tunggakan, `voice.md` glossary row, admin JTBD (STUDENT jobs), README clause if needed, e2e updates, counts via `audit-docs.sh --write` (deps: T2–T4)

## Implementation

- Plan: T1-T4 built sequentially by one worker subagent (claude-sonnet-5-5) on the driver's instruction, one commit per task (T2 edits the student page, T3 and T4 edit it again, so no safe parallel slice); the driver reviews and runs the full gates. Driver tier is recorded by the driver.
- T1: `components/admin/dossier-section.tsx`, `components/admin/__tests__/dossier-group.test.tsx` — `DossierGroup` (card, h2, summary only while closed, `keepMounted`, divided body) and `DossierSubsection` (flat headed block unless `onOpenChange` is given, then a collapsible row with a 44px trigger, h3, `keepMounted`); both keep their anchor id and `scroll-mt-28`. The collapsible header markup is now one internal `DisclosureTrigger` shared with `DossierSection`, whose behaviour is unchanged (existing summary suite passes). design-system tokens only (`px-card`, `text-small`, `text-muted-foreground`, 44px floor).
- T2: `app/admin/students/[id]/page.tsx`, `components/admin/students/detail/{sections.ts,group-summaries.ts,kelas-saat-ini.tsx}` (+ unit tests), the eight section components, `app/admin/students/[id]/__tests__/{groups,groups-mobile}.test.tsx` + `student-fixture.ts` — five `DossierGroup`s (`group-profil|keluarga|kelas|keuangan|catatan`) hold the thirteen concerns as `DossierSubsection`s under their old anchor ids; eager ones are flat blocks (their open props are gone), the five lazy ones (Kehadiran, Akademik, Keringanan, Formulir Pendaftaran, Buku Penghubung) stay collapsible rows with `keepMounted` and their latch. Groups holding a lazy row (`kelas`, `keuangan`, `catatan`) keep children mounted. `sections.ts` owns the id to group table, `isKnownTarget` and the desktop/mobile defaults (Profil, Keluarga & Berkas, Keuangan open; phone: Profil only). `jumpToSection` (nav, hash) opens the group, then the lazy row (firing its latch), then scrolls; the hash handler asks `isKnownTarget` (state) instead of the DOM because a closed group's body is not mounted. `group-summaries.ts` builds the five closed-state one-liners (omitting overview-backed parts until the overview lands; "Memuat…" / "—" for Keuangan). New "Kelas saat ini" block replaces the Ringkasan placement facts; the rail is untouched until T4. Old suites updated deliberately (open the group before a lazy row; scope header-subtitle queries now that class names also appear in "Kelas saat ini"; "Belum terdaftar di kelas" is checked per block); no test was removed or skipped. design-system tokens only (`DossierGroup`/`DossierSubsection`, `px-card`, `text-small`, no new colours).
- T3: `app/admin/students/[id]/page.tsx`, `components/admin/students/detail/data-anak-section.tsx`, `app/admin/students/[id]/__tests__/header-by-state.test.tsx` (+ updated `core-guards`, `lifecycle-and-forms`, `guardian-set-primary`) — header action follows the child's state: ACTIVE and unplaced shows a filled "Daftarkan ke Kelas" (the only visible button), WITHDRAWN/GRADUATED shows "Aktifkan kembali", ACTIVE and placed shows none; the ⋯ menu for ACTIVE is Daftarkan ke Kelas (placed only, to add a second placement), Naik Kelas, Luluskan, Keluarkan last, with the same guards as before. "Placed" is the page's own test (a current, non-archived class: `activeEnrollment`), not `hasActiveEnrollment`, so a child whose only ACTIVE row sits in an archived year reads "Belum terdaftar di kelas" and gets the filled button; Luluskan still uses the server's looser any-ACTIVE-row rule. The header "Edit" is gone: Data Anak's `actions` hold "Edit" (accessible name "Edit data anak": Kesehatan and Riwayat Status carry their own "Ubah"), beside Batal / Simpan Perubahan; focus moves into the first field when editing starts and back to Edit when it ends; the "Simpan informasi tambahan dulu" refusal is unchanged and now tested. No e2e spec clicked the header Edit or Daftarkan (grep of `e2e/`).

## Verification

## Ship Notes
