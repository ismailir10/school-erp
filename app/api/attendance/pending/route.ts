import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";

// Geofence check-ins waiting for an admin decision, oldest first.
export async function GET() {
  const auth = await requirePermission("attendance.override");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const rows = await prisma.attendanceRecord.findMany({
    where: { approvalStatus: "PENDING", employee: { tenantId: session.tenantId! } },
    select: {
      id: true,
      date: true,
      status: true,
      checkInTime: true,
      distanceMeters: true,
      checkInNote: true,
      checkInAccuracy: true,
      nearestCampusId: true,
      employee: { select: { id: true, kode: true, nama: true, jabatan: true, campus: { select: { name: true } } } },
    },
    orderBy: [{ date: "asc" }, { checkInTime: "asc" }],
    take: 500,
  });

  const campusIds = [...new Set(rows.map((r) => r.nearestCampusId).filter((c): c is string => !!c))];
  const campuses = campusIds.length
    ? await prisma.campus.findMany({
        where: { id: { in: campusIds }, tenantId: session.tenantId! },
        select: { id: true, name: true },
      })
    : [];
  const campusName = new Map(campuses.map((c) => [c.id, c.name]));

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      date: r.date,
      status: r.status,
      checkInTime: r.checkInTime?.toISOString() ?? null,
      distanceMeters: r.distanceMeters,
      accuracy: r.checkInAccuracy,
      note: r.checkInNote,
      campusName: (r.nearestCampusId && campusName.get(r.nearestCampusId)) || r.employee.campus.name,
      employee: { id: r.employee.id, kode: r.employee.kode, nama: r.employee.nama, jabatan: r.employee.jabatan },
    })),
  );
}
