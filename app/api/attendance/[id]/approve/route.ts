import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { attendanceReviewSchema } from "@/lib/validations/attendance";
import { reviewPendingAttendance } from "@/lib/attendance/review";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`attendance-approve:${getClientIp(req)}`, 60, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const auth = await requirePermission("attendance.override");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { id } = await params;
  // The body is optional ({ note? }); an empty body is a plain one-tap decision.
  const raw: unknown = await req.json().catch(() => ({}));
  const parsed = await validateBody(attendanceReviewSchema, raw ?? {});
  if (parsed.error) return parsed.error;

  return reviewPendingAttendance({
    id,
    tenantId: session.tenantId!,
    reviewerId: session.id,
    note: parsed.data.note || null,
    decision: "APPROVED",
  });
}
