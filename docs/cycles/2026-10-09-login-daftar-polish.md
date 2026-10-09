# Plain consent clause, school photos on /daftar, sign-in footer, vendor-neutral legal pages

## Context

Follow-up to the photo-consent cycle (#632), from the owner's review of the screenshots. Four changes. (1) The photo/video clause is dressed up (camera icon, tinted block, heading, one-time pulse); the owner wants it to read like every other clause. (2) The public registration pages look generic: `/daftar` has no school imagery, not even the logo, and no footer, so a parent lands on a bare form. The owner wants real photos from annisaasekolahku.com there. (3) The sign-in screen (`/`, the page the owner calls /login) has a footer that is out of proportion: it floats mid-screen under the form, its links are inset ~8px from the edge everything else lines up on, and the text is tiny and faint. (4) `/legal/privacy` names infrastructure vendors (Supabase, Vercel, Resend, Cloudflare R2); the owner wants those generic and DOKU kept.

**Blocker for change 2:** the environment's network policy denies `annisaasekolahku.com` (proxy returns 403 on CONNECT), so the images cannot be fetched from this sandbox. Either the host is added under Network access → Allowed domains for this environment, or the chosen images are added to the repo by hand. Changes 1, 3 and 4 do not depend on it.

## Spec

**1. Plain photo clause**
- [ ] Clause 17 renders as an ordinary `<li>` in the same list, identical in styling to clauses 1–16: no icon, no tint, no heading, no highlight pulse.
- [ ] Wording stays exactly as shipped, so `CONSENT_VERSION` stays `annisaa-2026-v2` (no re-consent for anyone).
- [ ] Dead code goes with it: `PHOTO_CLAUSE_INDEX`, `PHOTO_CLAUSE_TITLE`, the `[data-photo-clause]` markup and `data-testid`, the `highlight-once` keyframe and token in `app/globals.css`, and the highlight class on the clause. The clause stagger reveal stays (it covers all 17).
- [ ] Tests updated: no photo-specific styling assertions; clause 17 is still the 17th list item with the agreed wording; the version/reset tests are untouched.

**2. School photos (needs the network allowance or hand-added files). This PR ships only the logo + footer part (T4a); the photos (T4b) follow once the images can be fetched.**
- [ ] A small `SchoolHero` component shows real school photos: a hero image under the header and a short strip of 3 photos ("Suasana di An Nisaa' Sekolahku" style, final caption to match the site's own wording), plus the school logo in the header. Photos are chosen by looking at the site; alt text is written in Indonesian and describes what is shown.
- [ ] `/daftar` uses the full version. `/pendaftaran/[token]` (the emailed invite form) uses a slim hero only, no gallery. Neither pushes the form below the first screen on a 390×844 phone: the hero is capped in height, and the first field stays visible without scrolling.
- [ ] Images are downloaded, resized and committed under `public/school/` (≤ ~150 KB each, served through `next/image` with explicit dimensions and `priority` on the hero), not hot-linked, so the page does not depend on the other site being up and there is no layout shift.
- [ ] `/daftar` gets the same `LegalFooter` as the sign-in screen (it has none today).
- [ ] Motion follows the existing rule: any entrance is opacity/transform only and off under reduced motion.

**3. Sign-in footer**
- [ ] Footer is centered and sits at the bottom of the sign-in column on desktop (the form block stays vertically centered above it), instead of floating under the form.
- [ ] The two links line up with the content's left edge (negative margin cancels the padding; the ≥ 24px hit area is kept), and the type is a notch larger and darker (still secondary to the form).
- [ ] On a phone the footer sits at the end of the page, after the pitch panel, so the sign-in action and the pitch read as one unit and the legal links are where people look for them.
- [ ] Verified at 390, 768 and 1440 wide with before/after screenshots. The dev-only demo sign-in screen is untouched.

**4. Vendor-neutral legal pages**
- [ ] Privacy §4 lists categories instead of names: database and authentication provider, application hosting provider, transactional email provider, encrypted backup storage provider. **DOKU (PT Nusa Satu Inti Artha) stays.** Server regions (Singapura / Indonesia) stay, because that is cross-border disclosure, not branding.
- [ ] Privacy §7 "(Supabase + R2)" becomes generic ("pada penyimpanan terenkripsi").
- [ ] Terms already name only DOKU; checked and unchanged. "Berlaku sejak" on Privacy is bumped to 9 Oktober 2026.
- [ ] Existing privacy page test updated if it asserts on a vendor name.

**Non-goals**
- The demo-mode sign-in screen, the sign-in brand panel's copy and Aurora, and any admin/teacher/parent portal page.
- Re-wording clause 17 or changing the privacy page's photo section (§8).
- Any new dependency, and any change to what `/daftar` collects or submits.
- Choosing a different brand palette: images and layout use existing tokens.

**Assumptions**
1. **"/login" is the sign-in at `/`.** There is no `/login` route. If you meant something else, say so.
2. **"here, especially /daftar" means the public registration pages**: `/daftar` full treatment, the invite form `/pendaftaran/[token]` a slim one. Drop the slim one if you want `/daftar` only.
3. **The photos on the school's site are the school's own to reuse.** I will not use anything on that site that looks like a third-party stock image, and I will not caption children by name. The site's photos of children are already public, but this puts them on a page that is shown to prospective parents, so tell me if any should not appear.
4. **Plain clause 17 is less conspicuous.** You asked for it; the earlier note stands that a visible, specific clause is the stronger consent record, and the privacy page still describes it. No change from me, just flagging that it was a deliberate trade.
5. **Naming vendors is not required by UU PDP, but disclosing categories, purposes and cross-border location is**, which is why those stay.
6. **Footer on mobile moves to the end of the page** rather than staying under the button. If you prefer it under the button on phones too, that is a one-line change.

## Tasks

- [x] **T1 — Plain clause 17.** `app/pendaftaran/[token]/client.tsx`, `lib/enrollment/consent-clauses.ts` (+ test), `app/globals.css`, `app/pendaftaran/[token]/__tests__/{photo-consent,consent-motion}.test.tsx`. *Accept:* clause 17 has the same markup and classes as the others; no `PHOTO_CLAUSE_*`, `data-photo-clause` or `highlight-once` left anywhere (`grep` empty); stagger/show-once tests still pass; version still v2. Independent.
- [ ] **T2 — Vendor-neutral legal pages.** `app/legal/privacy/page.tsx` (+ `__tests__/page.test.tsx`). *Accept:* no `Supabase`, `Vercel`, `Resend`, `Cloudflare` or `R2` anywhere under `app/legal/` (`grep` empty), DOKU still present, date bumped. Independent.
- [ ] **T3 — Sign-in footer.** `components/layout/legal-footer.tsx`, `app/page.tsx`. *Accept:* before/after screenshots at 390/768/1440 show a centered bottom-anchored footer on desktop, links flush with the content edge, end-of-page footer on mobile; existing sign-in and footer tests green. Independent.
- [ ] **T4a — /daftar logo + footer (no photos needed).** `app/daftar/page.tsx`. *Accept:* the school logo sits beside the wordmark in the header (same treatment as the sign-in screen), the page ends with the `LegalFooter` (links to terms and privacy, © line) sitting at the bottom on tall screens; `e2e/daftar-public.spec.ts` selectors still resolve. Independent of T3's footer restyle (uses its public API).
- [ ] **T4b — School photos (BLOCKED, shipped separately).** New `components/brand/school-hero.tsx`, `public/school/*`, `app/daftar/page.tsx`, `app/pendaftaran/[token]/page.tsx`. Waits on `annisaasekolahku.com` being added to the environment's allowed domains (or images added by hand); still unreachable at build time (proxy 403). *Accept:* as the Spec item 2 criteria. Not part of this PR; follow-up PR once the images can be fetched.
- [ ] **T5 — Docs.** README rows for the public pages and legal wording; this doc's Verification (design-system reference, Playwright status, screenshots). *Accept:* `bash scripts/audit-docs.sh` exits 0.

Dependencies: T1, T2, T3, T4a independent; T4b blocked on the image source and ships in its own PR; T5 last.

## Implementation

- Subagent plan: driver=claude-sonnet-5-5 (no tier above sonnet on this harness; implementers run on sonnet), dirty-work=sonnet; tasks [T1, T2, T3, T4a] parallel (disjoint files; implementers do not commit; the driver builds, screenshots, reviews and commits per task by path), T5 inline (docs). T4b is not built in this cycle: the image host is denied by the network policy.
- **T1** — `app/pendaftaran/[token]/client.tsx`, `lib/enrollment/consent-clauses.ts` (+ test), `app/globals.css`, `photo-consent` / `consent-motion` / `stagger` tests. Clause 17 now renders through the same `StaggerItem as="li"` as clauses 1–16: no icon, tint, heading or pulse. Removed `PHOTO_CLAUSE_INDEX`, `PHOTO_CLAUSE_TITLE`, `data-photo-clause`, the test id, the `highlight-once` keyframe and token (nothing else used them; `grep` over `app components lib e2e` is empty). The stagger reveal and show-once logic stay (they cover all 17). Wording and `CONSENT_VERSION = "annisaa-2026-v2"` are unchanged, so nobody re-consents. New assertion: clause 17's `className` equals clause 16's and it contains no `strong` or `svg`. One test prop was renamed (`data-photo-clause` → `data-extra` in the stagger prop-forwarding test) only so the removal grep stays empty.

## Verification
- Task T1 (design-system reference: the consent list is back to the single existing clause style, so there is no bespoke treatment to drift from the design system): `npx vitest run app/pendaftaran lib/enrollment components/reactbits` 28 files / 263 tests pass (implementer's run), eslint and `npx tsc --noEmit` clean. Independent review of the whole T1–T4a diff: no confirmed defects.

## Ship Notes
