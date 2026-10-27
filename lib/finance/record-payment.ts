import { Prisma } from "@/lib/generated/prisma/client";
import type { Payment } from "@/lib/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { recomputeInvoiceFromPayments } from "@/lib/finance/invoice-payment-state";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { formatRupiah } from "@/lib/format";
import { LINK_CLEARED } from "@/lib/payments/link-cleared";
import { staleLinkCleared } from "@/lib/payments/ensure-link";

/**
 * The one place that turns "an admin took this money" into a Payment row plus
 * the invoice's new state (cycle 2026-10-27-paid-invoice-spp-prepay, D1).
 * Called by `POST /api/invoices/[id]/payments`, the paid-at-creation invoice
 * mode and the SPP prepay confirm.
 *
 * It never schedules a replacement payment link, not even for "relink-if-owing";
 * it only reports `relink` and the route that owns the request schedules it.
 */

export type PaymentErrorCode = "NOT_FOUND" | "CANCELLED" | "PAID" | "OVERPAYMENT" | "RETRY_MISMATCH";

export class PaymentError extends Error {
  code: PaymentErrorCode;
  /** OVERPAYMENT only: the Indonesian message for the Jumlah field. */
  msg?: string;

  constructor(code: PaymentErrorCode, msg?: string) {
    super(code);
    this.name = "PaymentError";
    this.code = code;
    this.msg = msg;
  }
}

export type RecordPaymentInput = {
  invoiceId: string;
  /** Used for the audit entry. */
  tenantId: string;
  actorId: string;
  amount: Prisma.Decimal;
  method: string;
  /** Already trimmed / nullified by the caller. */
  reference: string | null;
  notes: string | null;
  /** Non-null only for a back-dated payment (00:00 Asia/Jakarta of the chosen day). */
  paidAt: Date | null;
  idempotencyKey?: string;
  requestHash?: string;
  /** Jakarta calendar day. */
  todayYmd: string;
  /** What to do with the invoice's gateway link fields after the payment. */
  linkPolicy: "relink-if-owing" | "clear-link";
};

export type RecordPaymentResult = {
  payment: Payment;
  replayed: boolean;
  /** True only for "relink-if-owing" when the invoice still owes money. The CALLER schedules the relink. */
  relink: boolean;
  invoiceStatus: string;
  totalPaid: Prisma.Decimal;
};

/**
 * Must run INSIDE a caller-owned `prisma.$transaction`: advisory-lock the
 * invoice (same lock the Xendit webhook takes, so a manual payment and a
 * webhook cannot both pass the overpayment guard), re-read it, guard, create
 * the payment, recompute, handle the link, audit.
 */
export async function recordPaymentInTx(
  tx: Prisma.TransactionClient,
  input: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  const { invoiceId, amount, idempotencyKey, requestHash, paidAt, todayYmd } = input;

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceId}))`;

  const fresh = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!fresh) throw new PaymentError("NOT_FOUND");
  // Check under the invoice lock, before balance/status guards: a successful
  // first request may already have settled this invoice.
  if (idempotencyKey) {
    const existing = await tx.payment.findFirst({ where: { invoiceId, idempotencyKey } });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new PaymentError("RETRY_MISMATCH");
      return {
        payment: existing,
        replayed: true,
        relink: false,
        invoiceStatus: fresh.status,
        totalPaid: new Prisma.Decimal(fresh.totalPaid.toString()),
      };
    }
  }
  if (fresh.status === "CANCELLED") throw new PaymentError("CANCELLED");
  if (fresh.status === "PAID") throw new PaymentError("PAID");

  const totalDueDec = new Prisma.Decimal(fresh.totalDue.toString());
  const currentPaidDec = new Prisma.Decimal(fresh.totalPaid.toString());
  const remainingDec = totalDueDec.sub(currentPaidDec);
  if (amount.gt(remainingDec)) {
    throw new PaymentError(
      "OVERPAYMENT",
      `Jumlah pembayaran (${formatRupiah(amount.toString())}) melebihi sisa tagihan (${formatRupiah(remainingDec.toString())})`,
    );
  }

  const p = await tx.payment.create({
    data: {
      invoiceId,
      ...(idempotencyKey ? { idempotencyKey, requestHash } : {}),
      amount,
      method: input.method,
      reference: input.reference,
      notes: input.notes,
      // FIN-7: who took this money. Gateway rows (webhook) stay null.
      createdBy: input.actorId,
      ...(paidAt ? { paidAt } : {}),
    },
  });

  // Shared with the reversal route — REVERSED rows never count.
  const after = await recomputeInvoiceFromPayments(tx, fresh, todayYmd);
  // The invoice was not PAID going in (guarded above), so if this payment
  // settles it, its "lunas" date is the chosen payment date, not the day
  // the admin typed it in — the kuitansi prints this.
  if (paidAt && after.status === "PAID") {
    await tx.invoice.update({ where: { id: invoiceId }, data: { paidAt } });
  }

  let relink = false;
  if (input.linkPolicy === "clear-link") {
    // Dropped after the recompute, which reads `xenditPaymentUrl` to pick the unpaid status.
    await tx.invoice.update({ where: { id: invoiceId }, data: { ...LINK_CLEARED } });
  } else {
    // Still owing: the old link still charges the pre-payment balance (paying it would
    // be flagged as an overpayment), so drop it; the caller makes a new one. An invoice
    // that is no longer owing keeps its link fields as they were.
    relink =
      (UNPAID_INVOICE_STATUSES as readonly string[]).includes(after.status) &&
      totalDueDec.gt(after.totalPaid);
    if (relink) {
      await tx.invoice.update({ where: { id: invoiceId }, data: staleLinkCleared(new Date()) });
    }
  }

  await recordAudit(
    {
      tenantId: input.tenantId,
      actorId: input.actorId,
      entity: "Payment",
      entityId: p.id,
      action: "record",
      before: { invoiceStatus: fresh.status, totalPaid: fresh.totalPaid.toString() },
      after: {
        invoiceId,
        amount: amount.toString(),
        method: p.method,
        invoiceStatus: after.status,
        totalPaid: after.totalPaid.toString(),
      },
    },
    tx,
  );

  return { payment: p, replayed: false, relink, invoiceStatus: after.status, totalPaid: after.totalPaid };
}
