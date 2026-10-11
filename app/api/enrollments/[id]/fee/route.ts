import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { recordAudit } from "@/lib/audit";
import { enrollmentFeeActionSchema } from "@/lib/validations/enrollment-fee";
import { applyDiscount } from "@/lib/enrollment/fee";
import { DROP_LINK } from "@/lib/enrollment/fee-snapshot";
import { ADMIN_FEE_SELECT, toAdminFeeView } from "@/lib/enrollment/fee-admin-view";

/**
 * PATCH /api/enrollments/[id]/fee — staff settle or adjust an UNPAID
 * pendaftaran fee: set a discount, mark it paid outside the gateway, or waive it.
 * Needs `admissions.edit`; tenant always comes from the session; every change is
 * audited in the same transaction.
 *
 * Each action takes the SAME per-fee advisory lock the payment processor takes,
 * so a webhook crediting the fee and a staff click cannot interleave, and the
 * status is re-read under it: only an UNPAID fee can be changed (409 otherwise).
 *
 * Permissions mirror the invoice side, where money actions are gated on the
 * finance keys and not just the module: `admissions.edit` is the baseline for
 * every action, and on top of it MARK_PAID needs `payments.record` (the same key
 * as recording a manual invoice payment) while DISCOUNT and WAIVE need
 * `fees.edit` (they give up revenue). The default admin role holds all of them.
 *
 * A change that touches the amount, or settles the fee, drops the stored link
 * (`paymentUrl` / `sessionExpiresAt`) so it is never handed out again at the old
 * price and the parent's next "Bayar" mints one at the new amount. It KEEPS
 * `gatewaySessionId`: a parent who already opened the old order can still pay it
 * until DOKU expires it, and reconcile / the daily sweep poll on that id, so the
 * payment stays findable. The processor refuses it as AMOUNT_MISMATCH (the fee
 * stays UNPAID), the fee card then shows "perlu dicek", and the money needs a
 * manual refund. The detail GET's `fee.linkActive` is how the UI warns staff
 * BEFORE they change an amount under a parent who may be paying.
 */

const SETTLED = "Biaya pendaftaran ini sudah selesai dan tidak bisa diubah lagi.";
const FORBIDDEN_ACTION = "Anda tidak memiliki izin untuk tindakan ini.";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "admissions.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = session.tenantId;

  const limit = rateLimit(`enrollment-fee:${session.id}`, 30, 60_000);
  if (!limit.success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body bukan JSON yang valid" }, { status: 400 });
  }
  const parsed = await validateBody(enrollmentFeeActionSchema, body);
  if (parsed.error) return parsed.error;
  const action = parsed.data;

  // Money actions need the finance key on top of admissions.edit (see the header).
  const allowed = hasPermission(session, action.action === "MARK_PAID" ? "payments.record" : "fees.edit");
  if (!allowed) return NextResponse.json({ error: FORBIDDEN_ACTION }, { status: 403 });

  // The fee is addressed through its application, and that application must be this tenant's.
  const fee = await prisma.enrollmentFee.findFirst({
    where: { applicationId: id, tenantId },
    select: { id: true },
  });
  if (!fee) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fee.id}))`;
    const before = await tx.enrollmentFee.findUnique({ where: { id: fee.id }, select: ADMIN_FEE_SELECT });
    if (!before) return { type: "MISSING" } as const;
    if (before.status !== "UNPAID") return { type: "SETTLED" } as const;
    const hadLiveLink = toAdminFeeView(before, now).linkActive;

    let data: Record<string, unknown>;
    if (action.action === "DISCOUNT") {
      const next = applyDiscount(Number(before.baseAmount), action.discountPercent);
      const waived = next.amount === 0 && Number(before.baseAmount) > 0;
      // Re-saving the same price (or only editing the reason) must not take a
      // working link away from a parent who is in the middle of paying.
      const amountChanged = next.amount !== Math.round(Number(before.amount));
      data = {
        discountPercent: next.discountPercent,
        discountReason: next.discountPercent > 0 ? (action.reason ?? null) : null,
        amount: next.amount,
        ...(amountChanged || waived ? DROP_LINK : {}),
        ...(waived ? { status: "WAIVED", method: "WAIVED", markedBy: session.id } : {}),
      };
    } else if (action.action === "MARK_PAID") {
      data = {
        status: "PAID",
        method: action.method,
        paidAt: now,
        markedBy: session.id,
        note: action.note || null,
        ...DROP_LINK,
      };
    } else {
      data = { status: "WAIVED", method: "WAIVED", markedBy: session.id, note: action.note || null, ...DROP_LINK };
    }

    const after = await tx.enrollmentFee.update({ where: { id: fee.id }, data, select: ADMIN_FEE_SELECT });
    const beforeView = toAdminFeeView(before, now);
    const afterView = toAdminFeeView(after, now);
    await recordAudit(
      {
        tenantId,
        actorId: session.id,
        entity: "EnrollmentFee",
        entityId: fee.id,
        action: `fee.${action.action.toLowerCase()}`,
        before: { status: beforeView.status, amount: beforeView.amount, discountPercent: beforeView.discountPercent },
        after: {
          status: afterView.status,
          method: afterView.method,
          amount: afterView.amount,
          discountPercent: afterView.discountPercent,
          reason: action.action === "DISCOUNT" ? (action.reason ?? null) : null,
          note: action.action === "DISCOUNT" ? null : (action.note ?? null),
        },
      },
      tx,
    );
    return { type: "OK", fee: afterView, hadLiveLink } as const;
  });

  if (result.type === "MISSING") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (result.type === "SETTLED") return NextResponse.json({ error: SETTLED }, { status: 409 });
  return NextResponse.json({ fee: result.fee, hadLiveLink: result.hadLiveLink });
}
