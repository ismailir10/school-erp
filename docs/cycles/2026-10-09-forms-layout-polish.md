# Layout polish for /daftar and the invite form

## Context

The owner looked at `/daftar` on desktop and called the layout ugly, and asked for the work to be checked through the real UI on `/daftar` and the new-student invite form (`/pendaftaran/[token]`). I had only unit-tested the earlier cycles and glanced at the first fold. This cycle starts from screenshots of every step of both forms at 390, 768 and 1440 wide (production build, preview harness with fake props), taken before any change.

Defects found:

**`/daftar`**
1. **Gender tiles do not fill their grid cells.** `FieldLabel` is `w-fit`; the tile classes never override it, so each tile hugs its text. On desktop there is a dead gap between the two; at 390 the right tile (`Perempuan`) is wider than its cell and overhangs the input column by ~10px.
2. **Stepper labels float edge to edge.** `justify-between` on three differently sized items puts "Data Orang Tua" off-centre and the labels far from the progress bar they describe.
3. **The only action on step 1 is a small pale pill pushed to the right edge**, with nothing on the left. The fill is the light brand teal with dark text, which reads as disabled.
4. **Placeholders read as values.** `placeholder:text-muted-foreground` is `#57534E`, nearly the input text colour, so "Aisyah Putri" looks already filled in.

**`/pendaftaran/[token]`**
5. **A different look from `/daftar`**: hard-coded emerald greens, a plain "T" circle in the header instead of the school logo, green-tinted page background. A parent who clicks from `/daftar`'s email lands in what looks like another product.
6. **The 7-step stepper wraps to 2 rows on tablet and 3 on phone**, so the form starts far down the page and the pills look like a tag cloud.
7. **Same pale CTA and same dim placeholders** as above; the disabled `Kembali` on step 1 is a ghost box.

## Spec

- [ ] Gender tiles are full-width cells of an equal two-column grid at every viewport; nothing overflows the card at 390 (horizontal overflow check = 0).
- [ ] `/daftar` stepper: three equal columns, each label centred under its circle with a connecting rail; done/active/upcoming states stay distinct; labels do not truncate at 390.
- [ ] Primary actions on both forms use a deeper brand teal fill (`bg-primary-text`, white text, ≥ 4.5:1) so they do not read as disabled; the action row is full-width on phones, and on step 1 the lone primary button is not stranded in the right corner (it spans the row; with a Back button the two split the row).
- [ ] Placeholders are visibly lighter than entered text (form-scoped class, shared `Input`/`Textarea` untouched for the dense admin screens) while staying legible.
- [ ] The invite page shell matches `/daftar`: school logo + `TalibWordmark` header, `bg-background`, neutral heading colours, same card, teal accents; no `#0C5C3F` / `emerald-*` left in the invite form or its page.
- [ ] Invite stepper: one compact row. Phone shows "Langkah 3 dari 7 · Data Ibu" with the progress bar; ≥ `sm` shows all seven labels in a single row (horizontally compact, no wrapping at 768). Visited steps stay clickable buttons (≥ 44px hit area on touch), completed steps keep their check.
- [ ] The existing step motion, `data-testid`s, `aria-*` and test hooks keep working; all existing unit and e2e tests pass.
- [ ] Re-verified through the UI at 390 / 768 / 1440, every step of both forms, with before/after screenshots and a zero-overflow check.

**Non-goals**
- What either form collects or submits; validation; consent wording or version.
- The shared `Button`, `Input`, `Field` primitives and the brand tokens (all scoped by `className` on the public forms).
- The admin/teacher/parent portals.
- Re-ordering or merging the 7 invite steps.

**Assumptions**
1. "The pendaftaran murid baru form" is the invite form at `/pendaftaran/[token]`.
2. A deeper teal for the public CTAs is acceptable; the product-wide light-teal `Button` stays everywhere else.
3. Unifying the invite form with `/daftar`'s palette is wanted (it is the same school, same parents).

## Tasks

