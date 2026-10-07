import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { invalidateAdminHeaderContext } from "@/lib/admin/header-context-tag";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { demoteOtherActiveYears } from "@/lib/academic-year/activate";
import { validateBody } from "@/lib/api/validate";
import { fieldErrorResponse, isUniqueViolation } from "@/lib/api/field-errors";
import { academicYearOverlapMessage, createAcademicYearSchema } from "@/lib/validations/academic-year";

export const revalidate = 86400; // 24h — academic years rarely change

export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json([], { status: 401 });
  // HR-16: only admin screens fetch academic years over the API.
  if (!isAdminRole(session.role)) return NextResponse.json([], { status: 403 });

  const years = await prisma.academicYear.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { startDate: "desc" },
  });
  return NextResponse.json(years);
}

export async function POST(req: NextRequest) {
  const { success } = rateLimit(`create-academic-year:${getClientIp(req)}`, 5, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = await validateBody(createAcademicYearSchema, await req.json().catch(() => null));
  if (parsed.error) return parsed.error;
  const { name, startDate, endDate, status } = parsed.data;

  const tenantId = session.tenantId; // narrow before transaction closure re-widens it

  // ADM-13: a year may not overlap another non-archived year (inclusive ends).
  // Dates are YYYY-MM-DD strings, so lexicographic comparison is chronological.
  const overlapping = await prisma.academicYear.findFirst({
    where: {
      tenantId,
      status: { not: "ARCHIVED" },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    select: { name: true },
  });
  if (overlapping) {
    return fieldErrorResponse("startDate", academicYearOverlapMessage(overlapping.name));
  }

  const data = { tenantId, name, startDate, endDate, status: status ?? "PLANNING" };

  // If created ACTIVE, demote any existing ACTIVE year first — single-active
  // invariant (at most one ACTIVE year per tenant). No exceptId: the new row
  // does not exist yet when the demotion runs.
  try {
    const year =
      data.status === "ACTIVE"
        ? await prisma.$transaction(async (tx) => {
            await demoteOtherActiveYears(tx, tenantId);
            return tx.academicYear.create({ data });
          })
        : await prisma.academicYear.create({ data });
    invalidateAdminHeaderContext();
    return NextResponse.json(year, { status: 201 });
  } catch (error) {
    // @@unique([tenantId, name]) — a repeated name was an unhandled 500 with a
    // bare "Gagal menyimpan" (CORE-5). Report it on the Nama field.
    if (isUniqueViolation(error)) {
      return fieldErrorResponse("name", "Nama tahun ajaran sudah dipakai");
    }
    throw error;
  }
}
