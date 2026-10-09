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

### Amendments after approval

The owner's messages during the build changed three things, recorded here so the Spec above is not read as the final word:
1. **Teachers see it mainly on a phone**, so phones are the primary layout, not a fallback: the picture follows the lead and runs edge to edge, then the steps, with a position bar; swipe is required to work on a real touch screen (it did not at first; see Verification).
2. **No serif and no default-looking type.** A serif headline was tried and rejected; the deck uses the product's own Plus Jakarta Sans (no new font), tuned tight and heavy. Copy was rewritten to plain statements: no slogans, and no repeated "Dari X ke Y" headlines.
3. **Teachers are *Bu Guru* / *Pak Guru*, never *Ustadz/Ustadzah*** (T0).

Two design choices that the Spec did not name: a fit-to-height step scales a slide down (or up to 1.12×) on desktop widths so a presented slide never scrolls; and slide 2's picture is the nine-module map itself rather than an SVG.

## Tasks

Dependencies noted; T1 blocks T3–T5, T2 is independent, T3–T5 are independent of one another once T1 lands (one subagent each), T6 follows them.

- [x] **T0 — Honorific correction (added at approval).** `.claude/standards/voice.md`. The school says *Bu Guru* / *Pak Guru*, never *Ustadz/Ustadzah*. *Accept:* no *Ustadz* left in voice.md except the sentence that forbids it; glossary row flipped so *Bu Guru / Pak Guru* is canonical. Deck copy follows it. Out of scope, flagged: live parent-portal strings and `.claude/standards/design-system.html` still say *Ustadzah*.
- [x] **T1 — Deck shell.** `app/panduan/{page,layout,loading}.tsx`, `components/deck/{deck,slide,controls,progress}.tsx`, hash sync, keyboard/swipe/fullscreen, live region. *Accept:* with three placeholder slides, all navigation inputs work, hash restores, no console errors; page 404s nowhere and redirects per the access rules. Reuse `getSession`/`homePathForRole` from `lib/auth`, `usePrefersReducedMotion` from `components/reactbits`.
- [x] **T2 — Access + entry points.** Role guard in `app/panduan/page.tsx` (server), sidebar-footer link in `components/admin/sidebar.tsx`, teacher link in `components/teacher/more-sheet.tsx`; update the affected tests. *Accept:* guard tests for no session / `GUARDIAN` / admin / teacher pass; existing sidebar and more-sheet tests updated, not weakened. Independent of T1 at the file level.
- [x] **T3 — Illustration kit.** `components/deck/art/*`: shared stroke/radius/colour constants and the ten illustrations (cover and closing may be photo + Aurora composition). *Accept:* each renders at 320–900px wide without clipping, `aria-hidden`, brand tokens only (`grep` for raw `#hex` in `components/deck/art` is empty); a visual review at both viewports finds nothing to fix. After T1.
- [x] **T4 — Content, claims verified.** `components/deck/slides.ts(x)`: the ten slides' copy, each claim checked against a route/permission/schema reference recorded in the Implementation section. *Accept:* every claim has a code reference; cutover slides labelled; no vendor names (`grep -iE 'supabase|vercel|resend|cloudflare|xendit'` empty); sentence-case check by eye against voice.md. After T1.
- [x] **T5 — React Bits placements.** Aurora/BlurText/CountUp on the cover, Spotlight on slide 2 cards, Stagger on flow slides; reduced-motion verified. *Accept:* with `prefers-reduced-motion: reduce` nothing animates; with motion on, nothing animates layout properties. After T1.
- [x] **T6 — Tests, screenshots, iteration.** Vitest suites and the Playwright spec (`e2e/deck.spec.ts`, added to the lean cross-module list only if it stays under ~20s); script that captures all ten slides at 1440×900 and 390×844; review loop. *Accept:* gates green; I have reviewed every screenshot and fixed what I would not show the owner; record the loop in Verification (`design-system` reference included for the frontend gate).
- [x] **T7 — Docs.** README Portals/Modules note for `/panduan` (and the file-count block via `bash scripts/audit-docs.sh --write`), this doc's Verification and Ship Notes. *Accept:* `bash scripts/audit-docs.sh` exits 0.

## Implementation

