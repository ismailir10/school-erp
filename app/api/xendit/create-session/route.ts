import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { createPaymentSessionForInvoice } from "@/lib/payments/session";
import { formatPaymentLinkError } from "@/lib/xendit/error-prefix";
import { createPaymentSessionSchema } from "@/lib/validations/invoice";

/**
 * Create Xendit Checkout Sessions — single or bulk.
 * Bulk: admin clicks "Kirim Tagihan" → creates sessions for all selected invoices.
 */
export async function POST(req: NextRequest) {
  // Rate limit: 5 Xendit session creations per minute
  const { success } = rateLimit(`xendit:${getClientIp(req)}`, 5, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan. Coba lagi nanti." }, { status: 429 });
  }

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "invoices.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  const parsed = createPaymentSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validasi gagal", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const invoiceIds: string[] =
    parsed.data.invoiceIds ?? (parsed.data.invoiceId ? [parsed.data.invoiceId] : []);

  if (invoiceIds.length === 0) {
    return NextResponse.json({ error: "Pilih minimal satu tagihan" }, { status: 400 });
  }

  let created = 0;
  let failed = 0;
  let statusChanged = false;
  const errors: string[] = [];
  const results: { studentName: string; invoiceNumber: string; paymentUrl: string }[] = [];

  for (const invoiceId of invoiceIds) {
    // Fetch invoice for display in results
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { student: { select: { name: true } }, lines: { select: { labelSnapshot: true } } },
    });

    if (!invoice || invoice.tenantId !== session.tenantId) {
      errors.push(`Tagihan tidak ditemukan`);
      failed++;
      continue;
    }

    if (invoice.status === "PAID" || invoice.status === "CANCELLED") {
      failed++;
      continue;
    }

    // OVERDUE / PARTIALLY_PAID are still owed whatever happens to their link:
    // neither a new link nor a failed attempt may move them out of those
    // statuses (cycle 2026-10-17-expired-link-overdue).
    const stillOwed = invoice.status === "OVERDUE" || invoice.status === "PARTIALLY_PAID";

    const remaining = Number(invoice.totalDue) - Number(invoice.totalPaid);
    if (remaining <= 0) {
      failed++;
      continue;
    }

    // Idempotency: if a Xendit session already exists for this invoice, return it
    // instead of creating a second one. Admin clicking "Kirim" twice must never
    // produce two live payment links per invoice.
    if (invoice.xenditSessionId && invoice.xenditPaymentUrl) {
      // Defensive: clear any stale paymentLinkError (no-op if already null).
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { paymentLinkError: null },
      });

      results.push({
        studentName: invoice.student.name,
        invoiceNumber: invoice.invoiceNumber,
        paymentUrl: invoice.xenditPaymentUrl,
      });
      created++;
      continue;
    }

    try {
      const result = await createPaymentSessionForInvoice(invoiceId, session.tenantId, new URL(req.url).origin);

      if (result) {
        // Update status to SENT (helper only stores Xendit fields).
        // Clear paymentLinkError — covers the retry-of-PENDING_PAYMENT_LINK path.
        // An OVERDUE or PARTIALLY_PAID invoice that gets a fresh link (its
        // expired one was cleared by the reconcile sweep) keeps its status —
        // demoting it to SENT would drop the partial-payment state and hide the
        // overdue label until the next maintenance run.
        const becomesSent = !stillOwed;
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: {
            ...(becomesSent ? { status: "SENT", sentAt: new Date() } : {}),
            paymentLinkError: null,
          },
        });
        if (invoice.status !== "SENT") statusChanged = true;

        results.push({
          studentName: invoice.student.name,
          invoiceNumber: invoice.invoiceNumber,
          paymentUrl: result.paymentUrl,
        });
        created++;
      } else {
        // Helper returns null on TOCTOU-reachable guard conditions (status flipped
        // to PAID/CANCELLED between our pre-check and the helper's re-check, or
        // remaining went to 0). Surface a diagnostic so admin sees why.
        errors.push(`${invoice.student.name}: Gagal membuat sesi pembayaran`);
        failed++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      // Persist the failure as durable state — invoice becomes filterable in
      // the admin list under PENDING_PAYMENT_LINK and is retryable from there.
      // The persisted column is prefix-tagged via formatPaymentLinkError so
      // the breakdown endpoint can aggregate by category; the user-facing
      // errors[] line keeps the plain message for readability.
      try {
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: {
            ...(stillOwed ? {} : { status: "PENDING_PAYMENT_LINK" }),
            paymentLinkError: formatPaymentLinkError(e),
          },
        });
        if (!stillOwed && invoice.status !== "PENDING_PAYMENT_LINK") statusChanged = true;
      } catch {
        // Swallow write-back failure — the original Xendit error is still surfaced
        // to the admin via errors[], counts are still correct.
      }
      errors.push(`${invoice.student.name}: ${msg}`);
      failed++;
    }
  }

  // Bust parent-portal Tagihan caches if any invoice flipped status during
  // this batch (UAT-2026-05-03 INV-01 vector — without this the parent
  // doesn't see the new payment link or the PENDING_PAYMENT_LINK state for
  // up to 120 s after admin clicks "Kirim Tagihan").
  if (statusChanged) {
    revalidateTag("parent-invoice-list", { expire: 0 });
    revalidateTag("student-invoices", { expire: 0 });
  }

  return NextResponse.json({
    created,
    failed,
    total: invoiceIds.length,
    results,
    errors: errors.length > 0 ? errors : undefined,
  });
}
