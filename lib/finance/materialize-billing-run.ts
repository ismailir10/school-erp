import { Prisma } from "@/lib/generated/prisma/client";
import { buildBillingRunRows, type BuildEnrollment, type BuiltRow, type BuildSummary } from "@/lib/finance/build-billing-run";
import type { AdjustmentInput } from "@/lib/finance/apply-adjustments";
import { normalizePeriodLabel, parsePeriodMonth } from "@/lib/finance/period-label";
import { BILLABLE_FEE_COMPONENT_WHERE } from "@/lib/finance/billable-fees";

/**
 * Shared draft-materialization path for the Billing Run wizard (Cycle B2 —
 * docs/cycles/2026-08-14-billing-run-wizard-b2.md, Task T2). Extracted
 * verbatim from the read-and-build body of `POST /api/billing-runs` so the
 * rebuild route (Task T4) can call the exact same reads +
 * `buildBillingRunRows()` invocation instead of duplicating them.
 *
 * `db` accepts either the plain `prisma` client or a transaction client —
 * Task T4 calls this from inside a `$transaction`. Typed as
 * `Prisma.TransactionClient` per the convention in
 * lib/finance/invoice-numbers.ts (`reserveInvoiceNumbers`); `prisma` itself
 * is structurally compatible for the read calls made here.
 */

export type MaterializeBillingRunScope = {
  classSectionIds: string[];
  includeStudentIds: string[];
  excludeStudentIds: string[];
};

export type MaterializeBillingRunInput = {
  tenantId: string;
  academicYearId: string;
  /** Must already be trimmed by the caller (`trimmedLabel`). Stored as typed;
   * the duplicate-invoice check compares it through `normalizePeriodLabel`. */
  periodLabel: string;
  dueDate: string;
  scope: MaterializeBillingRunScope;
};

// How far back the normalised duplicate comparison looks for invoices whose
// label is spelled differently from the run's ("Okt 2026" vs "Oktober 2026").
// Bounded so the read stays small; an exact-label match is always found
// regardless of age (see `findAlreadyInvoicedStudentIds`).
const PERIOD_ALIAS_LOOKBACK_DAYS = 400;

/**
 * Students that already hold an invoice for `periodLabel` (FINX-6). The
 * label is free text, so the comparison is on `normalizePeriodLabel` — case,
 * whitespace and Indonesian month abbreviations are equivalent — done in JS
 * over (studentId, periodLabel) pairs. The query keeps the old exact-label
 * match unconditionally (so a backfill of an old period is still caught) and
 * adds every invoice created within the lookback window for alias matching.
 * Shared by the draft builder and the commit route's live re-check.
 */
