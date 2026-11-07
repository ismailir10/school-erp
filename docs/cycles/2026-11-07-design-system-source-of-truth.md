# Design system — one source of truth, no contradictions

## Context

The product owner asked for a design-system audit and a proposal ("I want consistency, a good UI standard and design
system"). Four read-only audits (token bypass, reference drift, standards coherence, component consistency) found
the code layer healthy and the documentation layer contradictory.

Facts (looked up, not asked):
- **Code hygiene is good.** Zero raw palette classes and zero hex colours in TSX; Lucide only; EmptyState, Skeleton,
  ErrorState, StatusBadge widely used. `design-token-guard.test.ts` (rules A–G) already enforces colours, spinners,
  easing and number formatting, and already keeps the served reference HTML byte-identical to the governance copy.
- **The standards contradict each other.** Page title: `ui.md` says the heading token carries its own weight and
  forbids adding one; `portal.md` says `text-2xl font-semibold`; the admin and detail page headers add `font-bold`,
  overriding the token's 600. `patterns.md` names `AlertDialog` (banned by `ui.md` in favour of `ConfirmDialog`) and
  bare `toast.error` (banned in favour of `toastError`). `patterns.md` says soft deletes get an undo toast; `crud.md`
  says deactivate gets a ConfirmDialog. `portal.md` prescribes raw `p-4`/`px-5` spacing that `ui.md` forbids.
  `patterns.md` miscounts its own recipes ("six") and pitfalls ("three" vs `ui.md`'s "four").
- **Token values are hand-copied** into `ui.md`, `colors.md`, the reference HTML and `globals.css`. They match today;
  nothing checks the HTML or the docs against the code.
- **The reference HTML has drifted from the product:** it documents a dark palette (the product is light-only by
  the 2026-10-29 tokens-v2 decision), draws 36px buttons (code: 32px on a mouse, 44px floor on touch), shows the page
  title at display size and bold, declares `--primary-hover` (not a real token), still carries a "proposed addition"
  note for tokens that now exist and a stale roadmap section, and does not mention 31 of the 75 `components/ui` files.
- **Explicit heading weights:** ~12 product files and ~20 deck mocks add `font-bold`/`font-semibold` next to
  `text-h1`/`text-h2`/`text-display`. 21 icons in 7 files still use `h-N w-N` instead of `size-N`.
- **Gaps:** no written rule for icon sizes, chart colour order, breakpoints or the focus ring.
- The in-app design-system page links to the old repository name on GitHub.

No UAT report overlaps (the newest are flow reports, not visual-system audits). Prior cycle:
`docs/cycles/2026-10-29-design-tokens-v2.md` (made `globals.css` the source of truth, light-only, complete heading
tokens) — this cycle finishes that job for the docs and the reference.

## Decisions

Taken with the product owner ("go with your recommendations").

1. **Code owns values; docs own rules.** `globals.css` is the only place a token value is written by hand. The
   standards list token *names and purpose* and link to `globals.css`. The reference HTML keeps its own `:root` (it
   is a standalone page), and a guard test fails when any token it shares with `globals.css` has a different value.
2. **Light-only, everywhere.** The dark palette and theme toggle leave the reference. A future dark cycle adds a
   `.dark` block to `globals.css` first, then documents it.
3. **The page title is `text-h1` with the token's own weight (600).** No caller adds a weight to `text-h1`, `text-h2`
   or `text-display`; a guard rule enforces it. Admin titles go from bold to semibold — a deliberate visible change.
4. **Buttons: 32px on a mouse, 44px floor on touch** — what the primitives already do. The reference is corrected
   to show both.
5. **`ui.md` wins on conflict.** `portal.md`, `patterns.md` and `crud.md` keep only rules specific to them and link
   to `ui.md` for shared ones.
6. **Undo vs confirm, stated precisely.** In-flow reversible edits (marking, removing a row being edited) use an
   undo toast; deactivating or deleting a master record uses `ConfirmDialog`, which is what the 53 call sites do.
   Migrating master-record deactivation to undo is a separate product decision, not this cycle.
7. **The two reference copies stay.** The served copy and the governance copy are already kept identical by the guard
   test, and ~25 files cite the governance path; deleting one buys nothing.
8. **Every `components/ui` file is listed in the reference.** A component inventory section, enforced by a test, so a
   new primitive cannot ship undocumented.
9. **A design critique of the key screens runs in verify.** Token- and standards-level inconsistencies it finds are
   fixed here; component-level consolidation (two page headers, stat-card vs stat-tile, hand-rolled pills, raw
   `<select>`/`<button>`) is cycle B.
10. **Branch.** The cloud session is pinned to `claude/dazzling-clarke-lkrspq` (branched from `origin/staging`), used
    instead of `feat/<slug>`; the container is the isolation.

## Acceptance criteria

- [ ] No standards doc contradicts another on page title, spacing, confirm dialogs, toasts or undo-vs-confirm.
- [ ] No standards doc writes a token value by hand (colour hex, rem size) except brand colours named as brand facts in
      `colors.md`, which the guard test checks against `globals.css`.
- [ ] `ui.md` has rules for icon sizes, chart colour order, breakpoints and the focus ring.
- [ ] The reference shows no dark palette or theme toggle, no `--primary-hover`, no stale "proposed"/roadmap notes,
      the page title at `text-h1`/600, and buttons at 32px mouse / 44px touch.
- [ ] The reference lists every `components/ui` file with a one-line purpose.
- [ ] Guard tests fail on: an explicit weight on a heading token; importing `AlertDialog` outside `ConfirmDialog`;
      `z-[…]` or `shadow-[…]` outside `components/ui`; square `h-N w-N`; a token value in the reference that differs
      from `globals.css`; a `components/ui` file missing from the reference.
- [ ] Admin, teacher and parent page titles all render at the same size and weight.
- [ ] The in-app design-system page links to the current repository.

## Verify flows

1. **Admin page titles.** `u_school_admin` → `/admin`, `/admin/students`, one student detail. Title is 24px, weight
   600, identical across the three; nothing else on the page moved.
2. **Portal page titles.** `u_teacher` → `/teacher`; `u_rightjet` (parent) → `/parent`. Title size/weight matches admin.
3. **Reference page.** `u_super_admin` → `/admin/design-system`. Reference renders; no dark toggle; component inventory
   lists every primitive; button specimens show 32px and the 44px touch note.
4. **Touch edge case.** 390px mobile emulation, `/admin/students`: buttons are ≥ 44px tall.
5. **Error case.** Introduce `text-h1 font-bold` in a scratch file under `app/` → the guard test fails naming it;
   remove → green.

Data: the seeded demo users; no new data.

## UX notes

No flow changes; 0 taps added or removed. The only visible product change is admin/detail page titles moving from
bold (700) to semibold (600) so every portal matches.

## Test seams

- Vitest: `lib/__tests__/design-token-guard.test.ts` (new rules H–K, reference parity, inventory coverage, each with
  a positive and negative unit case like the existing rules).
- Playwright (local): `e2e/design-system.spec.ts`, `e2e/mobile-layout.spec.ts`, plus the full suite in verify-local.

## Non-goals

- Component consolidation (page headers, stat cards, section labels, pills, raw controls) — cycle B.
- A dark theme.
- Replacing raw `<input type="date">` (14 sites, partly intentional for native mobile pickers).
- Migrating master-record deactivation from confirm to undo.
- The arbitrary pixel sizes inside `components/deck` mock slides.

## Assumptions

1. The heading weight rule flags `font-bold` and `font-semibold`; `font-medium` on `text-h2` (billing wizard numbers)
   is a deliberate lighter weight and stays allowed.
2. Deck mock slides follow the same heading rule, since they depict the real page header.
3. `components/ui` (vendored shadcn) keeps its single `z-[…]` and `shadow-[…]`.
4. Where `portal.md` spacing and the code disagree with `ui.md`, the docs are corrected to what the portal layouts
   actually render.

## Gate re-openers

None. No schema, dependency, auth, PII, production write or paid API.

## Tasks

- [ ] T1 Guard rule H (no explicit weight on heading tokens) + fix every offender — accept: rule unit cases pass,
      tree scan green, admin/detail/teacher/deck headings use the token weight (deps: none)
- [ ] T2 Guard rules I (AlertDialog only inside ConfirmDialog), J (no `z-[`/`shadow-[` outside `components/ui`),
      K (`size-N` not `h-N w-N`) + migrate the 21 icon sites — accept: unit cases + tree scan green (deps: T1, same file)
- [ ] T3 Standards: resolve the contradictions, strip hand-copied values to names + purpose, add icon / chart /
      breakpoint / focus-ring rules, fix stale counts — accept: a re-run of the coherence audit finds no
      contradiction (parallel with T1–T2)
- [ ] T4 Reference HTML (both copies): drop dark palette, fix title/button specimens, remove `--primary-hover` and
      stale notes, add the component inventory; guard tests for value parity and inventory coverage; fix the repo
      link on the in-app page — accept: tests green, `/admin/design-system` renders (deps: T3 wording)
- [ ] T5 Design critique of key screens (admin, teacher, parent, reference) at 390 and 1440 — accept: token/standards
      findings fixed or recorded; component findings listed for cycle B (deps: T1–T4)

## Implementation

## Verification

## Ship Notes
