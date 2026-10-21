import { formatRupiah } from "@/lib/format";
import { extractDisplayFields } from "@/lib/webhook/extract-display-fields";
import {
  DUPLICATE_PAYMENT_AFTER_PAID,
  NEEDS_REVIEW_ERROR_CODES,
  OVERPAYMENT_FLAGGED,
  PAID_ON_CANCELLED_INVOICE,
} from "@/lib/payments/needs-review";

/** One flagged gateway payment, in words staff can act on. No raw codes in `message`. */
export type PaymentProblem = { code: string; message: string; createdAt: Date };

type FlaggedEvent = { errorMessage: string | null; payload: unknown; provider: string; createdAt: Date };

function gatewayLabel(provider: string): string {
  const p = provider.toLowerCase();
  if (p === "xendit") return "Xendit";
  if (p === "doku") return "DOKU";
  return "gateway";
}

function messageFor(code: string, gateway: string, amount: number | null): string | null {
  const nominal = amount === null ? "" : ` sebesar ${formatRupiah(amount)}`;
  switch (code) {
    case DUPLICATE_PAYMENT_AFTER_PAID:
      return `Ada pembayaran kedua di ${gateway}${nominal} untuk tagihan yang sudah lunas. Pembayaran ini tidak dicatat — periksa di dashboard ${gateway} dan kembalikan dana bila perlu.`;
    case PAID_ON_CANCELLED_INVOICE:
      return `Ada pembayaran di ${gateway}${nominal} untuk tagihan yang sudah dibatalkan. Pembayaran ini tidak dicatat — periksa di dashboard ${gateway} dan kembalikan dana.`;
    case OVERPAYMENT_FLAGGED:
      return `Pembayaran di ${gateway}${nominal} melebihi sisa tagihan — sudah dicatat. Periksa dan kembalikan kelebihannya bila perlu.`;
    default:
      return null;
  }
}

/**
 * Turn the invoice's flagged webhook ERROR events (newest first, as given) into
 * "Perlu dicek" notes: one per event whose `errorMessage` is a needs-review code.
 * The amount comes from the stored gateway payload.
 */
export function paymentProblemsFrom(events: FlaggedEvent[]): PaymentProblem[] {
  const out: PaymentProblem[] = [];
  for (const e of events) {
    const code = e.errorMessage;
    if (!code || !(NEEDS_REVIEW_ERROR_CODES as readonly string[]).includes(code)) continue;
    const message = messageFor(code, gatewayLabel(e.provider), extractDisplayFields(e.payload).amount);
    if (message) out.push({ code, message, createdAt: e.createdAt });
  }
  return out;
}
