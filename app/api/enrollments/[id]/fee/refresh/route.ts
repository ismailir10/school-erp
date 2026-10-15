import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { reconcileEnrollmentFee } from "@/lib/payments/reconcile";
import { ADMIN_FEE_SELECT, toAdminFeeView } from "@/lib/enrollment/fee-admin-view";

/**
 * POST /api/enrollments/[id]/fee/refresh — "Perbarui pembayaran" for a
 * pendaftaran fee: ask the gateway what it knows and credit anything it has
 * settled. The staff counterpart of the parent's "Periksa lagi", and the way to
 * credit a payment immediately when the notification never arrived.
 *
 * Same read-only poll the daily sweep uses, routed through the shared payment
 * processor, so it cannot double-credit. Needs `admissions.edit` AND
 * `payments.record` (as the invoice refresh does); the fee is addressed through
 * its application and must belong to the session's tenant.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  // The same keys as refreshing an invoice payment (`payments.record`), on top of
  // the module's own: crediting a payment is a finance action.
  if (
    !session?.tenantId ||
    !isAdminRole(session.role) ||
    !hasPermission(session, "admissions.edit") ||
    !hasPermission(session, "payments.record")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = session.tenantId;

  // Each call is an outbound gateway request.
  const limit = rateLimit(`enrollment-fee-refresh:${session.id}`, 20, 60_000);
  if (!limit.success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const { id } = await params;
  const fee = await prisma.enrollmentFee.findFirst({ where: { applicationId: id, tenantId }, select: { id: true } });
  if (!fee) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Staff are never throttled: they pressed the button because they want the answer now.
  const result = await reconcileEnrollmentFee(fee.id, { minIntervalMs: 0 });

  const current = await prisma.enrollmentFee.findUnique({ where: { id: fee.id }, select: ADMIN_FEE_SELECT });
  return NextResponse.json({
    code: result.code,
    message: result.message,
    fee: current ? toAdminFeeView(current) : null,
  });
}
