import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { findNegativeNet } from "@/lib/payroll/generation-guards";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { formatDate } from "@/lib/format";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("payroll.approve");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  if (!hasPermission(session, "hr.view")) return NextResponse.json({ error: "forbidden", missing: "hr.view" }, { status: 403 });

  const { id } = await params;

  const payroll = await prisma.payrollRun.findUnique({ where: { id } });
  if (!payroll || payroll.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // HRX-5: approval locks attendance and publishes slips, so it can only happen
  // once the period is over — the whole of periodEnd still counts as a working
  // day, so the earliest approval date is the day after it (Asia/Jakarta).
  // Only for DRAFT: any other status falls through to the 409 below.
  if (payroll.status === "DRAFT") {
    const today = getTodayInTimezone("Asia/Jakarta");
    if (payroll.periodEnd >= today) {
      const end = new Date(`${payroll.periodEnd}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      const firstDay = end.toISOString().slice(0, 10);
      return NextResponse.json(
        { error: `Periode belum selesai. Penggajian bisa disetujui mulai ${formatDate(firstDay)}.` },
        { status: 409 },
      );
    }
  }

  // HR-12: a slip with a negative net amount must be fixed (adjustment, variable
  // edit, salary structure) before the run can be approved.
  const items = await prisma.payrollItem.findMany({
    where: { payrollRunId: id },
    select: { employeeId: true, netAmount: true, employee: { select: { nama: true } } },
  });
  const negativeItems = findNegativeNet(
    items.map((i) => ({ nama: i.employee?.nama ?? i.employeeId, netAmount: Number(i.netAmount) })),
  );
  if (negativeItems.length > 0) {
    return NextResponse.json(
      {
        error: `Tidak bisa disetujui: gaji bersih negatif untuk ${negativeItems
          .map((i) => i.nama)
          .join(", ")}. Perbaiki penyesuaian atau struktur gaji lebih dulu.`,
      },
      { status: 422 },
    );
  }

  // Compare-and-swap on status. Two concurrent approve requests both used to
  // pass the `status === "DRAFT"` read above before either committed, leading
  // to a double-approve. updateMany with the status predicate flips DRAFT to
  // APPROVED atomically and reports `count` so we can detect a lost race
  // without serializable isolation.
  const flip = await prisma.payrollRun.updateMany({
    where: { id, status: "DRAFT" },
    data: {
      status: "APPROVED",
      approvedBy: session.id,
      approvedAt: new Date(),
    },
  });
  if (flip.count === 0) {
    // Either status was not DRAFT to begin with, or another approve raced
    // ahead. 409 is the correct shape for both — caller refetches state.
    return NextResponse.json(
      { error: "Hanya draf yang bisa disetujui" },
      { status: 409 }
    );
  }

  // Lock attendance rows after the status flip. Done outside the CAS so a
  // failure here leaves the run APPROVED but with attendance still mutable —
  // the lock is a payroll-rerun guard, not a financial primitive. A future
  // background job can reconcile any rare gap.
  if (items.length > 0) {
    await prisma.attendanceRecord.updateMany({
      where: {
        employeeId: { in: items.map((i) => i.employeeId) },
        date: { gte: payroll.periodStart, lte: payroll.periodEnd },
      },
      data: { isLocked: true },
    });
  }

  return NextResponse.json({ ok: true });
}
