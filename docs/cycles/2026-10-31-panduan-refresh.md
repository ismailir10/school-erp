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

- [ ] Every claim on both decks is true on `origin/staging` today, recorded in the claims register below.
- [ ] Nothing retired is taught (Sudah dibayar, emailed-only invite, Kunjungan).
- [ ] Staff deck ≤ 20 slides; parent deck separate, parent voice, no admin jargon.
- [ ] `/panduan/orang-tua`: no session → `/`; every role renders it; "Kembali" goes to the viewer's home.
- [ ] Both decks readable at 1440×900 and 390×844 with no clipping or sideways scroll.
- [ ] Gates: lint, typecheck, Vitest, build, `audit-docs.sh`, Playwright `e2e/deck.spec.ts`.

## Verify flows

1. Admin opens Panduan Talib from the sidebar, pages through all slides with the keyboard.
2. Teacher opens it from Lainnya on a phone, swipes through.
3. Parent opens Profil → Panduan Talib, pages through the parent deck; opening `/panduan` still sends them home.
4. Admin opens `/panduan/orang-tua` full screen as if presenting.

## Tasks

- [ ] **T1 — Engine + routes.** `Deck` title prop, optional `who`, `app/panduan/orang-tua/page.tsx`, Profil link.
- [ ] **T2 — Staff copy.** `components/deck/slides.tsx` rewritten to 19 slides from the verified fact sheets.
- [ ] **T3 — Parent copy.** `components/deck/parent-slides.tsx`.
- [ ] **T4 — Illustrations.** New inline-SVG art for the new slides, same kit.
- [ ] **T5 — Tests, e2e, screenshots, docs.**

## Implementation

## Verification

- Visual reference: `.claude/standards/design-system.html` (brand tokens, portal voice); both decks reuse the existing deck kit, so no new tokens.

## Ship Notes