- **T0** — `.claude/standards/voice.md`: persona renamed *Bu Guru Sari*, courtesy-layer entry and "avoid" example updated, carve-out names *Bu Guru / Pak Guru*, glossary row flipped (canonical *Bu Guru / Pak Guru*; *Ustadz/Ustadzah* in the avoid column). Named greeting is "Bu Guru Sari". Not touched, flagged for a follow-up: live parent-portal strings (`app/parent/**`, `components/student-journal/**`) and `.claude/standards/design-system.html` still say *Ustadzah*.
- **T1** — `app/panduan/page.tsx`, `components/deck/{deck,slide-view,fit-height,types}.tsx`, keyframes in `app/globals.css`. The slide number lives in the URL hash through `useSyncExternalStore` (no state-sync effect; `replaceState` so Back does not replay every slide). Keys: arrows, PageUp/Down, Space (left to a focused button), Home/End, F. A live region announces each slide. `touch-pan-y` sits on the scroll container, not `<main>`: the browser reads `touch-action` only up to the nearest scroll container, so on `<main>` every horizontal swipe was cancelled (found by a real-touch test, fixed, covered by e2e).
- **T2** — server guard in `app/panduan/page.tsx` (no session → `/`, `GUARDIAN` → `/parent`); "Panduan Talib" link in the admin sidebar footer (above Keluar) and in the teacher "Lainnya" sheet. Tests for both.
- **T3** — `components/deck/art/{kit,journey,structure,day,spine,report,billing,team}-art.tsx`, plus `module-map.tsx` (slide 2), `access-matrix.tsx` (slide 10), `cover-art.tsx` (slide 1). One drawing kit: 560×400 canvas, one outline weight, token fills only (no raw `#hex` under `components/deck`). SVGs are `aria-hidden`; the module map and the access matrix are real HTML (list, table) because they carry information.
- **T4** — copy in `components/deck/slides.tsx`, checked against the claims register below. Dropped on the way: "substitute relocation on leave approval" (not in code) and "+ enrollment" on convert (the route creates a Student and guardians only).
- **T5** — React Bits ports reused, nothing new: `Aurora` and `BlurText` (cover, headlines), `CountUp` (cover figures), `Spotlight` and `Stagger` (module map, step lists). Reduced motion verified in a browser: the slide hand-off and all three aurora bands report `animation-name: none`.
- **T6** — `components/deck/__tests__/deck.test.tsx`, `app/panduan/__tests__/page.test.tsx`, `e2e/deck.spec.ts`; screenshot loop in Verification.
- **T7** — README Portals row; counts block regenerated.

**Commits:** T0 `3cd98c4` (voice), T2 `6b9af11` (entry links), T1 + T3–T7 in the commit that follows (the deck itself, tests, README, counts). The deck was built and reviewed as one piece because the shell, the drawings and the copy only make sense on screen together.

### Claims register (slide → claim → where it is true)

