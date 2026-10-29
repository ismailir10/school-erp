# Design tokens v2 — complete token families, shared primitives, one source of truth

## Context

The product owner asked for design tokens and UI/UX that are reusable, consistent and scalable, plus an audit and
refinement of `ui.md` and the design-system reference. Three read-only audits (token layer, hardcoded-value sweep,
component reuse) found the colour hygiene already good and the drift elsewhere:

Facts (looked up, not asked):
- **Colour:** zero raw Tailwind palette classes and almost no hex in TSX. The `status-*` family has base / `-subtle` /
  `-text` tiers, but `success` / `warning` / `info` / `destructive` are single values, so the admin stat card fakes
  tints with `bg-success/10` opacity hacks and pages hand-roll `bg-warning/10 text-warning` pills.
- **Dead or drifted tokens:** `--status-no-checkout-text` is defined but the badge uses `status-late-text` instead;
  `--warning-highlight`, `--motif-opacity` and `--color-info` have no users. The error red disagrees three ways:
  `globals.css` `--destructive` is `#DC2626` (darkened for AA), `design-system.html` says `#E63946`, `colors.md` says
  `#FF3B3B`. `colors.md` cites stale line numbers. `sidebar.tsx` wraps hex vars in `hsl(var(--sidebar-border))`, which
  is invalid CSS, so that ring never renders.
- **No motion tokens:** `cubic-bezier(0.22,1,0.36,1)` is copy-pasted in `globals.css` and four TSX files; durations
  are ad hoc.
- **Elevation:** two shadow tokens; three identical arbitrary sticky-column shadows
  (`shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.12)]`) on the monthly employee-attendance grid.
- **Type tokens set size only:** `text-h1` / `text-h2` / `text-display` carry no line-height or weight, so every caller
  re-adds `font-semibold` and the heading leading drifts.
- **Hand-rolled patterns despite a primitive:**
  - ~18 hand-rolled count/state pills plus 6 `Badge` colour overrides, because `Badge` has no semantic tones.
  - The `Spinner` primitive has zero imports, while 9 files hand-roll `Loader2 animate-spin` (no reduced-motion
    handling, inconsistent `aria`).
  - 6 `error.tsx` boundaries each hand-write their own error block.
  - 8 hand-rolled initials circles exist next to `Avatar`.
  - ~10 hand-rolled `ArrowLeft` back links exist next to `BackLink`.
  - ~28 files hand-roll a bordered section card (`rounded-xl border bg-card p-4`) next to `Card`.
- **Dark mode:** no `.dark` block exists and nothing applies the class. The `dark:` variants in the shadcn primitives
  are dormant. The product is light-only in practice.
- **Docs:** `ui.md`'s token table omits radius, elevation, celebration and `primary-text`. `design-system.html`'s
  `:root` lacks a dozen tokens `globals.css` has, and has one (`--primary-hover`) that `globals.css` does not.
- Already good, untouched: PageHeader (every portal page), EmptyState, Skeleton, ConfirmDialog, StatusBadge,
  `formatRupiah`.

No UAT report overlaps (the newest are flow reports, not visual-system audits).

## Decisions

Taken on the product owner's behalf ("proceed with your best judgement"); each is cheap to reverse.

1. **`globals.css` is the single source of truth.** Docs and `design-system.html` are corrected to match the code,
   never the other way round. The AA-darkened `#DC2626` stays the destructive red.
2. **Light-only, stated.** No dark theme this cycle; `colors.md` says so explicitly. The dormant shadcn `dark:`
   variants stay (vendored primitives, harmless), so a future dark cycle only adds a `.dark` block.
3. **Every semantic colour gets the status triad.** `success` / `warning` / `info` / `destructive` each gain `-subtle`
   (tint background) and `-text` (AA text on that tint), aliased to the existing status values where the meaning
   matches. No new hues.
4. **`Badge` gains semantic tones** (`success`, `warning`, `info`, `danger`, `neutral`) as cva variants on the existing
   component. `StatusBadge` stays the domain mapper (enum → label + tone); `Badge` is the visual primitive.
5. **Motion, z-index and elevation become Tailwind theme tokens** (`ease-*`, `duration-*`, `z-*`, `shadow-*`), so the
   utilities read `ease-emphasized`, `z-sticky`, `shadow-sticky-edge`. Shadcn overlay primitives keep `z-50` (a
   shared upstream convention) and the scale is defined so `z-overlay` equals it.
6. **Type tokens carry line-height and weight** (`text-h1` and `text-h2` become complete headings). The mass
   retrofit of `text-sm` / `text-xs` to `text-body` / `text-small` is out: identical size, huge churn, no visible
   change.
7. **New shared primitives only where the audit counted repetition**: `SectionCard`, `ErrorState`, `UserAvatar`.
   Each migrates its hand-rolled call sites in the same task.
8. **A guard test keeps it true.** A Vitest suite fails on raw palette classes, arbitrary hex colours in classNames,
   `hsl(var(--…))` around hex tokens, and `Loader2 … animate-spin` outside `Spinner`. That makes the rules scale
   without relying on review.

