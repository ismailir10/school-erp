import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { recordAudit } from "@/lib/audit";
import { cancelEnrollmentLeaveSchema } from "@/lib/validations/enrollment-leave";
import { findOpenRunsCoveredByLeave } from "@/lib/enrollment-leave/billing-runs";

// Cancel a leave: PUT { status: "INACTIVE" }. A leave is created or cancelled,
// never edited, and cancelling never touches billing runs or invoices — a stale
// "Sedang cuti" row under-bills, which is the safe direction. The response lists
// the open runs covering the leave so the UI can say "hitung ulang draf".

class LeaveError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; leaveId: string }> },
) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasPermission(session, "students.edit")) {
    return NextResponse.json({ error: "forbidden", missing: "students.edit" }, { status: 403 });
  }
  if (!hasPermission(session, "invoices.create")) {
    return NextResponse.json({ error: "forbidden", missing: "invoices.create" }, { status: 403 });
  }
  const { success } = rateLimit(`cancel-enrollment-leave:${session.id}`, 30, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi." }, { status: 429 });
  }
  const { tenantId, id: actorId } = session;

  const { id: studentId, leaveId } = await params;
  const result = await validateBody(cancelEnrollmentLeaveSchema, await req.json().catch(() => ({})));
  if (result.error) return result.error;

  // Tenant + student ownership: a leave of another tenant or another student is a 404.
  const existing = await prisma.enrollmentLeave.findFirst({
    where: { id: leaveId, tenantId, studentId },
    select: { id: true, enrollmentId: true },
  });
  if (!existing) return NextResponse.json({ error: "Cuti tidak ditemukan" }, { status: 404 });

  try {
    const leave = await prisma.$transaction(async (tx) => {
      // Same key as creation: a cancel and a create for one enrollment queue up.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`enrollment-leave:${existing.enrollmentId}`}))`;
      const fresh = await tx.enrollmentLeave.findFirst({ where: { id: leaveId, tenantId, studentId } });
      if (!fresh) throw new LeaveError("Cuti tidak ditemukan", 404);
      if (fresh.status !== "ACTIVE") {
        throw new LeaveError("Cuti ini sudah dibatalkan.", 409, "ALREADY_CANCELLED");
      }
      const updated = await tx.enrollmentLeave.update({
        where: { id: leaveId },
        data: { status: "INACTIVE", cancelledBy: actorId, cancelledAt: new Date() },
      });
      await recordAudit(
        {
          tenantId,
          actorId,
          entity: "EnrollmentLeave",
          entityId: leaveId,
          action: "cancel",
          before: { status: "ACTIVE" },
          after: {
            status: "INACTIVE",
            studentId: fresh.studentId,
            enrollmentId: fresh.enrollmentId,
            startMonth: fresh.startMonth,
            endMonth: fresh.endMonth,
          },
        },
        tx,
      );
      return updated;
    });

    let affectedRuns: Awaited<ReturnType<typeof findOpenRunsCoveredByLeave>> = [];
    try {
      affectedRuns = await findOpenRunsCoveredByLeave(prisma, {
        tenantId,
        startMonth: leave.startMonth,
        endMonth: leave.endMonth,
      });
    } catch (err) {
      console.error("enrollment-leave cancel follow-up:", err);
    }
    return NextResponse.json({ leave, affectedRuns });
  } catch (err) {
    if (err instanceof LeaveError) {
      return NextResponse.json(
        { error: err.message, ...(err.code ? { code: err.code } : {}) },
        { status: err.status },
      );
    }
    console.error("cancel enrollment leave:", err);
    return NextResponse.json({ error: "Terjadi kesalahan server" }, { status: 500 });
  }
}
