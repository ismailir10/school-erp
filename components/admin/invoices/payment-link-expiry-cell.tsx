import { paymentLinkExpiryState } from "@/lib/finance/payment-link-expiry";
import { formatDateTime } from "@/lib/format";

type Props = {
  invoice: {
    status: string;
    xenditPaymentUrl?: string | null;
    paymentLinkExpiresAt?: string | null;
  };
  /**
   * `column` (default): the "Link berlaku" table cell; shows "—" when there is nothing to say.
   * `meta`: the line under the student name below `md`; renders nothing when there is nothing
   * to say, and carries a "Link" prefix since it has no column header.
   */
  variant?: "column" | "meta";
  /** Test seam; defaults to the current time. */
  now?: Date;
};

/**
 * When the invoice's current payment link stops working (cycle
 * 2026-10-20-payment-link-expiry-display, D5-D7). The decision is `paymentLinkExpiryState`,
 * shared with the detail page; this only renders it so the column and the mobile line agree.
 */
export function PaymentLinkExpiryCell({ invoice, variant = "column", now }: Props) {
  const state = paymentLinkExpiryState(
    {
      status: invoice.status,
      xenditPaymentUrl: invoice.xenditPaymentUrl ?? null,
      paymentLinkExpiresAt: invoice.paymentLinkExpiresAt ?? null,
    },
    now,
  );

  if (!state) {
    return variant === "meta" ? null : <span className="text-xs text-muted-foreground">—</span>;
  }

  const when = invoice.paymentLinkExpiresAt ? `${formatDateTime(invoice.paymentLinkExpiresAt)} WIB` : null;
  const prefix = variant === "meta" ? "Link " : "";

  if (state === "unrecorded") {
    return <span className="text-xs text-muted-foreground">{variant === "meta" ? "Link belum tercatat" : "Belum tercatat"}</span>;
  }
  if (state === "expired") {
    return (
      <span className="text-xs tabular-nums text-muted-foreground">
        {prefix}
        <span className="font-medium text-status-absent-text">Kedaluwarsa</span>
        {variant === "column" && when ? <span className="block">{when}</span> : null}
      </span>
    );
  }
  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      {variant === "meta" ? "Link s/d " : ""}
      {when}
    </span>
  );
}
