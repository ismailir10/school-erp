import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rejectLeaveRequestSchema } from "@/lib/validations/leave";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("leave.approve");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  if (!hasPermission(session, "hr.view")) return NextResponse.json({ error: "forbidden", missing: "hr.view" }, { status: 403 });

  const { id } = await params;
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Data tidak valid" }, { status: 400 });
  }
  const result = await validateBody(rejectLeaveRequestSchema, rawBody);
  if (result.error) return result.error;
  const { note } = result.data;

  const request = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { employee: { select: { tenantId: true } } },
  });

  if (!request || request.employee.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (request.status !== "PENDING") {
    return NextResponse.json({ error: "Hanya pengajuan PENDING yang bisa ditolak" }, { status: 400 });
  }

  // Conditional update: a concurrent approve/reject/cancel that already moved
  // the row leaves count 0, so the loser gets 409 instead of a second 200.
  const claimed = await prisma.leaveRequest.updateMany({
    where: { id, status: "PENDING" },
    data: {
      status: "REJECTED",
      reviewedBy: session.id,
      reviewedAt: new Date(),
      reviewNote: note,
    },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "Pengajuan ini sudah diproses." }, { status: 409 });
  }

  const updated = await prisma.leaveRequest.findUnique({ where: { id } });
  return NextResponse.json(updated);
}