- [x] **T1 — /daftar form layout.** `app/daftar/client.tsx`. Gender tiles `w-full`, stepper rail with equal columns, CTA colour + action row, placeholder class. *Accept:* the Spec bullets for `/daftar` hold at 390/768/1440; `app/daftar/__tests__` and `e2e/daftar-public.spec.ts` selectors still resolve.
- [x] **T2 — Invite form shell and stepper.** `app/pendaftaran/[token]/page.tsx`, `app/pendaftaran/[token]/client.tsx`. Shell matches `/daftar`, compact stepper, CTA colour + action row, placeholder class, emerald/hex greens replaced by tokens. *Accept:* the Spec bullets for the invite form hold at 390/768/1440; `grep -rE "0C5C3F|emerald-" app/pendaftaran` is empty; existing tests green.
- [x] **T3 — Docs and re-verification.** Verification section (design-system reference, before/after screenshots, overflow results, Playwright status), README touch if the public-page row needs it. *Accept:* `bash scripts/audit-docs.sh` exits 0.

Dependencies: T1 and T2 are independent (disjoint files); T3 last.

## Implementation

- **T1 (`app/daftar/client.tsx`):** gender tiles `w-full min-w-0` in a `grid-cols-2 gap-3`; stepper rebuilt as three equal columns with a connecting rail (replaces the `Progress` bar; `<ol aria-label>` and `aria-current="step"` kept); primary buttons use `bg-primary-text text-white`; step-1 primary spans the row at `sm`+, later steps split Back / primary; placeholders `text-muted-foreground/70` via `cn` (form-scoped, shared `Input`/`Textarea` untouched); WhatsApp placeholder shortened so it is no longer clipped at 390.

- **T2 (`app/pendaftaran/[token]/*`, `components/enrollment/*`):** `Shell` now uses the `/daftar` header (school logo + `TalibWordmark`, `bg-card` / `bg-background`) and neutral heading colours; every `#0C5C3F` / `emerald-*` in the invite form, message card, bring-list, documents step and signature pad replaced by tokens. Stepper rebuilt: below `sm` a "Langkah n dari 7 + step name" line, the bar, and a one-row horizontally scrolling pill strip (current pill recentred); from `sm` a seven-column grid, one row at 768. Visited steps stay real buttons (focus ring, 44px touch hit area); completed steps keep the animated check. Action row is a two-column grid at every width; no Back on step 1 and its primary spans the row. Primary buttons (`Lanjut`, `Kirim Formulir`, `Unggah`, `Simpan tanda tangan`) use `bg-primary-text text-white`. Placeholders `text-muted-foreground/60`. Orphan fields paired (`Bahasa`, `Penghasilan`, `Perumahan` span two columns); sibling counts split into a 3 + 2 grid. `client-validation.test.tsx` updated for the absent Back on step 1.

## Verification

- design-system: `/daftar` checked against the tokens in `design-system.html` (brand `primary-text` fill, `border-border` rail, card radius unchanged). Screenshots of steps 1 (empty, filled, error), 2 and 3 at 390 / 768 / 1440 viewed; horizontal overflow 0 on every step; `npx vitest run app/daftar` 15/15.
- design-system: invite form re-checked against the same tokens after T2. Production build (`npm run build`, dummy env) served locally and every step (1-7) of the invite form plus steps 1-3 of `/daftar` screenshotted at 390 / 768 / 1440 through the real client components (temporary preview routes with fake props, deleted before commit). Horizontal overflow 0 at all three widths. Before/after pairs for the owner's complaints: gender tiles now fill their cells and sit inside the card at 390; stepper labels centred under their circles; primary buttons read as actions; placeholders read as placeholders; the invite form shares `/daftar`'s header and palette; the 7-step stepper is one row at 768 and one scrolling row on a phone.
- Not covered: the real invite page for a live token (needs Postgres, unavailable in this sandbox) — the preview harness renders the same `PendaftaranClient`; the page `Shell` change is covered by the harness mirror and CI build.
- Unit: `npx vitest run app/daftar app/pendaftaran components/enrollment` 137/137; `npm run lint` 0 errors; `tsc` clean; `grep -rE "0C5C3F|emerald-" app/pendaftaran components/enrollment` empty. Full suite: 567 files, 5710 tests pass.
- Playwright: not run locally (the sandbox has no Postgres for the production build with demo data); deferred to the required CI `Playwright E2E` check.

## Ship Notes

- No migration, no env var, no dependency. Pure presentation change in two public forms plus two enrollment components.
- Rollback: revert the PR; nothing is stored differently.
- The shared `Button`, `Input`, `Field` and brand tokens are untouched; the deeper teal is applied per button via `bg-primary-text`.
