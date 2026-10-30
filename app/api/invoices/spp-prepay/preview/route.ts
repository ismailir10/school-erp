import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { sppPrepayPreviewSchema } from "@/lib/validations/spp-prepay";
import {
  fingerprintPlan,
  loadSppPrepayContext,
  planForContext,
  sppAvailability,
} from "@/lib/finance/spp-prepay-load";

/**
 * POST /api/invoices/spp-prepay/preview
 *
 * Read-only first half of "Catat pembayaran di muka" (cycles
 * 2026-10-27-paid-invoice-spp-prepay.md and 2026-10-30-prepay-other-fees.md).
 * Both parts are optional. With `from` + `to` it prices every month of the range the
 * way the Billing Run would and says what confirming will do to each month
 * (create and pay / pay the rest of an existing invoice / skip, already paid).
 * With `otherFees` it plans one new invoice for the one-time lines, with a caution
 * for each unpaid invoice of the student that already carries a chosen component.
 * It always returns the one-time component list (with the student's prefill) and
 * whether SPP can be chosen, so a call with neither part is the "student picked"
 * call. Returns a `fingerprint` the confirm route checks. Writes nothing.
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
  const { studentId, otherFees } = result.data;
  const from = result.data.from ?? undefined;
  const to = result.data.to ?? undefined;

  const ctx = await loadSppPrepayContext(prisma, { tenantId: session.tenantId, studentId, from, to });
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.message, code: ctx.code }, { status: ctx.code === "STUDENT_NOT_FOUND" ? 404 : 400 });
  }

  const plan = planForContext(ctx, otherFees);

  return NextResponse.json({
    student: ctx.student,
    academicYear: ctx.academicYear,
    range: ctx.range,
    program: ctx.program,
    spp: sppAvailability(ctx),
    oneTimeComponents: ctx.oneTimeComponents,
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
    sppTotal: Number(plan.sppTotal),
    otherFees: plan.otherFees
      ? {
          label: plan.otherFees.label,
          lines: plan.otherFees.lines.map((l) => ({
            feeComponentId: l.feeComponentId,
            label: l.label,
            amount: Number(l.amount),
          })),
          total: Number(plan.otherFees.total),
        }
      : null,
    total: Number(plan.total), // grand total: SPP rows + one-time lines
    issues: plan.issues,
    blocked: plan.blocked,
    fingerprint: fingerprintPlan(plan, ctx.invoices),
  });
}