export async function findAlreadyInvoicedStudentIds(
  db: Pick<Prisma.TransactionClient, "invoice">,
  tenantId: string,
  periodLabel: string,
  studentIds: string[],
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const since = new Date(Date.now() - PERIOD_ALIAS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const existing = await db.invoice.findMany({
    where: {
      tenantId,
      studentId: { in: studentIds },
      OR: [{ periodLabel }, { createdAt: { gte: since } }],
    },
    select: { studentId: true, periodLabel: true },
  });
  const target = normalizePeriodLabel(periodLabel);
  return new Set(
    existing.filter((i) => normalizePeriodLabel(i.periodLabel) === target).map((i) => i.studentId),
  );
}

export async function materializeBillingRun(
  db: Prisma.TransactionClient,
  input: MaterializeBillingRunInput,
): Promise<{ rows: BuiltRow[]; summary: BuildSummary }> {
  const { tenantId, academicYearId, periodLabel, dueDate, scope } = input;
  const { classSectionIds, includeStudentIds, excludeStudentIds } = scope;

  // Fetch the data buildBillingRunRows needs — same query shapes as
  // app/api/invoices/generate/batch/route.ts, scoped by class-section ∪
  // explicit-include instead of an explicit studentIds list.
  const enrollments = await db.studentEnrollment.findMany({
    where: {
      status: "ACTIVE",
      // A WITHDRAWN / INACTIVE / GRADUATED student can still carry a leftover
      // ACTIVE enrollment row; billing keys off the student's own status too
      // (FINX-5). Applies to the class-scope and explicit-include paths alike.
      student: { status: "ACTIVE" },
      OR: [
        classSectionIds.length > 0 ? { classSectionId: { in: classSectionIds } } : undefined,
        includeStudentIds.length > 0 ? { studentId: { in: includeStudentIds } } : undefined,
      ].filter(Boolean) as Prisma.StudentEnrollmentWhereInput[],
      // Scoped to the run's own academic year — without this, a student's
      // stale ACTIVE row in an ARCHIVED prior year (un-closed by the bulk
      // roster import; see docs/cycles/archive/2026-07-21-historical-roster-visibility.md)
      // is an equally valid `studentId`/`classSectionId` match and would
      // contribute a second year's worth of fee lines to this year's run.
      classSection: { tenantId, academicYearId },
    },
    select: {
      id: true,
      studentId: true,
      classSectionId: true,
      student: { select: { id: true, name: true } },
      classSection: { select: { name: true, programId: true, program: { select: { name: true } } } },
    },
  });

  const buildEnrollments: BuildEnrollment[] = enrollments.map((e) => ({
    enrollmentId: e.id,
    studentId: e.studentId,
    studentName: e.student.name,
    classLabel: e.classSection.name,
    programId: e.classSection.programId,
    programName: e.classSection.program.name,
    classSectionId: e.classSectionId,
  }));

  const candidateStudentIds = [...new Set(enrollments.map((e) => e.studentId))];
  const programIds = [...new Set(enrollments.map((e) => e.classSection.programId))];

  // Leave (cuti) only applies to a run whose label is a single month; any other
  // label (semester, range) loads nothing and is never skipped by leave.
  const periodMonth = parsePeriodMonth(periodLabel);
  const periodYm = periodMonth
    ? `${periodMonth.year}-${String(periodMonth.month).padStart(2, "0")}`
    : null;

  const [feeStructures, alreadyInvoicedStudentIds, primaryGuardians, candidateAdjustments, activeLeaves] = await Promise.all([
    db.programFeeStructure.findMany({
      where: {
        programId: { in: programIds },
        academicYearId,
        feeComponent: BILLABLE_FEE_COMPONENT_WHERE,
      },
      include: { feeComponent: true },
    }),
    findAlreadyInvoicedStudentIds(db, tenantId, periodLabel, candidateStudentIds),
    db.studentGuardian.findMany({
      where: { studentId: { in: candidateStudentIds }, isPrimary: true, status: "ACTIVE" },
      select: { studentId: true, parentId: true },
    }),
    // Candidate keringanan grants — narrowed here for efficiency;
    // applyAdjustments() re-checks status/academicYearId/validity itself.
    db.studentFeeAdjustment.findMany({
      where: { tenantId, studentId: { in: candidateStudentIds }, academicYearId, status: "ACTIVE" },
    }),
    // "YYYY-MM" strings compare correctly as text, so the inclusive month
    // range is a plain string comparison.
    periodYm && enrollments.length > 0
      ? db.enrollmentLeave.findMany({
          where: {
            tenantId,
            enrollmentId: { in: enrollments.map((e) => e.id) },
            status: "ACTIVE",
            startMonth: { lte: periodYm },
            endMonth: { gte: periodYm },
          },
          select: { enrollmentId: true },
        })
      : Promise.resolve([] as { enrollmentId: string }[]),
  ]);

  const feesByProgram = new Map<string, { feeComponentId: string; label: string; amount: Prisma.Decimal }[]>();
  for (const fs of feeStructures) {
    const list = feesByProgram.get(fs.programId) ?? [];
    list.push({ feeComponentId: fs.feeComponentId, label: fs.feeComponent.label, amount: fs.amount });
    feesByProgram.set(fs.programId, list);
  }

  const parentByStudent = new Map(primaryGuardians.map((g) => [g.studentId, g.parentId]));

  const adjustmentsByStudent = new Map<string, AdjustmentInput[]>();
  for (const adj of candidateAdjustments) {
    const list = adjustmentsByStudent.get(adj.studentId) ?? [];
    list.push({
      id: adj.id,
      academicYearId: adj.academicYearId,
      feeComponentId: adj.feeComponentId,
      type: adj.type as AdjustmentInput["type"],
      mode: adj.mode as AdjustmentInput["mode"],
      value: adj.value,
      reason: adj.reason,
      status: adj.status,
      validFrom: adj.validFrom,
      validTo: adj.validTo,
    });
    adjustmentsByStudent.set(adj.studentId, list);
  }

  return buildBillingRunRows({
    enrollments: buildEnrollments,
    scope: { classSectionIds, includeStudentIds, excludeStudentIds },
    feesByProgram,
    adjustmentsByStudent,
    alreadyInvoicedStudentIds,
    onLeaveEnrollmentIds: new Set(activeLeaves.map((l) => l.enrollmentId)),
    parentByStudent,
    academicYearId,
    dueDate,
  });
}
