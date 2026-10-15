import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { parsePagination, parseSort, cleanSearch, escapeLike } from "@/lib/api/pagination";
import { paginatedResponse } from "@/lib/api/response";
import { canRemind } from "@/lib/enrollment/follow-up";
import { isFeeClosed } from "@/lib/enrollment/fee-closed";

/**
 * GET /api/enrollments — admin list of enrollment applications. Tenant-scoped,
 * admin-gated, paginated. Supports ?status=, ?payment= and ?search= (child name / parent
 * email). Returns lean rows for the list table; full record is GET [id].
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "admissions.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const canEdit = hasPermission(session, "admissions.edit");

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
  const payment = searchParams.get("payment");
  const search = escapeLike(cleanSearch(searchParams.get("search")));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId: session.tenantId };
  if (status && status !== "all") where.status = status;
  // Pendaftaran fee: "unpaid" | "paid" | "waived" filter on the fee's status,
  // "none" on applications with no fee at all (a free program).
  if (payment === "unpaid" || payment === "paid" || payment === "waived") {
    where.fee = { is: { status: payment.toUpperCase() } };
    // "Belum bayar" is the chase list: a rejected application's link is closed, so
    // it is not one — unless the caller filtered by status on purpose.
    if (payment === "unpaid" && (!status || status === "all")) where.status = { not: "REJECTED" };
  } else if (payment === "none") {
    where.fee = { is: null };
  }
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
        fee: { select: { status: true, amount: true } },
        // Only to tell whether a WhatsApp reminder CAN be sent for an unpaid row;
        // none of these fields is returned, and the access token is not read at
        // all (the reminder endpoint builds the link, for one row, on click).
        ...(canEdit
          ? {
              ayahData: true,
              ibuData: true,
              admission: { select: { status: true, parentPhone: true, parentWhatsapp: true } },
            }
          : {}),
      },
    }),
    prisma.enrollmentApplication.count({ where }),
  ]);

  const data = rows.map((row) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { ayahData, ibuData, admission, fee, ...lean } = row as any;
    const amount = fee ? Math.round(Number(fee.amount)) : 0;
    // Whether the WhatsApp reminder can be sent, only where there is something to chase:
    // any unpaid fee, including a formulir still INVITED (pay-first, the link leads to
    // the "Bayar dulu" screen). A REJECTED application or a CANCELLED lead has its pay
    // link closed, so there is nothing to chase.
    const followUp =
      canEdit && fee?.status === "UNPAID" && !isFeeClosed({ status: lean.status, admission })
        ? { canRemind: canRemind({ admission, ayahData, ibuData }) }
        : null;
    return { ...lean, fee: fee ? { status: fee.status, amount } : null, followUp };
  });

  return NextResponse.json(paginatedResponse(data, total, page, pageSize));
}
