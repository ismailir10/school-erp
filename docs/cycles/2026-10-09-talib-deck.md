# Talib deck — a login-only, ten-slide tour of the platform for admins and teachers

## Context

Admins and teachers use the slice of Talib that is theirs, but nobody has a picture of the whole: how an enquiry becomes a student, how a student's day feeds a report card, how a class turns into an invoice, who sees what. The owner wants a short deck (≤ 10 slides) that explains Talib at a high level across its modules, for those two audiences only. It must sit behind sign-in, look considered rather than template-made (real illustrations, restrained motion, React Bits where it earns its place), and be verified in a browser and iterated until the owner is proud of it. The deck is part of the product, not a file in a shared drive: it lives in-app so the sign-in gate, the Indonesian voice and the brand tokens come for free, and so it can be kept true as the modules change.

Constraints from existing decisions, read before specifying:
- **Auth is already a wall.** `proxy.ts` redirects any non-public path to `/` without a session (Supabase in prod, demo cookie in demo mode). A new top-level route is gated by default; the page adds a role check on top because parents also have sessions.
- **No vendor names in user-facing copy.** The 2026-10-09 cycle made `/legal/privacy` vendor-neutral at the owner's request; the deck follows (DOKU is the one named payment party, as in the Terms).
- **React Bits is already vendored as local, dependency-free ports** in `components/reactbits/` (`aurora`, `blur-text`, `count-up`, `spotlight`, `stagger`, `draw-check`, `step-transition`), reduced-motion safe. The deck reuses these; no new dependency.
- **Cutover honesty.** `curriculum` and `reportCard` are mid-cutover (README). The deck says so on those slides instead of presenting them as finished.
- **Voice.** Indonesian, sentence case, staff register (voice.md): no performative Arabic in an admin/ops context; *Ustadzah/Ustadz* only where a teacher is addressed.

## Spec

**Access**
- [ ] `/panduan` is reachable only when signed in as `SUPER_ADMIN`, `SCHOOL_ADMIN` or `TEACHER`. No session → `/` (proxy, unchanged). `GUARDIAN` → `/parent` (page guard, via `homePathForRole`). The check lives in a server component, so slide content is never in the HTML sent to a signed-out or parent request.
- [ ] Deck content and illustrations are code (React + inline SVG) under `app/panduan/` / `components/deck/`, not files under `public/`, so nothing in it is fetchable unauthenticated. The only images are the existing `public/school/*` photos, already public.
- [ ] No API route, no DB read: the deck is static copy. (Role guard still reads the session.)

**Deck**
- [ ] Exactly **10 slides**, in this order. Each carries a small "who uses this" chip (Admin · Guru) so each audience sees where they sit:
  1. **Cover** — Talib, *seeker of knowledge*; one line of purpose; three real facts from the README (2 kampus, 40+ guru, 500+ siswa) with count-up. Aurora backdrop, blur-in headline.
  2. **Satu sekolah, tiga pintu** — hub diagram: Admin, Guru, Orang tua portals around one shared record; the nine modules as the spine. Orientation slide.
  3. **Dari pendaftar jadi siswa** — Kesiswaan: `/daftar` enquiry → emailed token → seven-step form (documents, consent, signature) → admin converts → student, wali, enrollment. Journey illustration.
  4. **Struktur sekolah** — Akademik: tahun ajaran → semester → program → kelas → penugasan guru; roll-forward, substitute swap, promotion. Nested/stacked structure illustration.
  5. **Hari di kelas** — Kehadiran (exception-first: mark the few S/I/A, one tap Hadir for the rest) and Buku Penghubung (school ↔ home, unread markers). A phone mock-up illustration drawn in SVG, not a screenshot.
  6. **Kurikulum dan penilaian** — the PROMES spine (semester → tema → subtema → minggu; tujuan → indikator), weekly walas and daily sentra assessment, admin monitor. Marked *tahap peralihan 2026*.
  7. **Rapor** — Triwulan report cards drafted from penilaian, admin override, publish, PDF, parent reads; Bank Narasi. Marked *tahap peralihan 2026*. Paper-stack illustration.
  8. **Tagihan dan pembayaran** — Keuangan: biaya → Billing Run (three steps) → tagihan → pembayaran via DOKU or manual with review → kuitansi; keringanan. Flow illustration with the invoice status path.
  9. **Tim dan gaji** — SDM: karyawan, kehadiran karyawan, cuti, penggajian, slip gaji (teacher sees only their own). Salary gated to the owner role.
  10. **Akses dan langkah pertama** — who sees what (peran & izin, invitation-only Google sign-in, audit trail), then role-specific "mulai dari sini" starters: admin → Dasbor and Antrean pekerjaan; guru → Beranda and Absensi. Closing photo from `public/school/`.
