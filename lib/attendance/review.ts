import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Shared decision step for POST /api/attendance/[id]/approve and /reject.
 * Tenant-scoped through the employee; only a PENDING, unlocked record moves,
 * and the write is conditional so two admins deciding at once cannot both win.
 */
export async function reviewPendingAttendance(opts: {
  id: string;
  tenantId: string;
  reviewerId: string;
  note: string | null;
  decision: "APPROVED" | "REJECTED";
}): Promise<NextResponse> {
  const { id, tenantId, reviewerId, note, decision } = opts;

  const record = await prisma.attendanceRecord.findFirst({
    where: { id, employee: { tenantId } },
    select: { id: true, approvalStatus: true, isLocked: true },
  });
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (record.approvalStatus !== "PENDING") {
    return NextResponse.json({ error: "Absensi ini sudah diproses." }, { status: 409 });
  }
  if (record.isLocked) {
    return NextResponse.json({ error: "Record terkunci (payroll sudah disetujui)" }, { status: 400 });
  }

  const claimed = await prisma.attendanceRecord.updateMany({
    where: { id, approvalStatus: "PENDING", isLocked: false, employee: { tenantId } },
    data: {
      approvalStatus: decision,
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      reviewNote: note,
      // A rejected check-in is an absence; an approved one keeps its PRESENT/LATE status.
      ...(decision === "REJECTED" ? { status: "ABSENT" } : {}),
    },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "Absensi ini sudah diproses." }, { status: 409 });
  }

  const updated = await prisma.attendanceRecord.findUnique({ where: { id } });
  return NextResponse.json(updated);
}