## Acceptance criteria

- [ ] `success`, `warning`, `info` and `destructive` each have base, `-subtle` and `-text` utilities. The admin stat
      card uses them, and no `bg-<semantic>/10` opacity hack remains in `components/` or `app/`.
- [ ] Motion (`ease-standard`, `ease-emphasized`, `duration-fast|base|slow`), z-index (`z-base`, `z-sticky`,
      `z-dropdown`, `z-overlay`, `z-toast`) and elevation (`shadow-resting`, `shadow-raised`, `shadow-overlay`,
      `shadow-sticky-edge`) exist as theme tokens. The duplicated cubic-bezier and the arbitrary sticky shadows are
      replaced by them.
- [ ] `text-h1`, `text-h2` and `text-display` render with their own line-height and weight.
- [ ] Dead tokens are removed or wired. The sidebar ring renders: no `hsl(var(--sidebar-…))` remains.
- [ ] `Badge` supports `success`, `warning`, `info`, `danger` and `neutral`. The hand-rolled pills and the `Badge`
      colour overrides found by the audit use it, and look the same or better.
- [ ] Every loading spinner in `app/` and `components/` goes through `Spinner`, which respects reduced motion and is
      announced to screen readers.
- [ ] All six route error boundaries render a shared `ErrorState` with a retry action. Initials circles use
      `UserAvatar`, and hand-rolled back links use `BackLink`.
- [ ] Hand-rolled bordered section cards in the parent portal and admin components use `SectionCard`, with no layout
      regression on phone or desktop.
- [ ] `colors.md`, `ui.md` and `design-system.html` agree with `globals.css`: one destructive red, a complete token
      table, the new primitives documented, and light-only stated.
- [ ] The guard test fails on a planted violation and passes on the tree.
- [ ] Full gate is green: lint, Vitest, RLS/API-auth guards, `DEMO_MODE` build and Playwright.

## Verify flows

1. **Admin, desktop 1440.** Dashboard: stat-card tones read clearly, with no washed-out tints. Open a student detail:
   the count pills and documents badges use the new tones. Open HR → employee attendance → monthly: the sticky name
   column still shows its edge shadow while scrolling horizontally.
2. **Parent, phone 390.** Home → Kehadiran → Tagihan → invoice detail sheet: section cards are consistent (same
   radius, border and padding), nothing is clipped, and there is no horizontal scroll.
3. **Teacher, phone 390.** Daily flow pages and the student-journal: back links, loading states and spinners behave
   the same as before.
4. **Error case:** force a route error (an unknown id on an error-bounded route). `ErrorState` shows the message and a
   working "Coba lagi".
5. **Edge case:** reduced motion is enabled (Playwright `reducedMotion: 'reduce'`) and the spinner does not spin.

## UX notes

No copy changes beyond `ErrorState`, which keeps each boundary's existing Indonesian message and uses the "Coba lagi"
label from `voice.md`. The visual change is intentional but small: tints get crisper (opaque subtle tokens instead of
10% opacity), headings get consistent leading, and pills look the same everywhere.

## Test seams

- Vitest: `Badge` tone classes, `Spinner` a11y and reduced motion, `ErrorState` retry, `UserAvatar` initials,
  `SectionCard` slots, and the design-token guard suite.
- Playwright: the existing cross-module suite (admin dashboard, students, invoices, attendance, teacher daily, parent)
  is the regression net. No new spec, since the change is visual and has no new flow.
- Screenshots: before/after at 1440 and 390 for the flows above.

## Non-goals

- Dark theme (Decision 2).
- Retrofitting `text-sm` / `text-xs` to semantic size tokens across ~1,000 call sites (Decision 6).
- Merging `StatCard` and `StatTile`, reworking date formatting into `lib/format.ts`, and any change to page structure,
  copy or flows.
- Editing vendored `better-*` or workflow skills.

## Assumptions

1. Visual deltas from the opaque `-subtle` tints and the heading line-heights are acceptable without a per-screen
   sign-off.
2. Re-pointing shadcn's `z-50` to the `z-overlay` token is not needed; documenting the equivalence suffices.
3. `chart-1..5` stay: they belong to the shadcn chart contract even if unused today.

## Gate re-openers

None: no schema, no dependency, no auth/PII, no production write.

## Tasks

- [x] T1 Token layer — accept: the new families, motion, z-index, elevation and type pairings exist in `globals.css`;
      dead tokens are handled; the sidebar bug is fixed; the stat card and sticky shadows are migrated; build is green.
      (deps: none)
- [x] T2 Badge semantic tones and pill migration — accept: Badge tone test; the audit's pills and overrides are
      migrated. (deps: T1)
- [x] T3 Spinner everywhere — accept: Spinner a11y/reduced-motion test; no `Loader2 animate-spin` outside Spinner.
      (deps: none, parallel)
- [x] T4 ErrorState, UserAvatar, BackLink consolidation — accept: component tests; six boundaries, eight avatars and
      the back links migrated. (deps: none, parallel)
- [x] T5 SectionCard and card migration — accept: SectionCard test; parent and admin hand-rolled cards migrated.
      (deps: T1)