- [ ] Every claim is verified against the code at build time (route, permission or schema exists and is live), not copied from the README on trust. Anything that is not live is dropped or labelled.
- [ ] Copy is Indonesian, sentence case, ≤ ~35 words of body per slide; one idea per slide, a short headline that states the point, no filler adjectives.

**Illustration and motion**
- [ ] One hand-built inline-SVG illustration per slide (slides 1 and 10 may use the Aurora and a school photo instead), drawn in brand tokens only (`--primary`, `--primary-text`, `--secondary`, `--celebration-gold`, neutrals), consistent stroke weight and corner radius, `aria-hidden` with the meaning carried by adjacent text. No clip-art, no gradient blobs standing in for content, no emoji.
- [ ] React Bits used only where it carries meaning: Aurora (cover), BlurText (slide headlines), CountUp (cover facts), Spotlight on the module cards (slide 2), Stagger for step reveals on flow slides. Motion is opacity/transform only, off under `prefers-reduced-motion`.

**Presenting**
- [ ] Keyboard: ← → / PageUp PageDown / Space move; Home End jump; `F` toggles fullscreen; Esc exits. Pointer: prev/next buttons, a progress rail with ten dots (each a labelled button), swipe on touch.
- [ ] Slide is addressable by hash (`/panduan#5`), updated as you move, restored on load.
- [ ] Works at 1440×900 (presentation) and 390×844 (a teacher on a phone): on small screens a slide's content stacks and scrolls inside the slide, the controls stay reachable, nothing clips or scrolls the page sideways.
- [ ] Accessible: slides are a labelled region (`aria-roledescription="carousel"` / `slide`, "Slide n dari 10"), a polite live region announces the slide title, focus is not trapped, visible focus rings, controls ≥ 44px on touch, text contrast AA over Aurora (same worst-case maths as the sign-in panel).
- [ ] Entry points: a "Panduan Talib" link in the admin sidebar footer and in the teacher "Lainnya" sheet. No parent-portal entry.

**Verification (non-negotiable for "proud")**
- [ ] Vitest (jsdom): renders 10 slides in order with titles; next/prev/keys/hash behave; reduced-motion renders static; role guard redirects (no session → `/`, `GUARDIAN` → `/parent`, admin/teacher render) — test shape follows the existing layout guard tests.
- [ ] Playwright (demo auth): admin and teacher can open `/panduan` and page through all ten; parent is redirected; signed-out is redirected to `/`.
- [ ] I screenshot all ten slides at 1440×900 and 390×844 myself and review them, then iterate on what looks off (alignment, density, overflow, contrast) until none of it needs a note. Final screenshots are kept in the PR description, not in the repo.
- [ ] `npm run build && npx vitest run`, lint, typecheck, `bash scripts/audit-docs.sh` all green.

**Non-goals**
- Parent-facing deck, a public/marketing version, PDF/PPTX export, speaker notes, editing slides in the UI, i18n/English.
- A new dependency, a DB table, an API route, any change to existing module behaviour.
- Rewriting the README's module descriptions (the deck links to nothing; it is a summary, not a source of truth — the README stays the owner of module facts).
- Per-user analytics on who viewed the deck.

