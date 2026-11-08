# Design system B — one component per job, one tone rule, visual principles

## Context

Cycle A (`docs/cycles/2026-11-07-design-system-source-of-truth.md`) made the docs and the reference agree with the
code. Its design critique, plus two audits this cycle, found duplicate components and inconsistent tone. The product
owner asked to continue with cycle B. They also flagged the soft-red logout confirm as possibly inconsistent, and asked
to adopt Figma's graphic design principles into the standard without bloating it.

Facts (looked up, not asked):
- **Logout is three different things.** Admin logs out in one tap from the sidebar, with no confirm. The teacher and
  parent header icon opens a destructive-toned ConfirmDialog ("Yakin ingin keluar?"). The parent profile page shows a
  soft-red button and then a second destructive confirm. `ui.md` says destructive is "for the irreversible ones", and
  logout loses nothing. The "soft red" is the Button `destructive` variant (`bg-destructive/10 text-destructive`), which
  ConfirmDialog uses for its confirm action. So an irreversible delete looks no stronger than a trigger.
- **ConfirmDialog tone audit:** 69 usages; 14 destructive. Non-irreversible ones in red: the two logouts. Borderline:
  "Tarik penerbitan rapor?" (unpublish, reversibility to verify), "Hitung ulang draf ini?" (wipes manual edits →
  irreversible) and "Keluar tanpa menyimpan?" (loses edits → irreversible).
- **Back navigation is doubled.** The admin layout renders a breadcrumb above every page. About 15 detail pages also
  render DetailPageHeader's 44px "Kembali ke …" link, and top-level pages show a one-crumb breadcrumb that repeats the
  title. The breadcrumb shows on mobile too.
- **List-page headers have no structured actions.** DetailPageHeader has `primaryActions` (max 2) and a ⋯ `menuActions`.
  The list-page PageHeader takes a free `actions` node, so admin invoices hand-builds six inline buttons on desktop and a
  "Lainnya" menu on mobile. The portal PageHeader is already a thin wrapper over the admin one, so nothing to merge.
- **Two stat components:** StatCard (12 list pages: tall, icon chip, count-up, spotlight) and StatTile (8 dashboard and
  detail uses: compact, tone, optional link, no icon). Same label style, different tone vocabulary (`color` vs `tone`).
- **Two section eyebrows:** SectionLabel (9 portal uses, bold, `mb-2`) and SectionHeading (8 admin uses, semibold,
  `mb-3`, has description and actions). SectionCard is a different job (titled card) and stays.
- **Hand-rolled pills:** about 9 product sites should be Badge or StatusBadge (teacher home pending and sentra tags,
  employee-attendance count, attention strip, parent journal, portal tab count, class-day-grid count, enrollment
  documents, amount). Interactive chips and deck mocks stay.
- **Raw buttons:** attendance calendar prev/next/close and week-navigator prev/next/"Hari ini" should be `Button`. Grid
  cells (calendar days, week-grid cells, class-day indicators) are legitimately custom.
- **Button hierarchy (critique):** student detail shows a filled WhatsApp button competing with Edit. Parent home has a
  filled and an outline button inside one card.
- **No raw `<select>` remains**, so that item is dropped.
- **Figma's 13 principles:** alignment, contrast, balance, hierarchy, colour, white space, proportion, repetition,
  rhythm, movement, emphasis, proximity, unity.

## Decisions

From the product owner's answers. The logout tone was left to judgement ("I just want it consistent… maybe strong red,
I don't know").

1. **Tone follows consequence, two-step.** Red means irreversible data loss, and only that.
   - The trigger for such an action is quiet red (the existing soft `destructive`).
   - The confirm that commits it is **solid red**, a new Button variant used by ConfirmDialog when `destructive`.
   - Everything reversible is neutral, with a primary-teal confirm.

   This gives the user the strong red they sensed was missing, exactly where it means something.
2. **Logout is the same in all three portals:** one neutral confirm ("Keluar dari Talib?", teal "Keluar"), from a
   neutral trigger. Admin gains the confirm, for consistency (+1 tap; see UX notes). The parent profile page drops its
   red button and its second confirm.
3. **One way back.** Detail pages keep the 44px back link. The breadcrumb hides on any page that renders a back link,
   and wherever it would show a single crumb.
4. **List-page headers get the detail header's action model:** at most one filled primary, at most one outline
   secondary visible, the rest in a ⋯ menu. Admin invoices adopts it ("Buat Tagihan" primary).
5. **StatTile is the only stat component.** It gains an optional icon chip and count-up for numbers. The 12 StatCard
   pages migrate and StatCard is deleted.
6. **SectionHeading is the only section eyebrow.** It gains `as` and children, and its style wins (semibold, `mb-3`). The
   9 SectionLabel uses migrate and SectionLabel is deleted.
7. **Pills use Badge (counts and neutral) or StatusBadge (domain status).** Interactive chips and deck mocks are exempt.
8. **Visual principles in `ui.md` as one compact table.** Figma's 13 principles, grouped into 6 rows, each mapped to the
   Talib token, component or rule that enforces it. No essay. The design critique checklist cites the table.
9. **One primary per screen and per card** is applied to the two critique sites (student detail, parent home).
10. **Guard tests** lock the removals: StatCard and SectionLabel imports fail, and a ConfirmDialog whose title mentions
    logging out cannot be `destructive`.

## Acceptance criteria

- [ ] Logout in admin, teacher and parent: same neutral confirm, teal confirm button, no red anywhere in the flow.
- [ ] Every irreversible confirm (delete, discard unsaved, recalculate draft) commits with a solid red button; its
      trigger is quiet red; no reversible action uses red.
