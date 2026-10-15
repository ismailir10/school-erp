# Pendaftaran — pay after the form, and kode pos address lookup

Cycle: 2026-10-15 · Branch: `feat/pendaftaran-pay-after-form` · Role: cto

## Context

The pendaftaran fee is now **paid first**: *Kirim Formulir* makes staff pick Program + Day Care and creates the fee,
and the parent's link shows a *Bayar dulu* screen. Every parent write (autosave, upload, signature, submit) is refused
with `PAYMENT_REQUIRED` until the fee is paid or waived, and Program is locked in the form
(cycle `2026-10-11-pendaftaran-simplify`, Decision 10). Ismail (15 Oct): move the payment to **after** the parent fills
the form. The order *fill → submit → pay* already exists for forms sent before pay-first (cycle
`2026-10-10-pendaftaran-fee-payment`): the fee is priced when the form is submitted, the thank-you card shows
*Langkah terakhir: bayar*, and DOKU sends the parent back to the payment page.

Ismail also asked for a better address input: the parent types a kode pos and gets the kelurahan/desa prefilled or as a
dropdown, using a reputable open dataset. Today each address (child, Ayah, Ibu) is five free-text boxes: Perumahan,
Blok / Cluster, RT / RW, Kecamatan, Kode Pos. Kelurahan, kota/kabupaten and provinsi are not asked at all, Kode Pos
takes any text, and the Tinjau step never shows the address back to the parent.

