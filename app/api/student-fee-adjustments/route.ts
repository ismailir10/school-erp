import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { parsePagination, parseSort, cleanSearch, escapeLike } from "@/lib/api/pagination";
import { paginatedResponse } from "@/lib/api/response";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { createStudentFeeAdjustmentSchema } from "@/lib/validations/student-fee-adjustment";

// Keringanan (durable per-student fee adjustments) — Cycle A,
// docs/cycles/2026-08-13-keringanan-fee-adjustments.md.
//
// Deliberately NO `export const revalidate` here. Unlike the sibling fee
// routes (fee-components, fee-structure) which cache GET for up to a day
// because that data changes ~once a term, StudentFeeAdjustment rows are
// mutable and scoped to one student — an admin can grant, edit, deactivate,
// or reactivate one at any time. Caching this list would risk the admin
// table (or a bulk-generate run) reading a stale keringanan grant for up to
// an hour. Do not add `revalidate` back without re-checking this reasoning.

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const { skip, take, page, pageSize } = parsePagination(searchParams);
  const sort = parseSort(searchParams, {
    allow: ["createdAt", "validFrom", "validTo", "value", "status"],
    default: "createdAt",
    defaultOrder: "desc",
  });
  if (sort instanceof Response) return sort;
  const { orderBy } = sort;

  const studentId = searchParams.get("studentId");
  const academicYearId = searchParams.get("academicYearId");
  const feeComponentId = searchParams.get("feeComponentId");
  const status = searchParams.get("status");
  const search = escapeLike(cleanSearch(searchParams.get("search")));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId: session.tenantId };
  if (studentId) where.studentId = studentId;
  if (academicYearId) where.academicYearId = academicYearId;
  if (feeComponentId) where.feeComponentId = feeComponentId;
  // Only the two real states are honoured. An unrecognised value would
  // otherwise silently return an empty list, which reads as "no keringanan
  // granted" — a misleading answer to a billing question.
  if (status && status !== "all") {
    if (status !== "ACTIVE" && status !== "INACTIVE") {
      return NextResponse.json({ error: "Status tidak dikenal" }, { status: 400 });
    }
    where.status = status;
  }
  if (search) {
    // Student name / NIS search, same shape as app/api/students/route.ts —
    // scoped through the relation since this list is adjustment-rows, not
    // student-rows.
    where.student = {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { nis: { contains: search, mode: "insensitive" } },
      ],
    };
  }

  const [adjustments, total] = await Promise.all([
    prisma.studentFeeAdjustment.findMany({
      where,
      skip,
      take,
      include: {
        student: { select: { name: true, nis: true } },
        feeComponent: { select: { label: true } },
        academicYear: { select: { name: true } },
      },
      orderBy,
    }),
    prisma.studentFeeAdjustment.count({ where }),
  ]);

  return NextResponse.json(paginatedResponse(adjustments, total, page, pageSize));
}

export async function POST(req: NextRequest) {
  const { success } = rateLimit(`create-student-fee-adjustment:${getClientIp(req)}`, 20, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createStudentFeeAdjustmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { studentId, academicYearId, feeComponentId, type, mode, value, reason, validFrom, validTo } =
    parsed.data;
  const tenantId = session.tenantId;

  // Verify every referenced id belongs to this tenant before writing — same
  // pattern as app/api/fee-structure/route.ts:55-71. tenantId and createdBy
  // are always derived from the session below, never taken from the request
  // body (the schema doesn't even accept those fields).
  const [student, academicYear, feeComponent] = await Promise.all([
    prisma.student.findFirst({ where: { id: studentId, tenantId } }),
    prisma.academicYear.findFirst({ where: { id: academicYearId, tenantId } }),
    prisma.feeComponentDef.findFirst({ where: { id: feeComponentId, tenantId } }),
  ]);
  if (!student) return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 });
  if (!academicYear) {
    return NextResponse.json({ error: "Tahun ajaran tidak ditemukan" }, { status: 404 });
  }
  if (!feeComponent) {
    return NextResponse.json({ error: "Komponen biaya tidak ditemukan" }, { status: 404 });
  }

  const adjustment = await prisma.studentFeeAdjustment.create({
    data: {
      tenantId,
      studentId,
      academicYearId,
      feeComponentId,
      type,
      mode,
      value,
      reason,
      validFrom: validFrom ?? null,
      validTo: validTo ?? null,
      createdBy: session.id,
    },
  });

  return NextResponse.json(adjustment, { status: 201 });
}
