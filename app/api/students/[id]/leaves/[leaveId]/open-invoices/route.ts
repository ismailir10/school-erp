import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  OPEN_INVOICES_NOTE,
  findOpenInvoicesForLeave,
  hasOtherActiveEnrollments,
} from "@/lib/enrollment-leave/open-invoices";

// "Cek tagihan": the student's still-cancellable invoices for the months a leave
// covers. Re-openable at any time because a commit in flight can create an
// invoice after the list shown when the leave was saved. Read-only — cancelling
// an invoice stays the existing POST /api/invoices/[id]/void (invoices.void).

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; leaveId: string }> },
) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasPermission(session, "invoices.view")) {
    return NextResponse.json({ error: "forbidden", missing: "invoices.view" }, { status: 403 });
  }
  if (!hasPermission(session, "students.view")) {
    return NextResponse.json({ error: "forbidden", missing: "students.view" }, { status: 403 });
  }
  const tenantId = session.tenantId;

  const { id: studentId, leaveId } = await params;
  const leave = await prisma.enrollmentLeave.findFirst({
    where: { id: leaveId, tenantId, studentId },
    select: {
      id: true,
      studentId: true,
      enrollmentId: true,
      startMonth: true,
      endMonth: true,
      status: true,
      enrollment: { select: { classSection: { select: { academicYearId: true } } } },
    },
  });
  if (!leave) return NextResponse.json({ error: "Cuti tidak ditemukan" }, { status: 404 });

  const [openInvoices, otherActiveEnrollments] = await Promise.all([
    findOpenInvoicesForLeave(prisma, {
      tenantId,
      studentId: leave.studentId,
      startMonth: leave.startMonth,
      endMonth: leave.endMonth,
    }),
    hasOtherActiveEnrollments(prisma, {
      tenantId,
      studentId: leave.studentId,
      enrollmentId: leave.enrollmentId,
      academicYearId: leave.enrollment.classSection.academicYearId,
    }),
  ]);

  return NextResponse.json({
    leave: { id: leave.id, startMonth: leave.startMonth, endMonth: leave.endMonth, status: leave.status },
    openInvoices,
    canVoid: hasPermission(session, "invoices.void"),
    otherActiveEnrollments,
    note: OPEN_INVOICES_NOTE,
  });
}
