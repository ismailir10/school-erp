import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { reconcileInvoicePayment } from "@/lib/payments/reconcile";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";

const UNPAID: ReadonlySet<string> = new Set(UNPAID_INVOICE_STATUSES);

/** Two checks of one invoice inside this window poll the gateway once. */
const MIN_CHECK_INTERVAL_MS = 10_000;

/**
 * POST /api/guardian/invoices/[id]/check-payment
 *
 * Parent-side payment status check. The parent returns from the gateway
 * checkout before the webhook may have landed; this polls the gateway once
 * (throttled per invoice) and applies the result through the shared reconciler.
 *
 * Guardian scoping mirrors `GET /api/guardian/invoices/[id]`: GUARDIAN role
 * only, and only for an invoice of one of the parent's own children. Every
 * miss is a flat 404 so a probing client learns nothing about other families.
 *
 * The response carries only `{ code, status }` — the reconciler's `message` is
 * admin-voice text and never reaches a parent. The nightly sweep is the
 * backstop for anything that fails here, so a gateway failure is a 200
 * `GATEWAY_ERROR`, not a 5xx.
 */
export async function POST(
  _req: NextRequest,
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

  // Same parentId-or-nonempty-email guard as the guardian invoice detail route:
  // a session carrying neither would match the first null-email parent in the
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
    select: {
      id: true,
      tenantId: true,
      studentId: true,
      status: true,
      xenditPaymentUrl: true,
    },
  });
  if (!invoice || !childIds.has(invoice.studentId) || invoice.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // After auth + scoping so a stranger cannot probe the limiter.
  const { success } = rateLimit(`guardian-check-payment:${session.id}:${id}`, 6, 60_000);
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu sering memeriksa. Tunggu sebentar ya." },
      { status: 429 },
    );
  }

  // Nothing to poll: already settled / not payable, or no gateway session.
  if (!UNPAID.has(invoice.status) || !invoice.xenditPaymentUrl) {
    return NextResponse.json({ code: "SKIPPED", status: invoice.status });
  }

  try {
    const r = await reconcileInvoicePayment(id, { minIntervalMs: MIN_CHECK_INTERVAL_MS });
    return NextResponse.json({
      code: r.code,
      status: r.statusAfter ?? r.statusBefore ?? invoice.status,
    });
  } catch (error) {
    console.error("[GUARDIAN CHECK PAYMENT] failed", {
      invoiceId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ code: "GATEWAY_ERROR", status: invoice.status });
  }
}
