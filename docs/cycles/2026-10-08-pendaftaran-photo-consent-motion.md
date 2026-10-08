# Pendaftaran: photo/video consent + form motion

## Context

Two asks on the parent enrollment form (`/pendaftaran/[token]`). (1) The school photographs and films children during daily activities and wants to reuse some of it for documentation and social media. Today the signed "Surat Persetujuan Orang Tua" (`lib/enrollment/consent-clauses.ts`, 16 clauses, `CONSENT_VERSION = "annisaa-2026-v1"`) says nothing about images, so there is no recorded parent consent. It has to be captured at registration, in plain words, without a second checkbox or a wall of legal text that makes parents hesitate ("dengan mendaftar maka …"). (2) The form should feel polished so parents trust it and finish it. Motion already has a sanctioned shape in this repo: `components/reactbits/` (cycle `2026-09-30-reactbits-motion`) vendors small React Bits pieces on `framer-motion` (already installed), no new dependencies, SSR-safe, `prefers-reduced-motion` safe, zero layout shift, because parents open this form on low-end Android phones. The form itself has none of it yet: the stepper is flat pills, steps swap instantly, the success screen is a static check icon. This cycle adds the consent wording and a restrained motion layer in the same spirit.

## Spec

**Photo/video consent**
- [ ] New clause 17 in `CONSENT_CLAUSES` grants the school permission to use photos/videos of the child taken during school activities for documentation and the school's social media. Plain Indonesian, parent voice (`voice.md`), one or two sentences. Draft below.
- [ ] No extra checkbox and no extra signature: it is covered by the existing "Kami sudah membaca, memahami, dan menyetujui seluruh isi surat persetujuan ini" checkbox and the Ayah/Ibu signatures, i.e. consent by registering.
- [ ] It is not buried at the bottom of a long list: the clause is rendered visually distinct (camera icon, tinted block, short heading "Foto & video kegiatan") inside the same ordered list, so numbering and the stored clause set stay in step.
- [ ] `CONSENT_VERSION` → `annisaa-2026-v2`, because the letter's meaning changed (the file's own rule: bump, never mutate in place).
- [ ] A saved draft whose `consentData.version` is not the current one comes back with `agreed: false`, so a parent who ticked the box on the v1 letter must tick it again on the letter that now includes clause 17. Their signatures and names stay saved.
- [ ] `/legal/privacy` gets a short paragraph on photos/videos (purpose, who sees them, how to ask for limits). It has none today and the form links to that page.
- [ ] Admin enrollment view already prints `Versi`; no change needed. Existing tests/e2e that hard-code `annisaa-2026-v1` are updated.

Draft copy (to be confirmed by the school, see Assumptions):

> **Foto & video kegiatan.** Dengan mendaftar, kami mengizinkan sekolah menggunakan foto dan video ananda dari kegiatan sekolah untuk dokumentasi dan media sosial sekolah. Jika ingin membatasi, kami cukup menyampaikannya kepada wali kelas kapan saja.

**Motion** (all scoped to `/pendaftaran/[token]`; every effect is gated on `prefers-reduced-motion: no-preference`, and with reduced motion on or JS off the page is identical to today)
- [ ] Step enter transition: when the step changes, the new step fades in and slides 12px from the direction of travel (forward from right, back from left), ~200ms. **Enter-only, no exit animation**, so the DOM swaps immediately and existing tests, focus handling and scroll-to-top keep working.
- [ ] Stepper: an animated progress bar above the pills fills to the current step (scaleX, spring); a step that becomes completed gets a small check pop. The `<ol aria-label="Langkah formulir">`, `aria-current="step"` and the visited-step buttons keep their semantics and accessible names.
- [ ] Consent step: the 17 clauses reveal with a short stagger on first view (capped total, so clause 17 is not seconds away), and the photo clause gets one soft highlight pulse, once.
- [ ] Buttons: Lanjut/Kembali/Kirim get a light press scale (`whileTap`, ≥ 0.97).
- [ ] Saved signature: the "tersimpan" state draws its check (pathLength) instead of popping in.
- [ ] Success screen: the check icon draws in, the headline uses the existing `BlurText`, the "Bawa saat daftar ulang" list rows stagger in.
- [ ] No new dependency, no canvas/WebGL, nothing that animates `width`/`height`/`top`/`left` (transform + opacity only). `components/reactbits/` pieces are reused where they fit (`BlurText`); new primitives live next to them and cite their inspiration in the file header like the others.
- [ ] Vitest: step transition does not delay the DOM swap or break focus/scroll; stepper keeps its roles/names; reduced motion renders the static output; consent version-reset; clause 17 renders and numbering is 1–17; success screen text unchanged. Existing `app/pendaftaran/[token]/__tests__/*` and `e2e/*enrollment*` stay green.

**Non-goals**
- `/daftar` (the public inquiry form). It is the real top of the funnel and could use the same polish, but it is a different form with different tests; say the word and it becomes a follow-up cycle.
- Measuring conversion. There is no funnel analytics on this form, so this cycle cannot claim a conversion lift. See Assumption 2.
- A separate, optional "opt-out of photos" checkbox or a per-child photo permission field. Not stored per child; not shown on a class roster. If the school later needs "these 3 children must not appear", that is a schema change (its own cycle).
- Any change to how admins use or publish photos.
- Parallax, confetti, Aurora/Galaxy-style backgrounds, count-ups on a form that has no numbers.