- [ ] No admin page shows both a breadcrumb and a back link; no page shows a one-crumb breadcrumb.
- [ ] Admin invoices header shows one filled primary and at most one visible secondary; the rest sit in a ⋯ menu.
- [ ] All stat figures render through one component: same label style, padding and icon rule on dashboard, list and
      detail pages.
- [ ] One section eyebrow style across admin and portals.
- [ ] The ~9 hand-rolled pills render through Badge or StatusBadge.
- [ ] Calendar and week-navigator controls are `Button`s with 44px touch targets.
- [ ] Student detail and parent home each show one filled button per action group.
- [ ] `ui.md` has the visual-principles table; the reference inventory reflects the removed components.

## Verify flows

1. **Logout, each portal.** `u_school_admin` sidebar → Keluar → neutral confirm → teal Keluar → signed out. Same for
   `u_teacher` (header icon) and `u_rightjet` (header icon and profile page). No red anywhere.
2. **Irreversible confirm.** Admin → a deletable record (e.g. a student journal note) → quiet-red trigger → confirm
   dialog with solid red commit. Cancel leaves the record.
3. **Detail page.** Admin → Siswa → a student: back link visible, no breadcrumb; `/admin/students`: breadcrumb shows
   only if it has 2+ crumbs.
4. **Invoices header, 1440 and 390.** One primary ("Buat Tagihan"), the rest in the ⋯ menu; every action still reachable.
5. **Edge.** Admin dashboard and Siswa list at 390: stat tiles share height, label and icon rules; an odd count does not
   orphan a tile.
6. **Error.** A scratch import of StatCard fails the guard test.

## UX notes

- Main tasks unchanged, except two:
  - Admin logout goes from 1 to 2 taps. Accepted, so logout behaves the same in every portal (Decision 2).
  - Invoices secondary actions move from 1 to 2 taps (⋯ then item) on desktop; mobile is unchanged.
    "Buat Tagihan", the frequent action, stays at 1 tap. This applies "one primary action per screen".
- Parent profile logout goes from 2 confirms to 1.

## Test seams

- Vitest:
  - ConfirmDialog renders solid red when `destructive`, primary otherwise;
  - PageHeader action model (primary, secondary, menu);
  - StatTile icon and count-up;
  - SectionHeading `as`;
  - breadcrumb hides on one crumb and when a back link is present;
  - guard rules L (removed components) and M (logout is never destructive).
- Playwright (local): full suite. Logout specs and the admin-dashboard, students and invoices specs cover the flows.

## Non-goals

- Card families and callout variants (critique, medium priority): a later cycle.
- Admin dashboard KPI count and portal nav label glossary: product decisions, raised separately.
- Grid cells' raw buttons; deck mock styling.
- Undo instead of confirm for master-record deactivation.

## Assumptions

1. "Tarik penerbitan rapor" is reversible (it can be republished). If it is, it becomes neutral; if the code shows
   otherwise, it stays red.
2. The solid-red variant uses `bg-destructive text-white`. `#DC2626` on white is 4.8:1, which passes AA.
3. Removing StatCard's spotlight hover effect is acceptable; count-up is kept.

## Gate re-openers

None. The logout flow changes only its confirm UI; the sign-out call and the auth guard are untouched.

## Tasks

- [x] T1 Standards: visual-principles table, tone rule (Decision 1), header/stat/eyebrow rules in `ui.md`; reference
      HTML inventory + tone specimens; guard rules L/M — accept: audit-docs + guard suite green (parallel)
- [ ] T2 Tone: solid-red Button variant, ConfirmDialog uses it; logout neutral confirm in all portals; re-tone the
      reversible confirms — accept: confirm-dialog tests, logout specs green
- [ ] T3 Headers: breadcrumb hide rules; PageHeader primary/secondary/menu actions; invoices adopts it — accept:
      header tests, invoices spec green
- [ ] T4 StatTile only: icon + count-up, migrate 12 StatCard pages, delete StatCard — accept: tests, visual check
      (parallel with T5–T6)
- [ ] T5 SectionHeading only: `as` + children, migrate 9 SectionLabel uses, delete SectionLabel — accept: tests green
- [ ] T6 Pills → Badge/StatusBadge (~9); calendar + week-navigator controls → Button; two hierarchy fixes — accept:
      tests green, 44px targets
- [ ] T7 Verify: full gate, Playwright, design critique re-run on the same 14 screens — accept: proud bar, no new
      findings above low

## Implementation

- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5; parallel workers on disjoint files — W1 T1 (docs +
  reference), W2 T2 (tone + logout), W3 T3 (headers, incl. invoices-client's StatCard so W4 never touches that file),
  W4 T4 (StatTile), W5 T5+T6 (share class-day-grid). Guard rules L/M added by the driver after W4/W5 land (same test
  file, and L can only pass once the removals exist). Workers run targeted Vitest only; the driver runs tsc/build/full
  gate once (memory). T7 sequential at the end.
- T1: `.claude/standards/ui.md` — § Visual principles (Figma's 13 principles in a 6-row table mapped to tokens,
  components and guard rules; critiques check against it), tone rule (red = irreversible loss only; quiet trigger,
  `destructive-solid` commit; deactivate and logout neutral), list/detail header action model, StatTile-only,
  SectionHeading-only, Badge/StatusBadge pills, one filled button per group, guard rules L/M listed;
  `design-system.html` (+ identical public copy) — `destructive-solid` specimen and two-step caption, confirm
  specimen uses it. CLAUDE.md counts regenerated.

## Verification

## Ship Notes
