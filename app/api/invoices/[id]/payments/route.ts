import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { Prisma } from "@/lib/generated/prisma/client";
import { recordPaymentSchema } from "@/lib/validations/invoice";
import { hasPermission } from "@/lib/permissions";
import { validateBody } from "@/lib/api/validate";
import { fieldErrorResponse } from "@/lib/api/field-errors";
import { recordAudit } from "@/lib/audit";
import { recomputeInvoiceFromPayments } from "@/lib/finance/invoice-payment-state";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { isGatewayPayment } from "@/lib/constants/payment-methods";
import { formatRupiah } from "@/lib/format";

// Record a manual payment for an invoice
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "payments.record")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: invoiceId } = await params;
  // recordPaymentSchema existed for exactly this endpoint but was never wired
  // in — the hand-rolled check let any `method` string persist verbatim
  // (Payment.method is a plain String column, no DB enum). `validateBody`'s
  // `{ error, errors: [{ field, message }] }` shape (vs. the prior bare
  // `{ error }` string) is what the record-payment dialog's
  // `applyServerErrors` maps onto its Jumlah field.
  const rawBody = await req.json().catch(() => null);
  const result = await validateBody(recordPaymentSchema, rawBody);
  if (result.error) return result.error;
  const parsed = { data: result.data } as const;
  // FIN-23: gateway rails are written by the webhook, never hand-recorded —
  // a typed-in "Virtual Account" row would pass for a gateway delivery.
  if (isGatewayPayment({ method: parsed.data.method })) {
    return fieldErrorResponse(
      "method",
      "Pembayaran Virtual Account masuk otomatis lewat link pembayaran. Pilih Tunai, Transfer Bank, atau Lainnya.",
      400,
    );
  }
  const idempotencyKey = parsed.data.idempotencyKey;
  const requestHash = createHash("sha256").update(JSON.stringify({
    amount: parsed.data.amount,
    method: parsed.data.method,
    reference: parsed.data.reference?.trim() || null,
    notes: parsed.data.notes?.trim() || null,
    paidAt: parsed.data.paidAt ?? null,
  })).digest("hex");
  const amountDec = new Prisma.Decimal(parsed.data.amount.toString());
  // FINX-9: a back-dated payment is stored at 00:00 Asia/Jakarta of the chosen
  // day. Today (or no date) keeps the default `now`, so same-day payments retain
  // their real time of day. The schema already refused a future date.
  const todayYmd = getTodayInTimezone("Asia/Jakarta");
  const backdatedPaidAt =
    parsed.data.paidAt && parsed.data.paidAt < todayYmd
      ? new Date(`${parsed.data.paidAt}T00:00:00+07:00`)
      : null;

  // Quick tenant-scope check outside the tx so a cross-tenant id bails early.
  const preCheck = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId: session.tenantId },
    select: { id: true },
  });
  if (!preCheck) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Atomic: advisory-lock invoice, re-read status + totals, guard, create,
  // recompute. Same lock the Xendit webhook uses so a manual payment tab and
  // a webhook cannot both pass the overpayment guard concurrently.
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceId}))`;

      const fresh = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!fresh) throw new Error("NOT_FOUND");
      // Check under the existing invoice lock, before balance/status guards:
      // a successful first request may already have settled this invoice.
      if (idempotencyKey) {
        const existing = await tx.payment.findFirst({ where: { invoiceId, idempotencyKey } });
        if (existing) {
          if (existing.requestHash !== requestHash) throw new Error("RETRY_MISMATCH");
          return { payment: existing, replayed: true };
        }
      }
      if (fresh.status === "CANCELLED") throw new Error("CANCELLED");
      if (fresh.status === "PAID") throw new Error("PAID");

      const totalDueDec = new Prisma.Decimal(fresh.totalDue.toString());
      const currentPaidDec = new Prisma.Decimal(fresh.totalPaid.toString());
      const remainingDec = totalDueDec.sub(currentPaidDec);
      if (amountDec.gt(remainingDec)) {
        throw Object.assign(new Error("OVERPAYMENT"), {
          msg: `Jumlah pembayaran (${formatRupiah(amountDec.toString())}) melebihi sisa tagihan (${formatRupiah(remainingDec.toString())})`,
        });
      }

      const p = await tx.payment.create({
        data: {
          invoiceId,
          ...(idempotencyKey ? { idempotencyKey, requestHash } : {}),
          amount: amountDec,
          method: parsed.data.method,
          reference: parsed.data.reference?.trim() || null,
          notes: parsed.data.notes?.trim() || null,
          // FIN-7: who took this money. Gateway rows (webhook) stay null.
          createdBy: session.id,
          ...(backdatedPaidAt ? { paidAt: backdatedPaidAt } : {}),
        },
      });

      // Shared with the reversal route — REVERSED rows never count.
      const after = await recomputeInvoiceFromPayments(tx, fresh, todayYmd);
      // The invoice was not PAID going in (guarded above), so if this payment
      // settles it, its "lunas" date is the chosen payment date, not the day
      // the admin typed it in — the kuitansi prints this.
      if (backdatedPaidAt && after.status === "PAID") {
        await tx.invoice.update({ where: { id: invoiceId }, data: { paidAt: backdatedPaidAt } });
      }

      await recordAudit(
        {
          tenantId: session.tenantId!,
          actorId: session.id,
          entity: "Payment",
          entityId: p.id,
          action: "record",
          before: { invoiceStatus: fresh.status, totalPaid: fresh.totalPaid.toString() },
          after: {
            invoiceId,
            amount: amountDec.toString(),
            method: p.method,
            invoiceStatus: after.status,
            totalPaid: after.totalPaid.toString(),
          },
        },
        tx,
      );

      return { payment: p, replayed: false };
    });

    // Manual payment writes Invoice.status + Invoice.totalPaid; bust the
    // parent-portal Tagihan + per-student caches so /parent and /parent/invoices
    // pick up the new state immediately (UAT-2026-05-03 INV-01 vector).
    revalidateTag("parent-invoice-list", { expire: 0 });
    revalidateTag("student-invoices", { expire: 0 });
    return NextResponse.json(result.payment, { status: result.replayed ? 200 : 201 });
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "RETRY_MISMATCH") return NextResponse.json({ error: "Pembayaran ini sudah dicatat dengan rincian berbeda. Periksa riwayat pembayaran sebelum mencatat pembayaran baru." }, { status: 409 });
      if (e.message === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (e.message === "CANCELLED") return NextResponse.json({ error: "Tidak bisa mencatat pembayaran untuk tagihan yang dibatalkan" }, { status: 400 });
      if (e.message === "PAID") return NextResponse.json({ error: "Tagihan sudah lunas" }, { status: 400 });
      // Land the message on the Jumlah field, not just a banner (FIN-8).
      if (e.message === "OVERPAYMENT") {
        return fieldErrorResponse("amount", (e as Error & { msg: string }).msg, 400);
      }
    }
    throw e;
  }
}