**Assumptions I'm making — correct me now**
1. **Route name `/panduan`** (Indonesian for "guide"), not `/deck`; the audience reads Indonesian. Say if you prefer another path.
2. **Indonesian only**, written in the staff register of voice.md. English copy is a non-goal.
3. **In-app React page, not a Google Slides / PPTX / hosted artifact.** That is what makes "login only" and "React Bits" literal, and keeps the deck in the repo where it can be reviewed and updated with the modules. The cost: editing a slide means a code change, not opening a slide editor.
4. **Admin and teacher see the same deck.** One deck, with the "who uses this" chips doing the tailoring, rather than two decks. Per-role content filtering is a possible later cycle.
5. **Cutover modules are labelled as in transition.** Slides 6–7 say so plainly; if you would rather not show them yet, they become one slide ("Penilaian dan rapor") and I add an eleventh-slide's worth of room elsewhere.
6. **No vendor names** except DOKU, matching the privacy-page decision from earlier today.
7. **The cover's numbers (2 kampus, 40+ guru, 500+ siswa) are taken from the README** and are static. I'd rather not query live counts: the deck must not touch the DB, and a stale "500+" is honest where a wrong exact figure is not.
8. **Two existing school photos** (`guru.webp`, `area-bermain.webp`) may appear on the cover/closing slide; they were already chosen so that no child's face is the subject. No new photos.
9. **Local verification uses demo auth + disposable local Postgres** (CLAUDE.md route). Because the change adds a route behind the existing proxy and a server-side role check, it is **not** auth-impacting by the manual's definition (no change to Google login, callback, session, cookie, guard logic or dependencies), so no `needs-staging-verify` label — unless my diff turns out otherwise at ship time.
10. **Workflow deviation:** this session is pinned to branch `claude/eager-euler-k3meq3` (cut from current `origin/staging`), so I work on it directly instead of a `feat/*` worktree and open the draft PR from it into `staging`.

## Tasks

Dependencies noted; T1 blocks T3–T5, T2 is independent, T3–T5 are independent of one another once T1 lands (one subagent each), T6 follows them.

- [ ] **T1 — Deck shell.** `app/panduan/{page,layout,loading}.tsx`, `components/deck/{deck,slide,controls,progress}.tsx`, hash sync, keyboard/swipe/fullscreen, live region. *Accept:* with three placeholder slides, all navigation inputs work, hash restores, no console errors; page 404s nowhere and redirects per the access rules. Reuse `getSession`/`homePathForRole` from `lib/auth`, `usePrefersReducedMotion` from `components/reactbits`.
- [ ] **T2 — Access + entry points.** Role guard in `app/panduan/page.tsx` (server), sidebar-footer link in `components/admin/sidebar.tsx`, teacher link in `components/teacher/more-sheet.tsx`; update the affected tests. *Accept:* guard tests for no session / `GUARDIAN` / admin / teacher pass; existing sidebar and more-sheet tests updated, not weakened. Independent of T1 at the file level.
- [ ] **T3 — Illustration kit.** `components/deck/art/*`: shared stroke/radius/colour constants and the ten illustrations (cover and closing may be photo + Aurora composition). *Accept:* each renders at 320–900px wide without clipping, `aria-hidden`, brand tokens only (`grep` for raw `#hex` in `components/deck/art` is empty); a visual review at both viewports finds nothing to fix. After T1.
- [ ] **T4 — Content, claims verified.** `components/deck/slides.ts(x)`: the ten slides' copy, each claim checked against a route/permission/schema reference recorded in the Implementation section. *Accept:* every claim has a code reference; cutover slides labelled; no vendor names (`grep -iE 'supabase|vercel|resend|cloudflare|xendit'` empty); sentence-case check by eye against voice.md. After T1.
- [ ] **T5 — React Bits placements.** Aurora/BlurText/CountUp on the cover, Spotlight on slide 2 cards, Stagger on flow slides; reduced-motion verified. *Accept:* with `prefers-reduced-motion: reduce` nothing animates; with motion on, nothing animates layout properties. After T1.
- [ ] **T6 — Tests, screenshots, iteration.** Vitest suites and the Playwright spec (`e2e/deck.spec.ts`, added to the lean cross-module list only if it stays under ~20s); script that captures all ten slides at 1440×900 and 390×844; review loop. *Accept:* gates green; I have reviewed every screenshot and fixed what I would not show the owner; record the loop in Verification (`design-system` reference included for the frontend gate).
- [ ] **T7 — Docs.** README Portals/Modules note for `/panduan` (and the file-count block via `bash scripts/audit-docs.sh --write`), this doc's Verification and Ship Notes. *Accept:* `bash scripts/audit-docs.sh` exits 0.

## Implementation

## Verification

## Ship Notes
