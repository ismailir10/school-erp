import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { parsePagination, cleanSearch, escapeLike } from "@/lib/api/pagination";
import { paginatedResponse } from "@/lib/api/response";

// Teacher picker for the class detail page (add-teacher + swap-session
// dialogs). Gated on academic.edit, NOT hr.view: the picker feeds the
// teaching-assignment write, which is gated on academic.edit, and SCHOOL_ADMIN
// holds academic.edit but lacks hr.view by design — so the HR list endpoint
// 403'd and the dialog claimed "no teachers". See
// docs/cycles/2026-10-01-teacher-picker-access.md.
//
// Deliberately minimal select (id, nama, formalName): no email, phone, salary,
// bank or other HR fields leak to academic.edit holders.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id: classId } = await params;

  const classSection = await prisma.classSection.findFirst({
    where: { id: classId, tenantId: session.tenantId },
    select: { id: true },
  });
  if (!classSection) {
    return NextResponse.json(
      { error: "Kelas tidak ditemukan" },
      { status: 404 },
    );
  }

  const { searchParams } = new URL(req.url);
  const { skip, take, page, pageSize } = parsePagination(searchParams);
  const search = escapeLike(cleanSearch(searchParams.get("search")));

  const where = {
    tenantId: session.tenantId,
    status: "ACTIVE" as const,
    ...(search
      ? { nama: { contains: search, mode: "insensitive" as const } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      select: { id: true, nama: true, formalName: true },
      orderBy: { nama: "asc" },
      skip,
      take,
    }),
    prisma.employee.count({ where }),
  ]);

  return NextResponse.json(paginatedResponse(rows, total, page, pageSize));
}