Facts that shape the work:
- Pay-first (#650) and the earlier pay-after-submit cycle (#643) are on `staging` only; `main` (production) has neither,
  so no production formulir was ever sent under pay-first. Staging may hold a few sent forms whose fee was created at send.
- Addresses live inside the formulir's JSON blobs (`studentData.address`, `ayahData.address`, `ibuData.address`) and are
  joined into the plain `address` text of Student / Parent on convert. New address keys need no migration.
- Dataset, compared across 8 candidates (research in this cycle's session): **cahyadsn/wilayah** (names, Kepmendagri
  300.2.2-2138/2430 Tahun 2025, 1.3k stars, committed 2026-10-14) joined on the Kemendagri code with
  **cahyadsn/wilayah_kodepos** (postal codes, updated 2025-06-30). Both MIT. 38 provinces (incl. the four 2022 Papua
  provinces), 514 kab/kota, 7,285 kecamatan, 83,762 kelurahan/desa, every one with a 5-digit kode pos; 10,632 distinct
  codes, 7,548 of them shared by several kelurahan (max 108). Runner-up sooluh/kodepos (Apache-2.0) drops the
  Kota/Kabupaten distinction (Kota Bandung and Kabupaten Bandung both read "Bandung"), so it was rejected. Compact
  form keyed by kode pos is ~1.9 MB (~560 KB gzipped): small enough to load on the server, too big to ship to phones.

UAT input: `docs/uat/reports/2026-10-06-enrollment-form` (0 blockers; the one major, slow-uplink uploads, is untouched
here).

## Decisions

Ismail asked to run this end to end without check-ins ("merge on green, i dont want to babysit"), so these were
decided by the driver from the code and prior cycles; each can be revisited.

1. **Pay after submit, for every form.** No fee exists before the form is submitted. The parent fills all seven steps
   freely (Program and Day Care are chosen in the form again), Tinjau shows the price, submit creates the fee, and the
   thank-you card leads to *Bayar sekarang*. The link stays the way back to the payment. This is the order from
   cycle 2026-10-10, now the only order. The fee stays non-refundable and an unpaid fee still never blocks convert.
2. ***Kirim Formulir* is one tap again.** It no longer asks Program / Day Care or shows a price; the formulir starts with
   the lead's program as a suggestion the parent can change. The result card keeps *Kirim lewat WhatsApp*, *Salin
   tautan*, *Isi bersama orang tua* and the email. It loses the fee block and *Tandai lunas* / *Bebaskan* (there is no
   fee yet). Staff settle a walk-in's fee after submit from the formulir's fee card, as before pay-first.
3. **Staff paths unchanged otherwise.** *Tandai formulir masuk* creates the fee like a parent submit (already does).
   *Ubah data* reprices an unpaid fee and never touches a paid or waived one (already does).
4. **Forms sent under pay-first (staging only)** keep their fee row and simply stop being gated: the form opens, Program
   is editable, and on submit an **unpaid** fee is repriced to what the parent chose (never a second fee); a paid or
   waived fee is left alone, the same rule *Ubah data* follows. No row is rewritten outside a submit.
5. **The *Menunggu pembayaran* count goes.** It counted sent-but-unpaid forms, which can no longer exist; *Belum bayar*
   (every unpaid fee on an open formulir) stays as the one payment count and filter.
6. **Address = kode pos first.** Each address block reads: Perumahan / Jalan, Blok / Cluster, RT / RW, **Kode pos**, then
   **Kelurahan / Desa**, Kecamatan, Kota / Kabupaten, Provinsi. Typing a full 5-digit kode pos looks it up: one match
   fills all four; several matches turn Kelurahan / Desa into a dropdown and picking one fills the rest; no match says
   so and leaves the boxes free to type. **"Tidak tahu kode pos?"** opens a search by kelurahan or kecamatan name (from
   3 letters) whose result fills everything including the kode pos. Every filled box stays editable, because a
   dataset can be wrong and families know their own address. A lookup failure never blocks the form.
7. **Data is vendored, looked up on the server.** The cahyadsn pair is converted by a repo script pinned to upstream
   commits into one compact JSON in the repo, with the MIT notices kept next to it. Lookups go through a token-gated,
   rate-limited route on the parent's own form link (no new public URL, no third-party call at runtime, no CSP change).
   Names are kept as published ("Kota Bandung", "Kabupaten Bandung", "Daerah Khusus Ibukota Jakarta") so Kota and
   Kabupaten never collide.
8. **Address is stored as fields, joined on convert.** Three new keys (`kelurahan`, `kotaKab`, `provinsi`) join the
   existing five in each address blob; old blobs without them still load. Convert joins all eight in reading order into
   the Student / Parent address text. Kode pos must be 5 digits when given (the input takes digits only); everything
   stays optional, as today.
9. **Staff see and edit the same fields.** *Ubah data* gets the three new boxes; the formulir view and the parent's Tinjau
   step show the full address. Staff do not get the lookup in this cycle (non-goal).
10. **Branch.** `feat/pendaftaran-pay-after-form` in its own worktree from `origin/staging`.

## Acceptance criteria

- [ ] *Kirim Formulir* sends in one tap without asking Program / Day Care; no fee row exists after sending; the result card shows no fee block and no *Tandai lunas* / *Bebaskan*.
- [ ] A freshly sent link opens straight on the form (never a *Bayar dulu* screen); autosave, upload, signature and submit all work before any payment.
- [ ] The parent chooses Program and Day Care in the form; Tinjau shows the price and says it is paid after sending.
- [ ] Submitting a priced program creates one UNPAID fee and the thank-you card shows *Bayar sekarang*; a free program creates no fee and no payment step.
- [ ] Reopening a submitted, unpaid link shows the payment card; the DOKU return page still shows Lunas / Menunggu / gagal.
- [ ] A staging form whose fee was created at send opens without a gate, its unpaid fee is repriced at submit to the chosen program (no second fee), and a paid or waived one is untouched.
- [ ] *Tandai formulir masuk* creates the fee; the formulir fee card can *Tandai lunas* / *Bebaskan* afterwards.
- [ ] The admissions list no longer shows a *Menunggu pembayaran* count; *Belum bayar* counts and filters unpaid fees.
- [ ] Typing a 5-digit kode pos with one kelurahan fills Kelurahan, Kecamatan, Kota / Kabupaten and Provinsi.
- [ ] A kode pos shared by several kelurahan offers them in a dropdown; picking one fills the rest.
- [ ] An unknown kode pos says it was not found and leaves every box typeable; a lookup error does not block the step.
- [ ] "Tidak tahu kode pos?" finds a kelurahan by name and fills all five region boxes including the kode pos.
- [ ] Kode pos accepts digits only, at most 5; a partial code gets an inline error on Lanjut.
- [ ] The new address boxes autosave, reload, survive submit, show on Tinjau and in the staff formulir view, are editable in *Ubah data*, and appear in the Student / Parent address after convert.
- [ ] The lookup route answers only for an open form link, is rate limited, and never returns anything but region data.
- [ ] README, UAT jobs, ADR row, `/panduan` slide, runbooks and glossary describe pay-after; `audit-docs.sh` exits 0.

## Verify flows

Data: demo auth, disposable local Postgres, seeded super admin (`u_super_admin`); a program priced in
*Pengaturan → Pendaftaran*.

1. **Online parent, pay after.** Admin: Pendaftaran → Catat Pertanyaan (name + phone + email) → *Kirim Formulir* (one
   tap) → open the link on a phone viewport → form opens, fill all steps, kode pos `40115` fills Citarum / Bandung
   Wetan / Kota Bandung / Jawa Barat → Tinjau shows the address and the price → submit → *Bayar sekarang* → demo
   payment → Lunas. Admin list: row *Formulir masuk*, Lunas.
2. **Walk-in.** Catat Pertanyaan (no email) → Kirim Formulir → *Isi bersama orang tua* → kode pos `12950` → submit →
   formulir detail → *Tandai lunas (tunai)* → *Terima & Jadikan Siswa* → the student's address reads the full joined
   address.
3. **Address edges.** Kode pos `99351` (3 kelurahan) → dropdown → pick Atabar → fills Ebungfao / Kabupaten Jayapura /
   Papua. Kode pos `00000` → "tidak ditemukan", boxes typeable. "Tidak tahu kode pos?" → search "citarum" → pick → kode
   pos filled. Letters typed into kode pos are ignored; `4011` + Lanjut → inline error.
4. **Errors / legacy.** A staging-style form with a fee created at send (made via the API before this change's rules,
   i.e. a fee row on an INVITED form) opens without a gate and reprices at submit. Lookup route with a bad token → 404;
   hammered → 429. Free program → no payment step.

## UX notes

- Parent form is phone-first: kode pos input is `inputMode="numeric"`, 5 characters, `h-11` like every other input;
  the kelurahan dropdown is a native select (thumb-friendly on phones), the name search is a text box with a result
  list of buttons.
- Lookup feedback is quiet and live (`aria-live="polite"`): "Mencari…", "3 kelurahan untuk 99351 — pilih satu",
  "Kode pos tidak ditemukan. Silakan isi manual." Never a raw error.
- Thank-you card copy keeps the 2026-10-10 wording (Bapak/Ibu register, `voice.md`): *Langkah terakhir: bayar biaya
  pendaftaran*, *Bayar sekarang*, "Belum sempat sekarang? Bisa dibayar nanti lewat tautan yang sama."
- Follow `design-system.html`, `ui.md` (Shadcn first), `portal.md`, `better-accessibility` for the live region and labels.

## Test seams

- Vitest API: invite (no program, no fee), token PATCH / documents / signature / submit (no gate; submit prices or
  reprices), wilayah route (token, rate limit, shapes), admissions list stats.
- Vitest lib: wilayah lookup + search; convert address join; submit validation for the new keys.
- Vitest jsdom: address fields component (one / many / none / error / search / digits-only), parent form (no gate,
  Program editable, thank-you pay panel), Kirim Formulir one tap + result card.
- Playwright: update `admin-walkin-pipeline`, `enrollment-fee-payment`, helpers; one address-lookup assertion in the
  enrollment application spec.

## Non-goals

- Kode pos lookup for staff (*Ubah data*), for Student / Parent edit dialogs, campus settings or `/daftar`.
- Splitting the Student / Parent `address` column into structured columns.
- Refunds, instalments, reminders, finance ledger for the fee.
- Rewriting existing formulir rows outside a parent submit.

## Assumptions

1. Production has no pay-first rows (verified: #650 is not an ancestor of `origin/main`).
2. The cahyadsn kode pos map is accurate enough as a suggestion (cross-check against sooluh agreed on ~98% of rows that
   matched by name); every filled box stays editable.
3. A 1.9 MB JSON read once per server instance is acceptable on Vercel (well under the function size limit).
4. The lead's program is a good default for the form's Program step; the parent may change it.

## Gate re-openers

- Schema migration: **none**. New npm dependency: **none** (vendored data, MIT, notices kept). Production write: **none**.
  Paid API: **none**.
- Payment gating change (requested): public token routes stop refusing writes for an unpaid fee; the fee is created at
  submit instead of at send. No webhook, gateway or amount-matching change.
- New token-gated public route for region lookup (no PII, rate limited).

## Tasks

- [x] T1 Pay-after for the parent — remove `PAYMENT_REQUIRED` from token access, the token routes and the 409 helper;
  autosave writes Program / Day Care; submit always prices (reprices an existing unpaid fee, leaves paid/waived);
  parent UI: no redirect, no *Bayar dulu* screen, no locked Program step, thank-you pay panel, pembayaran page legacy
  branch only — accept: token route + page + client tests green (reuse: `fee-snapshot.ts`; baseline `023c38e`).
- [x] T2 Pay-after for staff — invite takes no program and creates no fee; *Kirim Formulir* one tap; result card without
  fee block; no *Menunggu pembayaran* stat — accept: invite route + admissions page + dialog tests green (parallel with T1).
- [x] T3 Wilayah data + lookup — pinned vendoring script, compact JSON + MIT notices, `lib/wilayah` lookup by kode pos
  and name search, token-gated rate-limited route — accept: lib + route tests green, sample codes 40115 / 12950 / 99351
  (parallel with T1, T2).
- [x] T4 Address UI + fields — shared address component in the parent form (3 places), new keys in validation, staff
  editor, view, Tinjau, convert join — accept: component + validation + convert tests green (deps: T1, T3).
- [ ] T5 E2E + docs — update pay-first specs and helpers to pay-after, address lookup assertion; README, UAT jobs, ADR,
  `/panduan`, runbooks, glossary, CLAUDE.md file structure, `audit-docs.sh --write` — accept: Playwright green locally,
  `audit-docs.sh` exits 0 (deps: T1–T4).

## Implementation

- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5-5 (one subagent per slice; workers never commit, the driver re-runs every gate, reviews and commits). T1 ∥ T2 ∥ T3 in parallel (disjoint files: token routes + `app/pendaftaran/**` vs invite route + `components/admin/admissions/**` vs new `lib/wilayah/**` + one new route); T4 after T1 + T3 (shares `app/pendaftaran/[token]/client.tsx` with T1, consumes T3); T5 last. Review per task: standards + spec reviewers, plus security for `app/api/**`.
- T3: `scripts/vendor-wilayah.mjs` (zero-dep, pinned to cahyadsn/wilayah@5d450cc + wilayah_kodepos@ba84971, `--from` for offline clones, hard validation, deterministic output), `lib/wilayah/data/{wilayah.json,NOTICE.txt}` (1.87 MB, 562 KB gzipped; 38 / 514 / 7,285 / 83,762 / 10,632 kode pos; both MIT notices verbatim), `lib/wilayah/lookup.ts` (`lookupKodePos` exact 5 digits sorted by kelurahan; `searchWilayah` normalized prefix-token search, ≥3 letters, ranked kelurahan → kecamatan → spread, index built lazily: ~0.3 ms lookup, 3–36 ms search), `app/api/enrollments/token/[token]/wilayah/route.ts` (`// @public`, per-IP 60/min, open form only via `denyTokenAccess`, `?kodepos=` xor `?q=`, Indonesian 400s, region data only). The JSON is a plain import inlined into the route chunk, so no file tracing config is needed on Vercel; build confirmed in the full gate.
- T1: `lib/enrollment/{resolve-token,access-response}.ts` (no `PAYMENT_REQUIRED` state; the fee is no longer read for access), deleted `lib/enrollment/{payment-required,conflict,payment-gate}.ts`, token routes (autosave writes Program / Day Care in its one guarded write again; documents and signature never gated; submit always checks the program is active and prices from the body — no fee row → `createFeeSnapshot`, an existing staging-era fee → `repriceUnpaidFee` under the row lock after the flip wins, so PAID / staff-waived fees stay put and no second row is made; the 201 carries a fee only when one is still owed), `app/pendaftaran/[token]/{page,client,form-logic,payment-panel,pembayaran/page}` (no redirect, no *Bayar dulu* screen, Program step editable and required, the thank-you card's pay panel is the only payment step; deleted `pay-first-screen.tsx`), `components/enrollment/documents-step.tsx`, tests (pay-first suites deleted; old-order cases are now the main ones; added reprice-at-submit, any-fee-state opens the form, autosave carries Program). Reviewed (spec, standards, security): no blockers. Accepted, staging-only: a staging form whose fee was already PAID before this change still shows the price on Tinjau and no "Lunas" line on the thank-you card (the next page load shows it); the reprice actor is the literal `parent-form`. design-system: no new tokens or components; removed screens only.
- T2: `app/api/enrollments/invite/route.ts` (body is `{admissionId}` only — old clients' `programId` / `dcareAddon` are stripped; first send creates the formulir with no fee, prefilled with the lead's program only if it is still ACTIVE in the tenant; resend is the atomic INVITED-only token refresh and never reads or reprices a fee; 409 / 429 / P2002 / audit kept; response `{id, formUrl, emailed, hasEmail}`), deleted `components/admin/admissions/kirim-formulir-form.tsx`, new `use-send-formulir.ts` (per-row single flight), `row-actions.tsx` / `columns.tsx` (pending send keeps its label, adds a spinner, `aria-disabled` styling, polite live announcement), `send-formulir-dialog.tsx` (no fee block or settle buttons; a line that the fee is paid after the form is sent; on a resend, that the old link no longer works), `lib/enrollment/fee-client.ts` trimmed to the fee card's needs, `menungguBayar` removed from `lib/admission/stage.ts`, the admissions list API and its types, dead `application.programId` / `dcareAddon` dropped from the list payload, tests. Reviewed (spec, standards, security): two a11y majors (pending label, global in-flight guard) fixed; no security findings. Deliberate: a resend is one tap too, so the result card names that the old link died. design-system: Shadcn Button + lucide icon, existing tokens.
- T4: new `components/enrollment/address-fields.tsx` (+ `field-styles.ts`, shared with the form), used for the child, Ayah and Ibu blocks in `app/pendaftaran/[token]/client.tsx`; `lib/enrollment/address.ts` (`formatAddress`, one reading order for the staff view, Tinjau and convert); `lib/enrollment/submit-validation.ts` (`kelurahan`, `kotaKab`, `provinsi`; kode pos stays lenient server-side so old drafts still submit — the form enforces 5 digits), `convert-input.ts` (old blobs join byte-identically), staff *Ubah data* + view (all eight boxes; the view now shows the full address for both parents), tests. Behaviour: digits only (paste cleaned, no `maxlength` so "40 115" works); a single match overwrites all four region boxes; several matches → a native select that never hides a stored value (an unlisted kelurahan is cleared, region boxes that differ across the options are cleared), with *Lainnya (ketik sendiri)* / *Pilih dari daftar*; none or an error leaves the boxes typeable with a quiet message in one polite live region; *Tidak tahu kode pos?* searches by name (debounced, ≥3 letters, Escape closes, Enter picks a single result) and fills the kode pos too; `autoComplete` scoped per block; a partial kode pos blocks Lanjut with an inline error and focus, and is named at submit; Tinjau shows the joined address per person. The 1.9 MB data is only ever `import type`d client-side. Reviewed (spec, standards): two fill-policy majors (half-filled address, hidden stale kelurahan) fixed; a debounce bug found by the new Enter test fixed. Known, left: a fully maxed address joins to ~524 chars against the Parent edit dialog's 500 cap (unreachable in practice). design-system: Shadcn Field / Input / NativeSelect / Button, existing tokens, `h-11` touch targets.

## Verification

## Ship Notes