| Slide | Claim | Reference |
|---|---|---|
| 1 | 2 kampus, 40+ guru, 500+ siswa | README opening paragraph (static on purpose; the deck reads no data) |
| 2 | Nine modules, three portals | README Modules and Portals tables; `config/admin-nav.ts`; `components/teacher/bottom-nav.tsx` |
| 2 | Teacher's attendance is visible to admin and parent | `app/admin/student-attendance/page.tsx`, `app/parent/attendance/page.tsx` |
| 3 | `/daftar` has three steps; the emailed link lasts 14 days; the form has seven steps with documents, consent and a per-parent signature | `app/daftar/client.tsx`, `app/api/enrollments/invite/route.ts`, `lib/email/enrollment-invite.ts`, `app/pendaftaran/[token]/form-logic.ts` (7 `STEPS`), `app/api/enrollments/token/[token]/signature` |
| 3 | Admin marks documents received; convert makes a Student and guardians | `components/admin/enrollment-documents-card.tsx` (`receivedPhysical`), `app/api/enrollments/[id]/convert/route.ts` (`student.create`, `studentGuardian.create`) |
| 4 | Copy classes to a new year; assign guru; swap a guru for one session; bulk promote | `app/api/admin/academic-years/[id]/roll-forward/route.ts`, `components/admin/classes/detail/{add-teacher,swap-session}-dialog.tsx`, `components/admin/classes/bulk-promote-dialog.tsx` |
| 5 | Mark the exceptions, one tap marks the rest Hadir; parent sees it; monthly recap and CSV | `app/teacher/class-attendance/page.tsx` ("Tandai … siswa lainnya Hadir"), `app/parent/attendance/page.tsx`, `app/admin/student-attendance/page.tsx`, `app/api/student-attendance/export/route.ts` |
| 5 | Buku Penghubung is two-way, with unread markers | `app/teacher/student-journal`, `app/parent/student-journal`, `app/admin/student-journal/monitoring`, `StudentJournalNoteRead` in `prisma/schema.prisma` |
| 6 | Semester → tema → subtema → minggu; objectives and indicators; three levels (Konsisten / Berkembang / Perlu penguatan); weekly walas and daily sentra; xlsx PROMES import; authoring owner-only | `prisma/schema.prisma` (`Semester`, `Theme`, `SubTheme`, `Week`, `LearningObjective`, `AchievementIndicator`, `AchievementLevel`), `app/teacher/assessments/{weekly,center}`, `app/admin/assessments`, `app/api/admin/curriculum/import-promes`, `lib/permissions.ts` (SCHOOL_ADMIN gets `curriculum.read` only). Cutover: README Modules |
| 7 | Rapor is drafted from penilaian, editable, published, PDF, read by parents; Bank Narasi | `app/admin/report-cards/page.tsx` (page text: "terisi otomatis dari penilaian, dapat disunting"), `lib/pdf/report-card.tsx`, `app/parent/reports/page.tsx`, `app/admin/report-cards/templates`. Cutover: README Modules |
| 8 | Wizard Cakupan → Tinjau → Komit; statuses Draft, Link dibuat, Dibayar sebagian, Lunas, Lewat tempo; manual payment review and audited reversal; kuitansi PDF; keringanan | `components/admin/invoices/billing-run-wizard/`, `lib/constants/invoice-status.ts`, `app/api/invoices/[id]/payments/[paymentId]/reverse/route.ts`, `app/api/invoices/[id]/pdf`, `app/api/student-fee-adjustments` |
| 8 | Online payment through DOKU | README Payments row; the Terms name DOKU. The gateway is chosen by `PAYMENT_GATEWAY`; the deck names only DOKU, as the legal pages do |
| 9 | Staff check-in/out, leave from the phone, payroll with components and approval, a teacher sees only their own slip | `app/teacher/attendance`, `components/teacher/leave-sheet.tsx`, `app/admin/(hr)/payroll`, `app/api/slips/my/route.ts` (`session.employeeId`) |
| 9, 10 | Payroll and leave approval are owner-only **by default**, grantable through a custom role | `lib/permissions.ts` `getSystemRolePermissions("SCHOOL_ADMIN")` has no `hr.*`, `leave.*` or `payroll.*`; `/admin/settings/roles` |
| 10 | Google sign-in, invitation-only; roles; audit trail | `app/page.tsx`, `lib/auth.ts` (ACTIVE user required), `lib/audit.ts` (`recordAudit` on payments, invoices, enrollments, leave, report cards, and more) |
| 10 | Admin starts at Dasbor then Antrean pekerjaan; guru at Beranda then Absensi | `app/admin/page.tsx`, `app/admin/work-queue/page.tsx`, `components/teacher/bottom-nav.tsx` |

Not claimed, because it is not in code: email or push notifications for invoices, attendance or rapor (only the admission confirmation and the enrollment invite send email), and substitute relocation when leave is approved.

## Verification

**Frontend gate:** every visual decision was checked against the `design-system` reference rules: brand tokens only (teal for the subject, gold for the one thing to look at, neutrals for the rest), sentence case, Plus Jakarta Sans, Shadcn `Button` for every control, the existing React Bits ports for motion, reduced motion respected. No raw hex under `components/deck`.

