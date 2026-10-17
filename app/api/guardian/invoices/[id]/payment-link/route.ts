import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { ensurePaymentLink } from "@/lib/payments/ensure-link";
import { reconcileInvoicePayment } from "@/lib/payments/reconcile";

/** Two asks about one invoice inside this window poll the gateway once. */
const MIN_CHECK_INTERVAL_MS = 10_000;

/**
 * POST /api/guardian/invoices/[id]/payment-link
 *
 * "Give me a working link to pay this invoice." A payment link dies at the end
 * of the due date and the reconcile sweep then clears it, so an expired invoice
 * has none; this lets the parent get one without calling the school
 * (cycle 2026-10-17-payment-link-on-demand).
 *
 * - An invoice that still shows a link is checked at the gateway first (the same
 *   read-only reconcile as the return page). An expired link is cleared there,
 *   and a payment made in the meantime is credited, so a parent is never given a
 *   second link for an invoice that was just paid.
 * - A live link is returned unchanged. A new one is created only when there is
 *   none, and exactly once however many requests race (`ensurePaymentLink`).
 *
 * Guardian scoping mirrors `check-payment`: GUARDIAN role only, only an invoice
 * of the parent's own child, and every miss is a flat 404 so a probing client
 * learns nothing about other families. The response carries only `paymentUrl`
 * and `created`; gateway and reconcile text never reaches a parent.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.tenantId || session.role !== "GUARDIAN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Same parentId-or-nonempty-email guard as the guardian invoice routes: a
  // session carrying neither would match the first null-email parent in the
  // tenant — a cross-family leak.
  const hasEmail = typeof session.email === "string" && session.email.length > 0;
  if (!session.parentId && !hasEmail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const guardian = await prisma.parent.findFirst({
    where: session.parentId
      ? { id: session.parentId, tenantId: session.tenantId }
      : { email: session.email, tenantId: session.tenantId },
    select: { guardians: { select: { studentId: true } } },
  });
  if (!guardian) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const childIds = new Set(guardian.guardians.map((g) => g.studentId));

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { id: true, tenantId: true, studentId: true, xenditPaymentUrl: true },
  });
  if (!invoice || !childIds.has(invoice.studentId) || invoice.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // After auth + scoping so a stranger cannot probe the limiter.
  const { success } = rateLimit(`guardian-payment-link:${session.id}:${id}`, 6, 60_000);
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu sering mencoba. Tunggu sebentar ya." },
      { status: 429 },
    );
  }

  if (invoice.xenditPaymentUrl) {
    try {
      await reconcileInvoicePayment(id, { minIntervalMs: MIN_CHECK_INTERVAL_MS });
    } catch (error) {
      // The check is best effort: if it fails the link we hold is simply returned.
      console.error("[GUARDIAN PAYMENT LINK] pre-check failed", {
        invoiceId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const result = await ensurePaymentLink(id, session.tenantId, new URL(req.url).origin);

  if (result.kind === "READY") {
    return NextResponse.json({ paymentUrl: result.paymentUrl, created: result.created });
  }
  if (result.kind === "NOT_PAYABLE") {
    return NextResponse.json(
      { error: "Tagihan ini tidak bisa dibayar lewat link.", code: "NOT_PAYABLE" },
      { status: 409 },
    );
  }
  return NextResponse.json(
    { error: "Link belum bisa dibuat. Coba lagi sebentar lagi, atau hubungi tata usaha." },
    { status: 502 },
  );
}
