import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";

/**
 * F-28: payroll-run cancel endpoint.
 *
 * Cancels a DRAFT payroll run. Reverse of the generate flow — once a run is
 * cancelled there is no payroll history to preserve, so child rows
 * (`PayrollItem` + `PayrollItemLine`) can be deleted outright. Schema cascade
 * (`PayrollItemLine` → `PayrollItem` ON DELETE CASCADE) means deleting items
 * also reaps lines; we still call `deleteMany` on lines first as a defensive
 * no-op so the contract is explicit and would survive a cascade-removal in
 * a future schema change.
 *
 * Concurrency: compare-and-swap on `status: DRAFT`. Two concurrent cancels
 * (or a cancel racing an approve) cannot both succeed — the second updateMany
 * returns count: 0 → 409. Same shape as the approve route.
 *
 * APPROVED / EXPORTED / CANCELLED runs → 409 (not 400) so the caller knows
 * the resource still exists and a refetch will reveal the live state.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`payroll-cancel:${getClientIp(req)}`, 30, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const auth = await requirePermission("payroll.create");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { id } = await params;

  const payroll = await prisma.payrollRun.findUnique({ where: { id } });
  if (!payroll || payroll.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // CAS flip first. If another writer raced ahead, count === 0 → 409.
  const flip = await prisma.payrollRun.updateMany({
    where: { id, status: "DRAFT" },
    data: { status: "CANCELLED" },
  });
  if (flip.count === 0) {
    return NextResponse.json(
      { error: "Hanya draf yang bisa dibatalkan" },
      { status: 409 }
    );
  }

  // Delete child rows. Schema declares `PayrollItemLine` cascades from
  // `PayrollItem`, but we delete lines explicitly first so the cleanup is
  // visible in the audit trail and survives any future schema rework that
  // weakens the cascade.
  await prisma.payrollItemLine.deleteMany({
    where: { payrollItem: { payrollRunId: id } },
  });
  await prisma.payrollItem.deleteMany({
    where: { payrollRunId: id },
  });

  // Best-effort audit. Failure here is logged but does not roll back the
  // cancellation — the row has already been flipped via CAS and the items
  // deleted. A missing audit row is preferable to a half-cancelled run.
  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.id,
    entity: "PayrollRun",
    entityId: id,
    action: "cancel",
    before: { status: "DRAFT" },
    after: { status: "CANCELLED" },
  });

  return NextResponse.json({ ok: true });
}
