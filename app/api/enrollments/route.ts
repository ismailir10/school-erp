import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { parsePagination, parseSort, cleanSearch, escapeLike } from "@/lib/api/pagination";
import { paginatedResponse } from "@/lib/api/response";

/**
 * GET /api/enrollments — admin list of enrollment applications. Tenant-scoped,
 * admin-gated, paginated. Supports ?status= and ?search= (child name / parent
 * email). Returns lean rows for the list table; full record is GET [id].
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "admissions.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const { skip, take, page, pageSize } = parsePagination(searchParams);
  const sort = parseSort(searchParams, {
    allow: ["createdAt", "submittedAt", "childName", "status"],
    default: "createdAt",
    defaultOrder: "desc",
  });
  if (sort instanceof Response) return sort;
  const { orderBy } = sort;

  const status = searchParams.get("status");
  const search = escapeLike(cleanSearch(searchParams.get("search")));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId: session.tenantId };
  if (status && status !== "all") where.status = status;
  if (search) {
    where.OR = [
      { childName: { contains: search, mode: "insensitive" } },
      { parentEmail: { contains: search, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.enrollmentApplication.findMany({
      where,
      skip,
      take,
      orderBy,
      select: {
        id: true,
        childName: true,
        parentEmail: true,
        status: true,
        dcareAddon: true,
        submittedAt: true,
        createdAt: true,
        studentId: true,
        program: { select: { name: true } },
      },
    }),
    prisma.enrollmentApplication.count({ where }),
  ]);

  return NextResponse.json(paginatedResponse(rows, total, page, pageSize));
}
