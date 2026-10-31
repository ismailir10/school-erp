# Color Standard + Brand Tokens

> Loaded on demand by `/build` when staged paths match `app/globals.css` (the `@theme` block), className edits touching `bg-status-*` / `text-status-*`, or files containing arbitrary-color classNames (`text-[#…]`, `bg-[#…]`, `border-[#…]`).

`app/globals.css` is the single source of truth (`:root` holds values, `@theme inline` exposes them as utilities). This file and `design-system.html` follow it, never the reverse. `lib/__tests__/design-token-guard.test.ts` fails on raw palette classes (`bg-red-500`), arbitrary hex/rgb classNames, `hsl(var(--…))` around hex tokens, and semantic opacity tints (`bg-success/10`, `bg-warning/10`, `bg-destructive/10`) outside `components/ui`.

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
| Text on a tint | the `-text` token | the base token (fails AA) or a copied hex (the present text darkened `#00875A` → `#00704A` once; hardcoded copies stayed at 4.16:1) |
| Brand teal as text/glyph on a light or tinted surface | `text-primary-text` | `text-primary` (2.36:1 on white) |
| Pill or tone | `<Badge variant="success\|warning\|info\|danger\|neutral">`, `<StatusBadge>` | `<Badge className="bg-status-…">`, hand-rolled `<span rounded-full …>` |

## Semantic triads

Each semantic colour has base / `-subtle` / `-text`. Base is a fill (dot, bar, icon, border); `-subtle` is an opaque tint surface; `-text` is the AA ink for text on that tint. The triads alias the `status-*` tiers where the meaning matches, so one hue has one definition. Light-only values below are in `globals.css`.

| Triad | Base | `-subtle` | `-text` | For |
|---|---|---|---|---|
| `success` (= `status-present`) | `#00B37E` | `#E6F9F1` | `#00704A` — 5.14:1 on tint, 5.62:1 on white | Done, paid, present, positive trend |
| `warning` (= `status-late`) | `#FF8C00` | `#FFF4E6` | `#A35000` — 5.22:1 on tint | Needs attention, late, pending |
| `info` (= `status-leave`) | `#0EA5E9` | `#E0F2FE` | `#0369A1` | Neutral-informational, leave |
| `destructive` (= `status-absent` tints) | `#DC2626` — 4.83:1 on white | `#FFE6E6` | `#CC0000` — 4.97:1 on tint (base is only 4.07:1 there) | Errors, delete, overdue, absent |

`status-absent` (`#FF3B3B`) is the attendance dot/bar colour only. It is about 3.5:1 on white, so it is never text. `holiday` and `no-checkout` have their own base/`-subtle`/`-text` (`no-checkout-text` is `#A35000`). `primary-text` (`#2F7A7D`) is 5.00:1 on white and 4.63:1 on `bg-primary/10`; `primary` itself (`#5DB4B8`) takes dark ink (`primary-foreground` `#173536`).

## Celebration tokens

Distinct from per-row PAID green. Use for "all clear" states: zero outstanding tagihan, full attendance week, full rubric pass. Warm, not an alert.

| Need | Use |
|---|---|
| Background | `bg-celebration-gold-subtle` (`#FFF8E1`) |
| Accent border | `border-celebration-gold` (`#D4A017`) |
| Text | `text-celebration-gold-text` (`#8A6B00`, AA on the tint) |

Aliases sit in the `@theme inline` block of `app/globals.css`; className utilities only.

## Brand

| Token | Value |
|-------|-------|
| `primary` | `#5DB4B8` (teal) |
| `sidebar` | `#1A2E2F` (dark teal) |
| `destructive` | `#DC2626` (AA-darkened from the original `#FF3B3B` brand red) |
| `success` / `warning` / `info` | `#00B37E` / `#FF8C00` / `#0EA5E9` |
| `celebration-gold` | `#D4A017` |
