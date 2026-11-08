import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { attendanceApproveAllSchema } from "@/lib/validations/attendance";

// POST { ids? } — approve every pending check-in in the tenant, or only the given ids.
export async function POST(req: NextRequest) {
  const { success } = rateLimit(`attendance-approve-all:${getClientIp(req)}`, 10, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const auth = await requirePermission("attendance.override");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const raw: unknown = await req.json().catch(() => ({}));
  const parsed = await validateBody(attendanceApproveAllSchema, raw ?? {});
  if (parsed.error) return parsed.error;
  const { ids } = parsed.data;

  const result = await prisma.attendanceRecord.updateMany({
    where: {
      approvalStatus: "PENDING",
      isLocked: false,
      employee: { tenantId: session.tenantId! },
      ...(ids ? { id: { in: ids } } : {}),
    },
    data: { approvalStatus: "APPROVED", reviewedBy: session.id, reviewedAt: new Date() },
  });

  return NextResponse.json({ count: result.count });
}