**Assumptions**
1. **Scope of "pendaftaran form" = `/pendaftaran/[token]`**, the multi-step form that holds the consent letter. `/daftar` is excluded (non-goal above).
2. **Motion helps perceived quality; it does not by itself convert.** What tends to move completion is momentum cues. The progress bar is that; the rest is polish. I am not adding fake urgency or an unmeasured claim. If you want real numbers, a follow-up could add step-reach events.
3. **Bundled consent is the approach you asked for, and it has a legal edge you should know about.** Indonesia's PDP law (UU 27/2022) treats children's personal data, which includes photos and video, as needing a parent's valid consent that is explicit and informed. Putting it as a clearly marked clause in a signed letter, with its own heading and a one-line way to limit it, is the best fit for "don't make them overthink" that is still defensible. A hidden or generic clause would not be. This is not legal advice; **please have the school's counsel read the final clause** before this ships.
4. **The opt-out sentence is my addition.** "Jika ingin membatasi, … menyampaikannya kepada wali kelas kapan saja" is a promise the school has to be able to keep, and teachers need to know what to do with such a request. Delete it from the draft if the school does not want to offer it; the rest of the cycle is unaffected. I deliberately did **not** write other promises (no full names, no faces of children, no addresses) because I do not know the school's practice.
5. **Version bump is acceptable.** Side effects: a parent mid-form during deploy whose tab still ships `v1` gets the existing "Versi surat persetujuan kedaluwarsa — muat ulang halaman" error on submit (their draft is saved; reloading fixes it). Already-submitted applications keep their `v1` record untouched.
6. **Reduced motion is read from `matchMedia` directly** (as `CountUp` does) rather than framer-motion's `useReducedMotion`, which caches per module load (learned in the 2026-09-30 cycle).
7. **Enter-only step transition** is a deliberate trade against nicer exit animations: `AnimatePresence mode="wait"` would delay unmounting the old step, which interacts badly with this 1,264-line client's focus/scroll logic and its tests.

## Tasks

- [ ] **T1 — Photo/video clause + version.** `lib/enrollment/consent-clauses.ts` (clause 17, `PHOTO_CLAUSE_INDEX`, `CONSENT_VERSION = "annisaa-2026-v2"`), `app/pendaftaran/[token]/client.tsx` (`initConsent` resets `agreed` on version mismatch; `ConsentStep` renders the photo clause as a highlighted list item with the camera icon and heading); update every test/e2e that hard-codes `annisaa-2026-v1`. *Accept:* clause 17 renders as list item 17 with its heading; one checkbox still gates Lanjut; a draft with `version: "annisaa-2026-v1"` loads unchecked with names/signatures intact; submit payload carries `v2`; `submit-validation` tests pass with the new version. Independent.
- [x] **T2 — Privacy page paragraph.** `app/legal/privacy/page.tsx`: "Foto & video kegiatan" section. *Accept:* page test (or snapshot-free assertion) finds the section and the "wali kelas" contact path. Independent.
- [ ] **T3 — Motion primitives.** New `components/reactbits/` neighbours: a `usePrefersReducedMotion` helper (matchMedia, SSR-safe), `StepTransition` (key by step, direction-aware enter-only), `Stagger`/`StaggerItem` (capped total delay), `DrawCheck` (pathLength). Header comments cite sources like the existing files. *Accept:* unit tests: reduced motion renders children with no motion wrapper styles; normal path renders children immediately (no deferred mount); `DrawCheck` is `aria-hidden` and has an accessible-name sibling when used with a label. Independent.
- [ ] **T4 — Stepper progress + step transition (depends T3).** `client.tsx` `Stepper` gets the progress bar and completed-check pop; the step panel is wrapped in `StepTransition` with direction tracked from previous step; `whileTap` on the three nav buttons. *Accept:* stepper tests keep passing unmodified (roles, `aria-current`, visited buttons); changing step renders the new step's heading synchronously; focus/scroll behaviours covered by the existing client tests stay green.
- [ ] **T5 — Consent reveal, signature check, success screen (depends T1, T3).** Stagger the clauses, one-time highlight on clause 17, `DrawCheck` in the saved-signature state (`components/enrollment/signature-pad.tsx`), success screen with `DrawCheck` + `BlurText` + staggered `BringList` rows (`app/pendaftaran/[token]/bring-list.tsx`). *Accept:* the success screen still exposes the same headline and child name to `getByText`/`getByRole`; reduced motion renders static; signature-pad tests green.
- [ ] **T6 — Docs.** README Tech Stack UI row names the form motion; this cycle doc's Verification records `design-system` reference, Playwright status, and a manual run of the real form (including with reduced motion emulated). *Accept:* `bash scripts/audit-docs.sh` exits 0.

Dependencies: T1, T2, T3 independent; T4 after T3; T5 after T1 + T3; T6 last.

## Implementation

- Subagent plan: driver=claude-sonnet-5-5 (this harness has no cheaper-than-driver tier above Haiku; implementers run on sonnet), dirty-work=sonnet; tasks [T1, T2, T3] parallel (disjoint files; implementers do not commit, the driver gates, reviews and commits per task by path), tasks [T4, T5] sequential after T3 (both edit `app/pendaftaran/[token]/client.tsx`), T6 inline (docs).
- **T2** — `app/legal/privacy/page.tsx`, `app/legal/privacy/__tests__/page.test.tsx`: new section "8. Foto & Video Kegiatan" (what, purpose, basis = parent consent at registration via butir 17, how to ask for limits via wali kelas, cross-reference to the existing contact in section 5; no retention, blurring or other promises invented). "Perubahan Kebijakan" renumbered 9; "Berlaku sejak" bumped to 8 Oktober 2026. The page had no section-number references elsewhere. Reviewed inline by the driver: static copy only, no data path, no auth surface.

## Verification

- Task T2: `npx vitest run app/legal` 2/2 pass (driver re-ran). Full `npm run build && npx vitest run` is run once T1 and T3 land, because the shared worktree is mid-edit while the implementers run; recorded here rather than silently skipped.

## Ship Notes