- [x] T6 Design-token guard test — accept: it fails on a planted violation and passes on the tree. (deps: T1–T5)
- [x] T7 Docs: `colors.md`, `ui.md`, `design-system.html` reconciled and refined — accept: the tables match
      `globals.css` and the new primitives are documented. (deps: T1–T5)

## Implementation

- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5-5 (implementation, docs) + claude-haiku (sweeps); T1, T3, T4 parallel (wave 1); T7 parallel with the wave-1 gate (docs only); T2, T5 parallel (wave 2, need T1 tokens); T6 last (guards the finished tree). Workers share one worktree on disjoint file sets; a file touched by two workers is committed with the earlier task.
- T1: `app/globals.css`, `lib/motion.ts`, the sidebar/status-badge/data-table primitives, stat card, portal chrome, reactbits motion, and the heading call sites. Adds the semantic triads, motion/z-index/elevation tokens and type line-height/weight pairings. Driver fixes on review: elevation values moved to `--elevation-*` because the `@theme` alias `--shadow-resting: var(--shadow-resting)` referenced itself, and the amber ink was darkened to `#A35000` for `status-late-text` and `status-no-checkout-text` too (`#B35C00` was 4.35:1 on its tint, under AA).
- T3: `components/ui/spinner.tsx` (role=status + "Memuat" label, `aria-hidden` mode next to visible text, `motion-reduce:animate-none`) + 4 tests; 15 call sites migrated off hand-rolled `Loader2`/`RefreshCw animate-spin`. No `animate-spin` remains outside the primitive.
- T4: new `ErrorState` (role=alert, "Coba lagi" retry) in all six `error.tsx` boundaries; new `UserAvatar` + `getInitials` replacing eight hand-rolled initials circles and two local helpers (photos keep `loading="lazy"`); three admin semester pages moved to `BackLink`. Left: `class-day-grid` (state-swapping circle), `portal-header` (`size-7`), `raport-editor` BackBar (callback, not a link), `detail-page-header` (unsaved-changes guard). Retry label unified to "Coba lagi" per `voice.md`.
- T7: `colors.md` rewritten against `globals.css` (one destructive red `#DC2626`, semantic-triad table with AA ratios, light-only stated, stale line refs gone); `ui.md` audited, 255 → 254 lines, with a complete Design tokens table (spacing, type pairings, radius, elevation, motion, z-index) and a "Reach for" primitives table replacing scattered rows and stale claims; `design-system.html` `:root` synced to `globals.css` plus triad, elevation/motion/z-index, Badge-tone and shared-primitive cards. `--primary-hover` kept as doc-only (the HTML's hover demo uses it).
- T6: `lib/__tests__/design-token-guard.test.ts` — static scan of `app/` and `components/` for six rules (raw palette, arbitrary colour, `hsl(var(--`, stray spinner, semantic opacity tint outside `components/ui`, duplicated easing literal), each with a planted-violation self-test; the allowlist is empty and fails if an entry goes stale. Its first run caught three `ease-[cubic-bezier(0.22,1,0.36,1)]` in `navigation-menu.tsx`, now `ease-emphasized`.
- T5: new `SectionCard` (`section` labelled by its `text-h2` title, description/action/footer slots, `p-4 md:p-card` matching the hand-rolled blocks) + 3 tests; 9 blocks migrated (parent attendance and invoices ×5, admin enrollment ×3, admin student-journal ×1). Skipped by design: celebration-tinted callouts, clickable/list cards, widgets, skeletons, stat tiles and the public `rounded-2xl` enrollment recipe.
- T2: `Badge` gains `success`/`warning`/`info`/`danger`/`neutral` (and its `destructive` tint now uses the `-subtle` token) + tests; 22 hand-rolled pills and `Badge className="bg-status-…"` overrides migrated; `bg-*/5` semantic tints outside `components/ui` swapped to `-subtle`. The worker found that `cn()` (tailwind-merge) read `text-caption` as a colour and dropped `text-muted-foreground`. The driver fixed it at the source by registering the size, shadow and z-index tokens with `extendTailwindMerge` in `lib/utils.ts`, added `lib/__tests__/cn-tokens.test.ts`, and noted the rule in `ui.md`. StatusBadge is unchanged: its tests pin the `status-*` classes and it has tones that Badge lacks.
- Verify round 1 (driver review of before/after screenshots):
  - **Initials:** `getInitials` now uses the first and last word. The parent header showed "SH" before and "SN" after, because the worker used the first two words; first + last was the only existing two-letter rule.
  - **`cn()` call sites:** fixing `cn()` would have changed 156 class strings. A Sonnet worker found 149 never reach tailwind-merge (DOM elements, `next/link`). In the other 10 call sites the size token had always been dropped, so it was removed. They now say what users actually saw, and rendering is unchanged.
  - **Reference copy:** `/admin/design-system` iframes `public/admin/design-system-reference.html`, which had fallen a version behind the canonical HTML. It is synced, and the guard suite now fails if the two copies differ.

## Verification

## Ship Notes
