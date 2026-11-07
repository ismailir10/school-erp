# Color Standard + Brand Tokens

> Loaded on demand by `/build` when staged paths match `app/globals.css` (the `@theme` block), className edits touching `bg-status-*` / `text-status-*`, or files containing arbitrary-color classNames (`text-[#…]`, `bg-[#…]`, `border-[#…]`).

`app/globals.css` is the single source of truth (`:root` holds values, `@theme inline` exposes them as utilities). This file and `design-system.html` follow it, never the reverse. Values live in `app/globals.css` (`@theme` and `:root`); this file names tokens and says when to use them. The colour bans (palette classes, arbitrary hex/rgb, `hsl(var(--…))`, semantic opacity tints) are guard rules A, B, C and E (see `ui.md` § Guard rules).

**Light-only: no dark theme; dormant shadcn `dark:` variants stay so a future cycle only adds a `.dark` block.**

## Color Standard

**Never hardcode a colour.** Use the token utility; never a hex, an opacity tint of a semantic colour, or inline `style={{}}`.

| Need | Use | NEVER |
|------|-----|-------|
| Success/present | `text-status-present-text`, `bg-status-present-subtle`; `bg-status-present` for a dot or bar | `text-[#00B37E]` |
| Warning/late | `text-warning-text` on `bg-warning-subtle` | `text-[#FF8C00]`, `bg-warning/10` |
| Error text, delete actions | `text-destructive` (AA on white) | `text-status-absent` (see below), `text-[#FF3B3B]` |
| Error tint | `bg-destructive-subtle` + `text-destructive-text` | `bg-destructive/10` |
| Leave/info | `text-info-text` on `bg-info-subtle` | `text-[#0EA5E9]` |
| Text on a tint | the `-text` token | the base token (fails AA) or a copied hex (hardcoded copies stayed stale when the `-text` token was darkened once) |
| Brand teal as text/glyph on a light or tinted surface | `text-primary-text` | `text-primary` (fails AA on white) |
| Pill or tone | `<Badge>` variants, `<StatusBadge>` (see `ui.md` § Reach for) | `<Badge className="bg-status-…">`, hand-rolled `<span rounded-full …>` |

## Semantic triads

Each semantic colour has base / `-subtle` / `-text`. Base is a fill (dot, bar, icon, border); `-subtle` is an opaque tint surface; `-text` is the AA ink for text on that tint. The triads alias the `status-*` tiers where the meaning matches, so one hue has one definition. Values live in `app/globals.css` (`@theme` and `:root`).

| Triad | Tokens | For |
|---|---|---|
| `success` (= `status-present`) | `success`, `success-subtle`, `success-text` | Done, paid, present, positive trend |
| `warning` (= `status-late`) | `warning`, `warning-subtle`, `warning-text` | Needs attention, late, pending |
| `info` (= `status-leave`) | `info`, `info-subtle`, `info-text` | Neutral-informational, leave |
| `destructive` (= `status-absent` tints) | `destructive`, `destructive-subtle`, `destructive-text` | Errors, delete, overdue, absent |

Contrast rules that are not obvious from the names: `destructive` (not `status-absent`) is the text and delete-action red, and on its pink tint only `destructive-text` passes AA. `status-absent` is the attendance dot/bar colour only and is never text. `holiday` and `no-checkout` have their own base / `-subtle` / `-text`. `primary-text` is the AA teal for text on light surfaces; `primary` itself is a fill that takes dark ink (`primary-foreground`).

## Celebration tokens

Distinct from per-row PAID green. Use for "all clear" states: zero outstanding tagihan, full attendance week, full rubric pass. Warm, not an alert.

| Need | Use |
|---|---|
| Background | `bg-celebration-gold-subtle` |
| Accent border | `border-celebration-gold` |
| Text | `text-celebration-gold-text` (AA on the tint) |

Aliases sit in the `@theme inline` block of `app/globals.css`; className utilities only.

## Brand facts

The only hand-written colour values in the standards. Each is checked against `app/globals.css`; the code wins if they ever differ.

| Token | Value |
|-------|-------|
| `primary` | `#5DB4B8` (teal) |
| `sidebar` | `#1A2E2F` (dark teal) |
| `destructive` | `#DC2626` (AA-darkened from the original `#FF3B3B` brand red) |
| `success` / `warning` / `info` | `#00B37E` / `#FF8C00` / `#0EA5E9` |
| `celebration-gold` | `#D4A017` |

Chart series colours (`--chart-1` … `--chart-5`, status tokens for status charts) are in `ui.md` § Chart colours.
