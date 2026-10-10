import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { parsePagination, parseSort, cleanSearch, escapeLike } from "@/lib/api/pagination";
import { paginatedResponse } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const { skip, take, page, pageSize } = parsePagination(searchParams);
  const sort = parseSort(searchParams, {
    allow: ["name", "email", "phone", "createdAt"],
    default: "name",
    defaultOrder: "asc",
  });
  if (sort instanceof Response) return sort;
  const { orderBy } = sort;
  const search = escapeLike(cleanSearch(searchParams.get("search")));
  const status = searchParams.get("status");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId: session.tenantId };
  if (status && status !== "all") where.status = status;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
    ];
  }

  const [guardians, total] = await Promise.all([
    prisma.parent.findMany({
      where,
      skip,
      take,
      orderBy,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        whatsapp: true,
        status: true,
        _count: { select: { guardians: { where: { status: "ACTIVE" } } } },
        // First two children by name, so the list can say WHICH students a
        // wali belongs to instead of only how many. The count above stays
        // authoritative for the total.
        guardians: {
          where: { status: "ACTIVE" },
          take: 2,
          orderBy: { student: { name: "asc" } },
          select: { student: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.parent.count({ where }),
  ]);

  return NextResponse.json({
    ...paginatedResponse(guardians, total, page, pageSize),
    capabilities: { canEdit: hasPermission(session, "students.edit") },
  });
}
