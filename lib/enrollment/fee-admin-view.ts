/**
 * What STAFF see about an application's pendaftaran fee. More than the public
 * view (method, who and why, the last gateway error) but still no gateway
 * session id, payment URL or payment id: nothing a screen needs, and nothing
 * worth leaking into a browser.
 */

type FeeRow = {
  status: string;
  method: string | null;
  baseAmount: unknown;
  discountPercent: number;
  discountReason: string | null;
  amount: unknown;
  paidAt: Date | null;
  note: string | null;
  linkError: string | null;
  lastCheckedAt: Date | null;
  paymentUrl: string | null;
  sessionExpiresAt: Date | null;
};

export type AdminFeeStatus = "UNPAID" | "PAID" | "WAIVED";

export type AdminFeeView = {
  status: AdminFeeStatus;
  method: string | null;
  baseAmount: number;
  discountPercent: number;
  discountReason: string | null;
  /** What the parent owes (or paid). */
  amount: number;
  paidAt: string | null;
  note: string | null;
  /** Last gateway failure creating a link, for triage; null once a link works. */
  linkError: string | null;
  lastCheckedAt: string | null;
  /** The parent holds a payment link that still works. */
  linkActive: boolean;
};

/** The `select` every caller of `toAdminFeeView` needs. */
export const ADMIN_FEE_SELECT = {
  status: true,
  method: true,
  baseAmount: true,
  discountPercent: true,
  discountReason: true,
  amount: true,
  paidAt: true,
  note: true,
  linkError: true,
  lastCheckedAt: true,
  paymentUrl: true,
  sessionExpiresAt: true,
} as const;

/** A payment the processor refused to credit, in words staff can act on. */
export type FeeAttention = { code: string; message: string };

/**
 * Turn the ERROR rows the processor wrote for this fee (`WebhookEvent.invoiceId`
 * holds the fee id, newest first) into "perlu dicek" notes. Each distinct kind
 * once. A wrong-amount payment only matters while the fee is still owed — once
 * staff have settled it themselves it is history — but a second payment or money
 * on a waived fee is a refund owed whatever happened since.
 */
export function feeAttentionFrom(events: { errorMessage: string | null }[], status: AdminFeeStatus): FeeAttention[] {
  const seen = new Set<string>();
  const out: FeeAttention[] = [];
  const add = (code: string, message: string) => {
    if (seen.has(code)) return;
    seen.add(code);
    out.push({ code, message });
  };
  for (const e of events) {
    const msg = e.errorMessage ?? "";
    if (msg.startsWith("AMOUNT_MISMATCH")) {
      if (status !== "UNPAID") continue;
      const m = /expected=(\d+);got=(\d+)/.exec(msg);
      const detail = m ? ` (masuk Rp ${Number(m[2]).toLocaleString("id-ID")}, seharusnya Rp ${Number(m[1]).toLocaleString("id-ID")})` : "";
      add("AMOUNT_MISMATCH", `Ada pembayaran yang jumlahnya berbeda dari biaya${detail}, jadi biaya tetap Belum bayar. Periksa di dashboard DOKU lalu tangani manual.`);
    } else if (msg === "DUPLICATE_PAYMENT_AFTER_PAID") {
      add("DUPLICATE_PAYMENT_AFTER_PAID", "Ada pembayaran kedua untuk biaya yang sudah lunas. Periksa di dashboard DOKU dan kembalikan dana bila perlu.");
    } else if (msg === "PAID_ON_WAIVED_FEE") {
      add("PAID_ON_WAIVED_FEE", "Ada pembayaran untuk biaya yang sudah dibebaskan. Periksa di dashboard DOKU dan kembalikan dana.");
    } else if (msg === "DUPLICATE_PAYMENT_ID") {
      add("DUPLICATE_PAYMENT_ID", "Ada pembayaran yang sudah tercatat pada biaya lain. Periksa di dashboard DOKU.");
    }
  }
  return out;
}

function toStatus(raw: string): AdminFeeStatus {
  return raw === "PAID" || raw === "WAIVED" ? raw : "UNPAID";
}

export function toAdminFeeView(fee: FeeRow, now: Date = new Date()): AdminFeeView {
  return {
    status: toStatus(fee.status),
    method: fee.method,
    // Prisma Decimal arrives string-like.
    baseAmount: Math.round(Number(fee.baseAmount)),
    discountPercent: fee.discountPercent,
    discountReason: fee.discountReason,
    amount: Math.round(Number(fee.amount)),
    paidAt: fee.paidAt ? fee.paidAt.toISOString() : null,
    note: fee.note,
    linkError: fee.linkError,
    lastCheckedAt: fee.lastCheckedAt ? fee.lastCheckedAt.toISOString() : null,
    linkActive: Boolean(fee.paymentUrl && fee.sessionExpiresAt && fee.sessionExpiresAt.getTime() > now.getTime()),
  };
}
