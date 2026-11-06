import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { badRequest, findCampus, notFound } from "../_helpers";

export async function GET(req: NextRequest) {
  const auth = await requirePermission("academic.view");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const campusId = new URL(req.url).searchParams.get("campusId");
  if (!campusId) return badRequest("campusId wajib disediakan.");
  if (!(await findCampus(campusId, session.tenantId))) {
    return notFound("Kampus");
  }

  const yearFilter = { in: ["ACTIVE", "PLANNING"] };
  const [employees, classes, academicYears] = await Promise.all([
    prisma.employee.findMany({
      where: { tenantId: session.tenantId, campusId, status: "ACTIVE" },
      orderBy: { nama: "asc" },
      select: { id: true, nama: true },
    }),
    prisma.classSection.findMany({
      where: {
        tenantId: session.tenantId,
        campusId,
        academicYear: { status: yearFilter },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, academicYearId: true },
    }),
    prisma.academicYear.findMany({
      where: { tenantId: session.tenantId, status: yearFilter },
      orderBy: { startDate: "desc" },
      select: { id: true, name: true, status: true },
    }),
  ]);

  return NextResponse.json({
    employees: employees.map((e) => ({ id: e.id, name: e.nama })),
    classes,
    academicYears,
  });
}
