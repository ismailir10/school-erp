import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { saveFeeStructureSchema } from "@/lib/validations/fee-structure";

// Cache GET responses for 1 day — fee structures change ~once per academic year
export const revalidate = 86400;

// Get fee structure for a program + academic year
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json([], { status: 401 });
  if (!isAdminRole(session.role) || !hasPermission(session, "fees.view")) return NextResponse.json([], { status: 403 });

  const { searchParams } = new URL(req.url);
  const programId = searchParams.get("programId");
  const academicYearId = searchParams.get("academicYearId");

  if (!programId || !academicYearId) {
    return NextResponse.json({ error: "programId and academicYearId required" }, { status: 400 });
  }

  // Verify program and year belong to tenant
  const program = await prisma.program.findFirst({ where: { id: programId, tenantId: session.tenantId } });
  if (!program) return NextResponse.json([], { status: 404 });
  const year = await prisma.academicYear.findFirst({ where: { id: academicYearId, tenantId: session.tenantId } });
  if (!year) return NextResponse.json([], { status: 404 });

  const structures = await prisma.programFeeStructure.findMany({
    where: { programId, academicYearId },
    include: { feeComponent: true },
    orderBy: { feeComponent: { sortOrder: "asc" } },
  });
  return NextResponse.json(structures);
}

// Bulk save fee structure for a program + academic year
export async function PUT(req: NextRequest) {
  const { success } = rateLimit(`save-fee-structure:${getClientIp(req)}`, 20, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "fees.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = saveFeeStructureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Data tidak valid",
        errors: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    );
  }
  const { programId, academicYearId, fees } = parsed.data;

  // Verify tenant ownership of program and academic year
  const program = await prisma.program.findFirst({ where: { id: programId, tenantId: session.tenantId } });
  if (!program) return NextResponse.json({ error: "Program tidak ditemukan" }, { status: 404 });
  const year = await prisma.academicYear.findFirst({ where: { id: academicYearId, tenantId: session.tenantId } });
  if (!year) return NextResponse.json({ error: "Tahun ajaran tidak ditemukan" }, { status: 404 });

  // Verify tenant ownership of every fee component (same pattern as
  // POST /api/invoices) — a foreign cuid would otherwise be durably attached
  // and readable back through GET's `include: { feeComponent: true }`.
  const feeIds = [...new Set(fees.map((f) => f.feeComponentId))];
  if (feeIds.length > 0) {
    const ownedCount = await prisma.feeComponentDef.count({
      where: { id: { in: feeIds }, tenantId: session.tenantId },
    });
    if (ownedCount !== feeIds.length) {
      return NextResponse.json({ error: "Komponen biaya tidak ditemukan" }, { status: 404 });
    }
  }

  for (const fee of fees) {
    await prisma.programFeeStructure.upsert({
      where: {
        programId_academicYearId_feeComponentId: {
          programId,
          academicYearId,
          feeComponentId: fee.feeComponentId,
        },
      },
      update: { amount: fee.amount, notes: fee.notes ?? null },
      create: {
        tenantId: session.tenantId,
        programId,
        academicYearId,
        feeComponentId: fee.feeComponentId,
        amount: fee.amount,
        notes: fee.notes ?? null,
      },
    });
  }

  revalidatePath("/api/fee-structure");
  return NextResponse.json({ ok: true });
}
