import type { Prisma } from "@/lib/generated/prisma/client";
import { BILLABLE_FEE_COMPONENT_WHERE } from "@/lib/finance/billable-fees";

/**
 * Moving a class to another program changes which fee structure its students
 * are billed from (the billing run reads the class's own program). These
 * helpers back the class-update guards and the impact preview in Ubah Kelas.
 */

export function programChangeInvoicedMessage(invoicedStudents: number): string {
  return `Program tidak bisa diubah karena ${invoicedStudents} siswa di kelas ini sudah punya tagihan tahun ajaran ini. Batalkan tagihan itu dulu.`;
}

type InvoiceDb = Pick<Prisma.TransactionClient, "invoice" | "billingRunRow">;

/**
 * Students of the class holding a non-cancelled invoice for the academic year.
 * Invoices carry no year of their own, so a student counts when either
 *  - the invoice came from a committed billing run of that year (the exact
 *    link, which also catches invoices issued before the year's start date), or
 *  - the invoice was created on or after the year's start date, Jakarta time.
 * A manual invoice issued before the start date is the one case missed.
 */
export async function countInvoicedStudents(
  db: InvoiceDb,
  args: { tenantId: string; classSectionId: string; academicYearId: string; yearStartDate: string },
): Promise<number> {
  const enrolledInClass = {
    enrollments: { some: { classSectionId: args.classSectionId, status: { not: "WITHDRAWN" } } },
  };
  const runRows = await db.billingRunRow.findMany({
    where: {
      status: "COMMITTED",
      invoiceId: { not: null },
      billingRun: { tenantId: args.tenantId, academicYearId: args.academicYearId },
      student: enrolledInClass,
    },
    select: { invoiceId: true },
  });
  const runInvoiceIds = runRows.flatMap((r) => (r.invoiceId ? [r.invoiceId] : []));

  const rows = await db.invoice.findMany({
    where: {
      tenantId: args.tenantId,
      status: { not: "CANCELLED" },
      student: enrolledInClass,
      OR: [
        { id: { in: runInvoiceIds } },
        { createdAt: { gte: new Date(`${args.yearStartDate}T00:00:00+07:00`) } },
      ],
    },
    select: { studentId: true },
    distinct: ["studentId"],
  });
  return rows.length;
}

export type TypeChangeConflict = { studentName: string; className: string };

/**
 * The enrolment rule is one ACTIVE enrolment per Program.type per academic
 * year. Moving a class to a program of a different type can break it for a
 * student who also sits in another class of the target type this year; returns
 * the first such student, or `null` when the move is clean (or the type is
 * unchanged, which cannot create a conflict).
 */
export async function findTypeChangeConflict(
  db: Pick<Prisma.TransactionClient, "studentEnrollment">,
  args: { classSectionId: string; academicYearId: string; currentType: string; nextType: string },
): Promise<TypeChangeConflict | null> {
  if (args.currentType === args.nextType) return null;
  const row = await db.studentEnrollment.findFirst({
    where: {
      classSectionId: args.classSectionId,
      status: "ACTIVE",
      student: {
        enrollments: {
          some: {
            status: "ACTIVE",
            classSectionId: { not: args.classSectionId },
            classSection: {
              academicYearId: args.academicYearId,
              program: { type: args.nextType },
            },
          },
        },
      },
    },
    select: {
      student: {
        select: {
          name: true,
          enrollments: {
            where: {
              status: "ACTIVE",
              classSectionId: { not: args.classSectionId },
              classSection: { academicYearId: args.academicYearId, program: { type: args.nextType } },
            },
            take: 1,
            select: { classSection: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!row) return null;
  return {
    studentName: row.student.name,
    className: row.student.enrollments[0]?.classSection.name ?? "kelas lain",
  };
}

export function typeChangeConflictMessage(c: TypeChangeConflict): string {
  return `Program ini berbeda jenis, dan ${c.studentName} sudah terdaftar di kelas ${c.className} pada jenis program yang sama tahun ajaran ini.`;
}

export type RecurringFeeSummary = {
  total: number;
  lines: { label: string; amount: number }[];
};

/** What a billing run would bill per period for a program in a year. */
export async function recurringFeeSummary(
  db: Pick<Prisma.TransactionClient, "programFeeStructure">,
  args: { tenantId: string; programId: string; academicYearId: string },
): Promise<RecurringFeeSummary> {
  const rows = await db.programFeeStructure.findMany({
    where: {
      tenantId: args.tenantId,
      programId: args.programId,
      academicYearId: args.academicYearId,
      feeComponent: BILLABLE_FEE_COMPONENT_WHERE,
    },
    select: { amount: true, feeComponent: { select: { label: true, sortOrder: true } } },
    orderBy: { feeComponent: { sortOrder: "asc" } },
  });
  const lines = rows.map((r) => ({ label: r.feeComponent.label, amount: Number(r.amount) }));
  return { total: lines.reduce((sum, l) => sum + l.amount, 0), lines };
}
