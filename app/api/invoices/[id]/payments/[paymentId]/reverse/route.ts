import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { validateBody } from "@/lib/api/validate";
import { recordAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { reversePaymentSchema } from "@/lib/validations/invoice";
import { isGatewayPayment } from "@/lib/constants/payment-methods";
import { recomputeInvoiceFromPayments } from "@/lib/finance/invoice-payment-state";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { scheduleRelink, staleLinkCleared } from "@/lib/payments/ensure-link";

/**
 * POST /api/invoices/[id]/payments/[paymentId]/reverse
 *
 * Undo a MANUAL payment (a mis-keyed amount, a payment booked on the wrong
 * invoice). The Payment row is kept and flagged `REVERSED` — the ledger stays
 * append-only — and the invoice is recomputed by the same helper the record
 * route uses. Gateway payments (Xendit/DOKU) are refused: money that moved
 * through the gateway needs a refund there, not an edit here.
 *
 * Idempotent: reversing an already-reversed payment answers 200 with
 * `alreadyReversed: true` and changes nothing.
 * Permission: `payments.record` (whoever may record a payment may correct it).
 * Rate limit: 20 reversals per user per minute (security.md: every write
 * endpoint), checked before the advisory-lock transaction.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> },
) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "payments.record")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = session.tenantId;

  if (!rateLimit(`reverse-payment:${session.id}`, 20, 60_000).success) {
    return NextResponse.json(
      { error: "Terlalu banyak pembatalan dalam waktu singkat. Tunggu sebentar lalu coba lagi." },
      { status: 429 },
    );
  }

  const { id: invoiceId, paymentId } = await params;
  const parsed = await validateBody(reversePaymentSchema, await req.json().catch(() => null));
  if (parsed.error) return parsed.error;
  const reason = parsed.data.reason;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Same lock as record / void / webhook: serializes every change to this
      // invoice's paid total.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceId}))`;

      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice || invoice.tenantId !== tenantId) throw new Error("NOT_FOUND");
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment || payment.invoiceId !== invoiceId) throw new Error("NOT_FOUND");

      if (payment.status === "REVERSED") {
        return { payment, invoiceStatus: invoice.status, alreadyReversed: true, relink: false };
      }
      if (isGatewayPayment(payment)) throw new Error("GATEWAY");
      if (invoice.status === "CANCELLED") throw new Error("CANCELLED");

      const stamp = getTodayInTimezone("Asia/Jakarta");
      const note = `Dibatalkan ${stamp} oleh ${session.name ?? session.email}: ${reason}`;
      const reversed = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: "REVERSED",
          notes: payment.notes ? `${payment.notes}\n${note}` : note,
        },
      });

      const after = await recomputeInvoiceFromPayments(tx, invoice, stamp);
      // Still owing: the old link was cut for the paid-up balance, so drop it and make a
      // new one below. Dropped after the recompute (which reads `xenditPaymentUrl` for the
      // unpaid status). An invoice that is no longer owing keeps its link fields, so a
      // "Link Gagal" category survives.
      const relink =
        (UNPAID_INVOICE_STATUSES as readonly string[]).includes(after.status) &&
        new Prisma.Decimal(invoice.totalDue.toString()).gt(after.totalPaid);
      if (relink) {
        await tx.invoice.update({ where: { id: invoiceId }, data: staleLinkCleared(new Date()) });
      }

      await recordAudit(
        {
          tenantId,
          actorId: session.id,
          entity: "Payment",
          entityId: paymentId,
          action: "reverse",
          before: {
            paymentStatus: payment.status,
            amount: payment.amount.toString(),
            invoiceStatus: invoice.status,
            totalPaid: invoice.totalPaid.toString(),
          },
          after: {
            paymentStatus: "REVERSED",
            reason,
            invoiceId,
            invoiceStatus: after.status,
            totalPaid: after.totalPaid.toString(),
          },
        },
        tx,
      );

      return { payment: reversed, invoiceStatus: after.status, alreadyReversed: false, relink };
    });

    if (!result.alreadyReversed) {
      revalidateTag("parent-invoice-list", { expire: 0 });
      revalidateTag("student-invoices", { expire: 0 });
    }
    if (result.relink) scheduleRelink(invoiceId, tenantId, new URL(req.url).origin, "REVERSE PAYMENT");
    return NextResponse.json({
      ok: true,
      alreadyReversed: result.alreadyReversed,
      invoiceStatus: result.invoiceStatus,
      payment: { id: result.payment.id, status: result.payment.status },
    });
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "NOT_FOUND") {
        return NextResponse.json({ error: "Pembayaran tidak ditemukan" }, { status: 404 });
      }
      if (e.message === "GATEWAY") {
        return NextResponse.json(
          {
            error:
              "Pembayaran lewat gateway (Virtual Account) tidak bisa dibatalkan dari sini. Proses pengembalian dana dilakukan di dashboard gateway.",
          },
          { status: 409 },
        );
      }
      if (e.message === "CANCELLED") {
        return NextResponse.json(
          { error: "Tagihan ini sudah dibatalkan, pembayarannya tidak bisa diubah lagi." },
          { status: 409 },
        );
      }
    }
    throw e;
  }
}
