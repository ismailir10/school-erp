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
import { PaymentError, recordPaymentInTx } from "@/lib/finance/record-payment";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { isGatewayPayment } from "@/lib/constants/payment-methods";
import { scheduleRelink } from "@/lib/payments/ensure-link";
import { rateLimit } from "@/lib/rate-limit";

// Record a manual payment for an invoice
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "payments.record")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!rateLimit(`record-payment:${session.id}`, 20, 60_000).success) {
    return NextResponse.json(
      { error: "Terlalu banyak pencatatan dalam waktu singkat. Tunggu sebentar lalu coba lagi." },
      { status: 429 },
    );
  }

  const { id: invoiceId } = await params;
  const tenantId = session.tenantId;
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
    const result = await prisma.$transaction((tx) =>
      recordPaymentInTx(tx, {
        invoiceId,
        tenantId,
        actorId: session.id,
        amount: amountDec,
        method: parsed.data.method,
        reference: parsed.data.reference?.trim() || null,
        notes: parsed.data.notes?.trim() || null,
        paidAt: backdatedPaidAt,
        idempotencyKey,
        requestHash,
        todayYmd,
        linkPolicy: "relink-if-owing",
      }),
    );

    // Manual payment writes Invoice.status + Invoice.totalPaid; bust the
    // parent-portal Tagihan + per-student caches so /parent and /parent/invoices
    // pick up the new state immediately (UAT-2026-05-03 INV-01 vector).
    revalidateTag("parent-invoice-list", { expire: 0 });
    revalidateTag("student-invoices", { expire: 0 });

    if (result.relink) scheduleRelink(invoiceId, tenantId, new URL(req.url).origin, "RECORD PAYMENT");
    return NextResponse.json(result.payment, { status: result.replayed ? 200 : 201 });
  } catch (e) {
    if (e instanceof PaymentError) {
      if (e.code === "RETRY_MISMATCH") return NextResponse.json({ error: "Pembayaran ini sudah dicatat dengan rincian berbeda. Periksa riwayat pembayaran sebelum mencatat pembayaran baru." }, { status: 409 });
      if (e.code === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (e.code === "CANCELLED") return NextResponse.json({ error: "Tidak bisa mencatat pembayaran untuk tagihan yang dibatalkan" }, { status: 400 });
      if (e.code === "PAID") return NextResponse.json({ error: "Tagihan sudah lunas" }, { status: 400 });
      // Land the message on the Jumlah field, not just a banner (FIN-8).
      if (e.code === "OVERPAYMENT") return fieldErrorResponse("amount", e.msg ?? e.message, 400);
    }
    throw e;
  }
}