**Gates (local, clean tree):**
- `npm run build` green on the final code (Next 16 production build, `/panduan` listed as a dynamic route).
- `npx tsc --noEmit` clean. `npx eslint` on every touched file: 0 problems (the repo's 56 existing warnings are elsewhere).
- `npx vitest run`: 566 files pass. Three files (`xendit-client-classifier`, `auth-rate-limit`, `storage`) failed **only because my shell exported `DEMO_MODE`, `DATABASE_URL` and the payment stubs**; rerun with those unset, all 48 tests pass. Not related to this change; CI runs without them.
- Deck suites: `deck.test.tsx` (12 tests: ten slides max, hash, keys, rail, Space left to a focused button, modifier keys ignored, banned-word guard over every slide, cutover badges on exactly two slides), `page.test.tsx` (signed-out → `/`, parent → `/parent`, SUPER_ADMIN/SCHOOL_ADMIN/TEACHER let in with the right home link), plus the sidebar and more-sheet entry-point tests. **Mutation-checked:** removing the parent guard fails the guard test; planting "Ustadzah" in a slide fails the content test.
- `bash scripts/audit-docs.sh`: 13 ok, 1 warn (ADR window, pre-existing), 0 fail.

**Playwright:** `e2e/deck.spec.ts`, 6 tests, **6 passed in 7s** against a local production build with demo auth and a disposable local Postgres (port 5433, seeded with `prisma db seed`): signed-out redirect, parent redirect, admin pages through all ten slides by keyboard with no sideways scroll, deep link and rail jump, teacher on a 390px phone, and a real-touch swipe test (below). The full 39-spec suite is **deferred to the required CI `Playwright E2E` check**: the sandbox's Playwright wants a newer Chromium build than the one installed, so I ran the new spec through a throwaway config that points at the installed binary; the repo's config is untouched.

**Visual review loop** (screenshots of all ten slides at 1440×900, 1280×720, 768×1024, 390×844 and a tall 390 capture, reviewed by me each round). What the loop caught and fixed:
1. Cover headline had loose leading: `tailwind-merge` dropped `leading-*` because a font-size came after it. Reordered.
2. Stat labels sat above their numbers. Fixed with `order` utilities (term stays first in the DOM).
3. Labels collided with node cards (slide 3), overflowed card borders (slides 4, 5), and the scale legend overlapped itself (slide 6, twice: once at desktop, again after label sizes were raised for phones). Connectors on slide 4 did not meet the class cards.
4. The slide 9 lock sat on the payroll subtitle and its caption on the card border.
5. A serif headline was tried and rejected by the owner; replaced by the product sans.
6. At 1280×720 a slide was taller than the screen and the picture ran under the footer. Added `FitHeight` (CSS `zoom`, 0.72–1.12, desktop widths only); step text was then too small, so the text column was widened to cut wrapping.
7. Slide 2's portal chips wrapped with stray connector dashes on a phone. Connectors removed.
8. **Swipe did not work on a real touch screen**, and a right swipe navigated back out of the page. A CDP touch test showed `pointerdown` then `pointercancel`: `touch-action: pan-y` was on `<main>` and the browser only reads it up to the nearest scroll container. Moved onto the scroller; left swipe → next, right → previous, still touch → nothing, vertical drag scrolls 297px and leaves the slide alone. Now an e2e test.

**Phone (primary for teachers):** headline, lead, then the picture edge to edge, then the steps; position bar above the controls; 44×44 touch targets on prev/next/Kembali (measured with pointer: coarse); no horizontal overflow on any slide at 390 or 768 (asserted in e2e for the keyboard walk and the phone test). Honest limit: the drawings keep their 560×400 proportions, so on a 390px phone their small labels render around 9px. They are decorative, every fact is in the text beside them, and the two that carry information (module map, access matrix) are real HTML at normal size.

**Accessibility and motion (measured in a browser):** tab order is Kembali (logo) → layar penuh → Kembali → previous → ten rail buttons → next; slides are `role=group` with `aria-roledescription=slide`, a polite live region speaks "Slide n dari 10: title", focus is never trapped; with `prefers-reduced-motion: reduce` the slide hand-off and all three aurora bands compute `animation-name: none`. The `F` key could not be exercised in headless Chromium (fullscreen is refused); the button is hidden on touch widths and the handler is a plain `requestFullscreen` toggle: **verify once by hand on a desktop browser**.

**Anonymous and parent access, against the running server:** signed-out `GET /panduan` → 307 to `/`; parent session → redirect to `/parent`; the HTML a signed-out client receives contains no slide copy.

**Environment notes for the next session:** (a) `next dev` writes a Next.js agent-rules block into `AGENTS.md`, which is a symlink to `CLAUDE.md`, and flips `next-env.d.ts`; I reverted both and used `next build && next start` (what the e2e suite uses) from then on. Do not run `next dev` in this repo without checking `git status` afterwards. (b) `prisma db push --accept-data-loss` is blocked by Prisma's agent guard; plain `prisma db push` on a fresh local database is enough.

## Ship Notes

- **Migrations:** none. **Env vars:** none. **New dependency:** none (the font is the existing Plus Jakarta Sans). **Production writes:** none.
- **Auth impact:** none by the manual's definition (no change to Google login, callback, session, cookie, guard logic or dependencies): a new route behind the existing proxy plus a server-side role check, so no `needs-staging-verify` label. After merge, a 30-second look on staging as a teacher on a phone is still worth it (open Lainnya → Panduan Talib, swipe through) because the swipe fix cannot be proven by demo auth alone.
- **Rollback:** revert the PR. The route, the two entry links and `components/deck/` go together; `voice.md` is independent and can stay.
- **Updating the deck later:** edit `components/deck/slides.tsx` (copy) and the matching file in `components/deck/art/`; update the claims register above in the same PR. The banned-word test guards vendor names and "Ustadz".
- **Follow-up (not done here, by scope):** live parent-portal strings and `.claude/standards/design-system.html` / `public/admin/design-system-reference.html` still say *Ustadzah*; they now contradict `voice.md`. List: `app/parent/attendance/page.tsx`, `app/parent/student-journal/page.tsx`, `app/parent/report-cards-list.tsx`, `components/student-journal/note-{compose-dialog,thread}.tsx`, their tests, and comments in two teacher/API files. Seed employee names are data and need the owner's call.
- **Manual check owed:** the `F` fullscreen key on a desktop browser (could not run in headless Chromium).
