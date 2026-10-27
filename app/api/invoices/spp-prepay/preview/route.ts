import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { sppPrepayPreviewSchema } from "@/lib/validations/spp-prepay";
import { fingerprintPlan, loadSppPrepayContext, planForContext } from "@/lib/finance/spp-prepay-load";

/**
 * POST /api/invoices/spp-prepay/preview
 *
 * Read-only first half of "Catat SPP di muka" (cycle
 * 2026-10-27-paid-invoice-spp-prepay.md): prices every month of the range the
 * way the Billing Run would, says what confirming will do to each month
 * (create and pay / pay the rest of an existing invoice / skip, already paid)
 * and returns a `fingerprint` the confirm route checks. Writes nothing.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  // Previewing is only useful to someone who can confirm, so it needs both permissions.
  if (
    !session?.tenantId ||
    !isAdminRole(session.role) ||
    !hasPermission(session, "invoices.create") ||
    !hasPermission(session, "payments.record")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!rateLimit(`spp-prepay-preview:${session.id}`, 30, 60_000).success) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan dalam waktu singkat. Tunggu sebentar lalu coba lagi." },
      { status: 429 },
    );
  }

  const rawBody = await req.json().catch(() => null);
  const result = await validateBody(sppPrepayPreviewSchema, rawBody);
  if (result.error) return result.error;
  const { studentId, from, to } = result.data;

  const ctx = await loadSppPrepayContext(prisma, { tenantId: session.tenantId, studentId, from, to });
  if (!ctx.ok) {
    const status =
      ctx.code === "STUDENT_NOT_FOUND" ? 404 : ctx.code === "NO_ACADEMIC_YEAR" ? 409 : 400;
    return NextResponse.json({ error: ctx.message, code: ctx.code }, { status });
  }

  const plan = planForContext(ctx);

  return NextResponse.json({
    student: ctx.student,
    academicYear: ctx.academicYear,
    range: ctx.range,
    program: ctx.program,
    rows: plan.rows.map((r) => ({
      year: r.year,
      month: r.month,
      periodLabel: r.periodLabel,
      dueDate: r.dueDate,
      action: r.action,
      amount: Number(r.amount),
      invoiceIds: r.invoiceIds,
      hadLink: r.hadLink,
      linkExpiresAt: r.linkExpiresAt ? r.linkExpiresAt.toISOString() : null,
      beforeFirstBilling: r.beforeFirstBilling,
    })),
    total: Number(plan.total),
    issues: plan.issues,
    blocked: plan.blocked,
    fingerprint: fingerprintPlan(plan, ctx.invoices),
  });
}
