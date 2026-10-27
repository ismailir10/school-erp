import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import {
  countInvoicedStudents,
  programChangeInvoicedMessage,
  recurringFeeSummary,
} from "@/lib/classes/program-change";

// Read-only preview for the Ubah Kelas dialog: what the class is billed per
// period today, what it would be billed under `?programId=`, how many active
// students are affected, and whether the move is blocked by existing invoices.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("academic.view");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  // Fee amounts and invoice counts: a role may hold academic.view without
  // fees.view, so the finance permission is required on top.
  if (!hasPermission(session, "fees.view")) {
    return NextResponse.json({ error: "forbidden", missing: "fees.view" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const section = await prisma.classSection.findFirst({
    where: { id, tenantId: session.tenantId },
    select: {
      id: true,
      academicYearId: true,
      program: { select: { id: true, name: true } },
      academicYear: { select: { id: true, name: true, startDate: true } },
    },
  });
  if (!section) {
    return NextResponse.json({ error: "Kelas tidak ditemukan" }, { status: 404 });
  }

  const nextProgramId = new URL(req.url).searchParams.get("programId");
  const next =
    nextProgramId && nextProgramId !== section.program.id
      ? await prisma.program.findFirst({
          where: { id: nextProgramId, tenantId: session.tenantId, status: "ACTIVE" },
          select: { id: true, name: true },
        })
      : null;
  if (nextProgramId && nextProgramId !== section.program.id && !next) {
    return NextResponse.json({ error: "Program tidak ditemukan" }, { status: 404 });
  }

  const [activeStudents, invoicedStudents, currentFees, nextFees] = await Promise.all([
    prisma.studentEnrollment.count({
      where: {
        classSectionId: id,
        status: "ACTIVE",
        student: { status: "ACTIVE", tenantId: session.tenantId },
      },
    }),
    countInvoicedStudents(prisma, {
      tenantId: session.tenantId,
      classSectionId: id,
      academicYearId: section.academicYearId,
      yearStartDate: section.academicYear.startDate,
    }),
    recurringFeeSummary(prisma, {
      tenantId: session.tenantId,
      programId: section.program.id,
      academicYearId: section.academicYearId,
    }),
    next
      ? recurringFeeSummary(prisma, {
          tenantId: session.tenantId,
          programId: next.id,
          academicYearId: section.academicYearId,
        })
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    academicYear: { id: section.academicYear.id, name: section.academicYear.name },
    activeStudents,
    invoicedStudents,
    blockedReason: invoicedStudents > 0 ? programChangeInvoicedMessage(invoicedStudents) : null,
    current: { programId: section.program.id, programName: section.program.name, fees: currentFees },
    next: next && nextFees ? { programId: next.id, programName: next.name, fees: nextFees } : null,
  });
}
