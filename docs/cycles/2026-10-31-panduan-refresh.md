# Panduan refresh — staff deck brought up to date (≤ 20 slides), and a separate deck for parents

## Context

The owner asked to update `/panduan` so it is current, covers every essential, and can be presented to teachers and
admins — bumping it to as many as 20 slides if needed — and to make a separate version that can be presented to
parents.

The staff deck shipped on 2026-10-09 ([cycle](2026-10-09-talib-deck.md)) as ten slides. Since then roughly thirty
product cycles landed on `staging`, several of which the deck now gets wrong or omits:

- Pendaftaran was rebuilt twice (#650, #651): short lead, one-tap Kirim Formulir, pay after submit, kode pos lookup.
- Finance gained a lot: payment-link expiry and fresh links (#666, #672, #678), WhatsApp reminders with an editable
  template (#672, #687), unrecorded gateway payments (#680), Sudah dibayar → retired in favour of *Catat pembayaran
  di muka* (#695, #704), SPP di muka (#695, #699), paket sekolah + daycare (#702), cuti siswa skipped by billing
  (#698), class ↔ program setup (#693).
- Dasbor Analitik (#681), Buku Penghubung "hari tanpa buku penghubung" and one-tick *lengkap* (#692), school admin
  can author Kurikulum (#691), student and wali detail pages (#675, #676), Google-only sessions (#683).
- The parent portal has no guide at all; the 2026-10-09 cycle listed a parent deck as a non-goal.

Constraints carried over: the deck is static copy and inline SVG (no DB read, no API), Indonesian, no vendor names
but DOKU, *Bu Guru* never *Ustadzah*, cutover modules labelled honestly.

## Decisions

1. **Staff deck grows to 19 slides**, one idea per slide, ordered as a school year runs: orientation → admin daily
   work → admissions → students → structure → the class day → curriculum → rapor → money (three slides) → HR → the
   parent portal (so staff can answer parents' questions) → access → first steps.
2. **Parent deck is a separate deck at `/panduan/orang-tua`**, 12 slides, parent register from `voice.md` (warmest;
   *Assalamu'alaikum*, *Ayah dan Bunda*, child-framed, gentle on money). Open to every signed-in role: admins present
   it at parent meetings from their own account, and a parent can reopen it from Profil. Still login-only, like
   `/panduan` — static copy, so nothing sensitive, but no reason to make it the first public page.
3. **One deck engine.** `Deck` takes a `title`; `who` chips are optional so a single-audience deck does not repeat
   "Orang tua" on every slide. No new dependency, no new React Bits.
4. **Entry points:** staff keep theirs; the parent portal's Profil gets a "Panduan Talib" link to the parent deck.
5. **Workflow deviation:** this session is pinned to branch `claude/intelligent-sagan-nf6qve` (from current
   `origin/staging`), so no `feat/*` worktree; draft PR into `staging`.

## Acceptance criteria

- [x] Every claim on both decks is true on `origin/staging` today, recorded in the claims register below.
- [x] Nothing retired is taught (Sudah dibayar, emailed-only invite, Kunjungan).
- [x] Staff deck ≤ 20 slides; parent deck separate, parent voice, no admin jargon.
- [x] `/panduan/orang-tua`: no session → `/`; every role renders it; "Kembali" goes to the viewer's home.
- [x] Both decks readable at 1440×900 and 390×844 with no clipping or sideways scroll.
- [x] Gates: lint, typecheck, Vitest, build, `audit-docs.sh`, Playwright `e2e/deck.spec.ts`.

## Verify flows

1. Admin opens Panduan Talib from the sidebar, pages through all slides with the keyboard.
2. Teacher opens it from Lainnya on a phone, swipes through.
3. Parent opens Profil → Panduan Talib, pages through the parent deck; opening `/panduan` still sends them home.
4. Admin opens `/panduan/orang-tua` full screen as if presenting.

## Tasks

Plan: the driver (Opus) wrote both decks' copy, the claims register and the final visual review. Fact-finding was
delegated: Sonnet built the admin fact sheet and Haiku the teacher and parent sheets. Sonnet drew the sixteen new
illustrations in four parallel batches against one shared brief, plus one redraw after review.

- [x] **T1 — Engine + routes.** `Deck` title prop, optional `who`, `app/panduan/orang-tua/page.tsx`, Profil link.
- [x] **T2 — Staff copy.** `components/deck/slides.tsx` rewritten to 19 slides from the verified fact sheets.
- [x] **T3 — Parent copy.** `components/deck/parent-slides.tsx`, 12 slides.
- [x] **T4 — Illustrations.** Sixteen new inline-SVG pieces, same kit; three existing pieces corrected.
- [x] **T5 — Tests, e2e, screenshots, docs.**

## Implementation

- **Engine.** `components/deck/deck.tsx` takes `title` (header and carousel label). In `types.ts`, `who` is optional and
  gained `ortu`; `slide-view.tsx` renders no chip row when `who` is absent.
- **Routes.** `app/panduan/orang-tua/page.tsx`: a session is required (proxy plus page check), and any role is allowed.
  "Kembali" goes to the viewer's own home. `/panduan` is unchanged, so parents are still sent to `/parent`.
- **Entry point.** `app/parent/profile/page.tsx` has a new *Bantuan* section with a "Panduan Talib" row linking to
  `/panduan/orang-tua`.
- **Staff deck (19).** In order: Sampul, Gambaran umum, Dasbor, Pendaftaran, Siswa dan wali, Akademik, Absensi, Buku
  Penghubung, Kurikulum, Penilaian, Rapor, Biaya, Tagihan, Pembayaran, Portal guru, Tim dan gaji, Portal orang tua,
  Akses, Langkah pertama. Kurikulum, Penilaian and Rapor carry the *Tahap peralihan 2026* badge.
- **Parent deck (12).** In order: Sampul, Isi portal, Masuk, Beranda, Kehadiran, Jurnal, Perkembangan, Rapor, Tagihan,
  Setelah membayar, Bantuan, Mendaftarkan adik. Parents are addressed as *Bapak dan Ibu* (voice.md: Bu/Pak, not
  Ayah/Bunda) and the child as *ananda*. The courtesy layer appears where it fits: *Assalamu'alaikum* on the cover and
  *Alhamdulillah* on payment.
- **New pieces.** `art/{dashboard,student,journal,assess,fees,payment,teacher-home,parent-home,sign-in,
  parent-attendance,parent-journal,growth,parent-invoice,pay-flow,contact,enroll-form}-art.tsx`, plus HTML
  `first-steps.tsx`, `parent-map.tsx` and `parent-cover-art.tsx`.
- **Corrected pieces.**
  - `spine-art` was relabelled Minggu → Pekan, and its scale legend now reads Perlu penguatan / Belum konsisten /
    Konsisten.
  - `team-art`: "Check-in dan check-out" → "Catat masuk dan pulang".
  - `day-art`: the button reads "Tandai 3 lainnya Hadir", following the real "Tandai N siswa lainnya Hadir".
  - `access-matrix`: admins write Kurikulum (#691); Penilaian is split from it.
  - `module-map`: one line.
- **Fixed on the old deck.** Four claims were wrong:
  - "Pemilik menyusun" kurikulum: the school admin can author it since #691.
  - Rapor "terisi otomatis": only the level suggestion is computed; narration comes from *Pakai narasi*.
  - "Antrean pekerjaan" was described as a menu. It opens from the Dasbor's *Lihat semua*.
  - The Keuangan slide left out everything shipped since 10-09.

### Claims register (new or changed claims; unchanged ones keep the [2026-10-09 register](2026-10-09-talib-deck.md))

| Slide | Claim | Reference |
|---|---|---|
| Dasbor | "Perlu ditangani" heading; five queue kinds; finance tiles; Analitik cards (30-day attendance, Kelas perlu perhatian, journal completeness, tagihan vs terkumpul) | `app/admin/page.tsx`, `lib/dashboard/queue-sources.ts`, `components/admin/dashboard/{urgent-list,finance-tiles}.tsx`, `components/admin/dashboard/analytics/*` |
| Pendaftaran | Kirim Formulir via WhatsApp, email or on screen; seven steps; kode pos lookup; pay after submit; Tandai sudah bayar; Terima & Jadikan Siswa | `components/admin/admissions/{row-actions,send-formulir-dialog}.tsx`, `lib/enrollment/steps.ts`, `app/api/enrollments/token/[token]/wilayah/route.ts`, `components/admin/enrollment-fee-card.tsx`, `app/admin/enrollments/[id]/page.tsx` |
| Siswa | Five groups; rail tiles; cuti per month not billed; wali page actions | `components/admin/students/detail/{sections,cuti-section}.ts(x)`, `components/admin/billing-run-wizard/step-2-review.tsx`, `app/admin/guardians/[id]/page.tsx` |
| Akademik | Salin Kelas; program editable with SPP preview until invoiced; Ubah Guru Sesi; Naik Kelas Massal | `app/admin/academic-years/page.tsx`, `components/admin/classes/{program-change-impact,bulk-promote-dialog}.tsx`, `components/admin/classes/detail/swap-session-dialog.tsx` |
| Absensi | H/S/I/A; "Tandai N siswa lainnya Hadir" fills only unmarked; Timpa Kehadiran; Ekspor CSV | `app/teacher/class-attendance/page.tsx`, `app/admin/student-attendance/page.tsx` |
| Buku Penghubung | Isi cepat satu kelas skips absent; one tick = lengkap; hari tanpa buku penghubung shown to parents and counted done; replies on teacher Beranda | `app/teacher/student-journal/entry/page.tsx`, `lib/teacher/home-progress.ts`, `components/student-journal/day-mark-dialog.tsx`, `app/teacher/home-client.tsx` |
| Kurikulum | Admin authors and imports PROMES (.xlsx, preview); teachers read | `lib/permissions.ts` (`curriculum.write` for SCHOOL_ADMIN), `app/admin/semesters/[id]/import/client.tsx` |
| Penilaian | Three levels; walas pekanan, sentra harian; admin monitors and voids | `prisma/schema.prisma` (`AchievementLevel`), `lib/curriculum/level-presentation.ts`, `app/teacher/assessments/{weekly,center}`, `app/admin/assessments/page.tsx`, `lib/permissions.ts` (`assessments.void`) |
| Rapor | "Saran" level computed; Pakai narasi from Bank Narasi; Simpan & Terbitkan; Tarik penerbitan; Unduh PDF | `app/admin/report-cards/raport-editor.tsx`, `app/admin/report-cards/templates/page.tsx` |
| Biaya | Komponen Biaya, Tarif per Program, Keringanan Siswa; one bundle price for school + daycare | `app/admin/fees/page.tsx`, `components/admin/fees/bundle-fees-section.tsx` |
| Tagihan | Cakupan/Tinjau/Komit; leave rows skipped; draft kept; Tagihan Manual; Catat pembayaran di muka → Lunas, no link | `components/admin/billing-run-wizard/*`, `app/admin/invoices/invoices-client.tsx`, `components/admin/invoices/spp-prepay-dialog.tsx` |
| Pembayaran | Status checked on return; Link berlaku column; Buat link baru single and bulk; Pengingat WhatsApp with editable template; Perlu dicek; kuitansi; void with reason | `app/admin/invoices/invoices-client.tsx`, `app/admin/invoices/[id]/page.tsx`, `components/admin/invoices/{reminder-queue-dialog,payment-problems-alert}.tsx`, `app/admin/settings/pengingat-whatsapp` |
| Portal guru | Five tabs; Catat masuk with lateness; Yang perlu diselesaikan; Lainnya items | `components/teacher/{bottom-nav,more-sheet}.tsx`, `app/teacher/home-client.tsx` |
| Portal orang tua / parent deck | Google-only, invited email must match a Parent row; five tabs + Lainnya (Perkembangan, Rapor, Profil); household view, Lunas semua; attendance week grid with week navigator; Di sekolah / Di rumah / Catatan, own notes editable; three levels and "bukan nilai"; rapor PDF; filters, Bayar sekarang in new tab, Cara bayar VA text; check on return, Muat ulang status, Minta link baru, Kuitansi; Hubungi sekolah; formulir draft resumes, kode pos lookup, second-parent signature link, pay after submit | `app/page.tsx`, `lib/auth.ts`, `components/parent/{bottom-nav,more-sheet}.tsx`, `app/parent/{page,attendance/page,student-journal/page,perkembangan,reports/page}.tsx`, `app/parent/invoices/*` (`invoice-detail-sheet.tsx`), `app/api/guardian/invoices/[id]/{payment-link,pdf}`, `app/parent/profile/page.tsx`, `app/pendaftaran/[token]/{client,payment-panel}.tsx`, `app/manifest.ts` |
| Akses | Rows as drawn | `lib/permissions.ts` default sets |

## Verification

- Visual reference: `.claude/standards/design-system.html` (brand tokens, portal voice). Both decks reuse the existing
  deck kit, so there are no new tokens and no raw hex under `components/deck`.
- **Gates.**
  - `npx tsc --noEmit` clean.
  - `npx eslint components/deck app/panduan app/parent/profile e2e/deck.spec.ts` clean.
  - Full `npx vitest run`: 735 files passed, 2 skipped; 9046 tests passed.
  - `DEMO_MODE=true npm run build` OK.
  - `bash scripts/audit-docs.sh`: ok after `--write`. The only warning is the pre-existing ADR 60-day window.
- **Playwright, local.** `e2e/deck.spec.ts` passed 9/9 against a production `DEMO_MODE` build on a disposable local
  Postgres 16 (port 54329, schema push and seed). Docker was unavailable, so this was a local cluster, stopped and
  deleted afterwards. The preinstalled Chromium was supplied via a throwaway config overriding `executablePath`; the
  repo's pinned headless shell is not in this container. The spec covers:
  - Admin keyboard through all 19 slides.
  - Deep link and rail.
  - Teacher on a phone.
  - Touch swipe.
  - Parent from Profil through all 12 slides, then Kembali.
  - Admin presenting the parent deck.
  - Signed-out and parent redirects.
- **Visual loop.** Every slide of both decks was captured at 1440×900 and 390×844 with reduced motion, with no sideways
  overflow on any slide. I reviewed all of them. Fixed after review:
  - The Kurikulum spine still said *Minggu* and *Berkembang*.
  - The SDM card said *Check-in*.
  - The payment card promised a fixed "3 hari" link life. Expiry follows the due date, so it now says *Ada masa
    berlaku*.
  - The parent Kehadiran slide claimed a monthly calendar. The page is a week grid with a week navigator, so the art
    was redrawn and the copy corrected.
- Console on the decks shows only the Vercel insights script 404, which exists only on Vercel.

## Ship Notes

- **Out of scope, flagged.** Live parent copy still says *Ustadzah*, against voice.md:
  - `app/parent/attendance/page.tsx`
  - `app/parent/student-journal/page.tsx`
  - `app/parent/report-cards-list.tsx`
  - `components/student-journal/note-{compose-dialog,thread}.tsx`

  `docs/uat/jobs/parent.md` JTBD-PARENT-INV-01 still names the old gateway. Both are worth a small follow-up cycle.
- Not auth-impacting: no change to sign-in, session, cookie or guards beyond a new page that reuses `getSession`, so
  no `needs-staging-verify`. It touches user flows, so the PR carries `e2e`.
