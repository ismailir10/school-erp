import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { invalidateAdminHeaderContext } from "@/lib/admin/header-context-tag";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { createCampusSchema } from "@/lib/validations/campus";

// Cache campuses for 1 hour (static data)
export const revalidate = 3600;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json([], { status: 401 });
  // HR-16: campus coordinates and employee counts are read by admin screens only.
  if (!isAdminRole(session.role)) return NextResponse.json([], { status: 403 });

  // FIND-004: support an optional `?status=` query so the Campus page can
  // surface deactivated rows for the reactivate flow. Default remains ACTIVE
  // for backwards compatibility (the dropdown population in dialogs etc.
  // should never see inactive campuses without explicit opt-in). `req` is
  // guarded because existing tests call GET() with no argument at runtime.
  const statusParam = req?.nextUrl?.searchParams.get("status") ?? null;
  const where: { tenantId: string; status?: "ACTIVE" | "INACTIVE" } = {
    tenantId: session.tenantId,
  };
  if (statusParam === "INACTIVE") where.status = "INACTIVE";
  else if (statusParam === "ALL") {
    // no status filter
  } else where.status = "ACTIVE";

  const campuses = await prisma.campus.findMany({
    where,
    include: { _count: { select: { employees: true } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(campuses);
}

export async function POST(req: NextRequest) {
  const { success } = rateLimit(`create-campus:${getClientIp(req)}`, 5, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await validateBody(createCampusSchema, await req.json());
  if (result.error) return result.error;
  const { name, address, lat, lng, radiusMeters } = result.data;

  const campus = await prisma.campus.create({
    data: {
      tenantId: session.tenantId,
      name,
      address: address ?? null,
      lat: lat ?? null,
      lng: lng ?? null,
      // Omitted → the column default (50 m).
      radiusMeters,
    },
  });

  invalidateAdminHeaderContext();
  return NextResponse.json(campus, { status: 201 });
}
