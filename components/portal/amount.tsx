import type { VariantProps } from "class-variance-authority";

import { Badge, type badgeVariants } from "@/components/ui/badge";
import { formatRupiahParts } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Parent-facing money.
 *
 * Every rupiah figure a wali sees goes through this component so the three
 * surfaces that show the same number — the home Tagihan tile, the Tagihan
 * summary card, and the invoice detail sheet — cannot drift apart again.
 *
 * Three deliberate departures from the previous inline treatment:
 *
 * 1. Brand sans (`.font-amount`), not `.font-currency`. JetBrains Mono is a
 *    code face; at 24–32px bold it read as terminal output. `tabular-nums`
 *    still holds the digit columns, so stacked amounts align without it.
 * 2. Near-black by default. `--status-absent-text` is the attendance Alpa
 *    colour — level-presentation.ts already states that red is reserved for
 *    Alpa and destructive actions, and an unpaid-but-not-yet-due bill is
 *    neither. State is carried by `<AmountStatus>` beside the number, not by
 *    the number itself.
 * 3. "Rp" is demoted — smaller and muted, with a normal space. In the mono
 *    face the symbol sat a full 0.6em space away from the digits, which is
 *    what produced the "Rp   3.802.500" gap.
 */

export type AmountSize = "display" | "row" | "line";

/**
 * `paid` is the one place colour still rides on the number: a settled amount
 * in the Riwayat list is good news and teal reads as such. `overdue` exists
 * for the summary figure when every outstanding invoice is past its due date
 * — the only moment the red is telling the truth.
 */
export type AmountTone = "neutral" | "paid" | "overdue";

const SIZE_CLASS: Record<AmountSize, string> = {
  // Summary + focal figures. No `leading-none` — it clipped descenders in the
  // sans face and left the number visually glued to the label above it.
  display: "text-[1.75rem] font-semibold leading-tight",
  row: "text-[0.9375rem] font-semibold leading-snug",
  line: "text-sm font-medium leading-snug",
};

const SYMBOL_SIZE_CLASS: Record<AmountSize, string> = {
  display: "text-[1.0625rem]",
  row: "text-[0.6875rem]",
  line: "text-[0.6875rem]",
};

const TONE_CLASS: Record<AmountTone, string> = {
  neutral: "text-foreground",
  paid: "text-status-present-text",
  overdue: "text-status-absent-text",
};

export function Amount({
  value,
  size = "row",
  tone = "neutral",
  className,
}: {
  value: number;
  size?: AmountSize;
  tone?: AmountTone;
  className?: string;
}) {
  const { symbol, digits } = formatRupiahParts(value);
  return (
    <span
      className={cn("font-amount whitespace-nowrap", SIZE_CLASS[size], TONE_CLASS[tone], className)}
    >
      <span
        className={cn(
          "mr-1 font-medium text-muted-foreground",
          SYMBOL_SIZE_CLASS[size],
        )}
      >
        {symbol}
      </span>
      {digits}
    </span>
  );
}

export type AmountStatusTone = "due" | "overdue" | "partial" | "paid" | "cancelled";

/**
 * Sentence case, not the previous uppercase-bold eyebrow. Uppercase at the
 * same moment as a large red number gave one fact four shouting signals.
 */
const STATUS_VARIANT: Record<
  AmountStatusTone,
  NonNullable<VariantProps<typeof badgeVariants>["variant"]>
> = {
  due: "neutral",
  overdue: "danger",
  partial: "warning",
  paid: "success",
  cancelled: "neutral",
};

export function AmountStatus({
  tone,
  children,
  className,
}: {
  tone: AmountStatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Badge variant={STATUS_VARIANT[tone]} className={className}>
      {children}
    </Badge>
  );
}

export default Amount;
