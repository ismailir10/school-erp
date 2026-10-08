import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
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
    allow: ["name", "email", "role", "status", "createdAt", "lastLoginAt"],
    default: "name",
    defaultOrder: "asc",
  });
  if (sort instanceof Response) return sort;
  const { orderBy } = sort;
  const search = escapeLike(cleanSearch(searchParams.get("search")));
  const status = searchParams.get("status");
  const role = searchParams.get("role");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId: session.tenantId };
  if (status && status !== "all") where.status = status;
  if (role && role !== "all") where.role = role;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take,
      include: {
        customRole: { select: { id: true, name: true, code: true } },
      },
      orderBy,
    }),
    prisma.user.count({ where }),
  ]);

  return NextResponse.json(paginatedResponse(users, total, page, pageSize));
}
