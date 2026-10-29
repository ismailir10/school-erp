import { Prisma } from "@/lib/generated/prisma/client";
import { applyAdjustments, type AdjustmentInput } from "./apply-adjustments";
import type { BundleFee } from "./bundle-fees";

/**
 * Pure classifier + materializer for the Billing Run wizard draft (Cycle B1
 * — docs/cycles/2026-08-14-billing-run-wizard.md, Task T3).
 *
 * Given already-fetched data, resolves the in-scope student set, classifies
 * each student into PENDING / already-invoiced / no-fee-structure, and
 * materializes rows + lines through `applyAdjustments` (the Cycle A resolver
 * — reused unchanged, never reimplemented). No Prisma queries happen here —
 * the route (T4) does the querying and passes plain data in, so this stays
 * unit-testable without mocking Prisma.
 *
 * Cycle `enrollment-flexibility` (T8) — a student may hold more than one
 * in-scope ACTIVE enrollment at once (e.g. one school + one daycare
 * program), so candidates are grouped by studentId and ALL of a student's
 * in-scope enrollments contribute fee lines to a single merged row, rather
 * than the first one winning.
 */

export type BuildEnrollment = {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  classLabel: string | null;
  programId: string;
  programName: string;
  classSectionId: string;
};

export type BuildScope = {
  classSectionIds: string[];
  includeStudentIds: string[];
  excludeStudentIds: string[];
};

export type FeeStructureLine = {
  feeComponentId: string;
  label: string;
  amount: Prisma.Decimal;
};

export type BuildInput = {
  enrollments: BuildEnrollment[];
  scope: BuildScope;
  feesByProgram: Map<string, FeeStructureLine[]>;
  adjustmentsByStudent: Map<string, AdjustmentInput[]>;
  alreadyInvoicedStudentIds: Set<string>;
  /**
   * Enrollments on leave (cuti) for the run's month. Optional: absent or empty
   * leaves behaviour untouched. Leave is per enrollment, so a student is
   * skipped only when EVERY in-scope enrollment is on leave.
   */
  onLeaveEnrollmentIds?: ReadonlySet<string>;
  /**
   * Harga paket sekolah + daycare (lib/finance/bundle-fees.ts): an explicit total for one
   * component and one school + daycare program pair. Optional: absent or empty leaves
   * every amount exactly as the per-program sum. Matched by program ids only — the builder
   * does not know Program.type.
   */
  bundleFees?: ReadonlyArray<BundleFee>;
  parentByStudent: Map<string, string | null>;
  academicYearId: string;
  dueDate: string; // YYYY-MM-DD
};

export type BuiltRowStatus =
  | "PENDING"
  | "EXCLUDED"
  | "SKIPPED_ALREADY_INVOICED"
  | "SKIPPED_NO_FEE_STRUCTURE"
  | "SKIPPED_ON_LEAVE";

export type BuiltLine = {
  feeComponentId: string;
  labelSnapshot: string;
  amount: Prisma.Decimal;
  adjustmentAmount: Prisma.Decimal;
  adjustmentNote: string | null;
  finalAmount: Prisma.Decimal;
  source: "BASE";
};

export type BuiltRow = {
  studentId: string;
  studentNameSnapshot: string;
  classLabelSnapshot: string | null;
  parentId: string | null;
  status: BuiltRowStatus;
  totalDue: Prisma.Decimal;
  lines: BuiltLine[];
};

export type BuildSummary = {
  total: number;
  pending: number;
  excluded: number;
  skippedAlreadyInvoiced: number;
  skippedNoFeeStructure: number;
  skippedOnLeave: number;
  withAdjustments: number;
};

export function buildBillingRunRows(input: BuildInput): {
  rows: BuiltRow[];
  summary: BuildSummary;
} {
  const {
    enrollments,
    scope,
    feesByProgram,
    adjustmentsByStudent,
    alreadyInvoicedStudentIds,
    onLeaveEnrollmentIds,
    bundleFees,
    parentByStudent,
    academicYearId,
    dueDate,
  } = input;

  const classSectionSet = new Set(scope.classSectionIds);
  const includeSet = new Set(scope.includeStudentIds);
  const excludeSet = new Set(scope.excludeStudentIds);

  // Per-student scope (docs/cycles/2026-10-29-school-daycare-bundle-price.md,
  // Decision 4): a student is IN the run when ANY of their enrollments is in a
  // ticked class, or they are explicitly included, minus explicit exclusions.
  // An admitted student is then priced for ALL their enrollments in the input
  // (their other placements too), grouped by studentId — a student may hold
  // more than one ACTIVE enrollment (e.g. school + daycare), so none is
  // dropped. `exclude` always wins, whichever path admitted the student.
  const admittedStudentIds = new Set<string>();
  for (const e of enrollments) {
    if (classSectionSet.has(e.classSectionId) || includeSet.has(e.studentId)) {
      admittedStudentIds.add(e.studentId);
    }
  }
  for (const id of excludeSet) admittedStudentIds.delete(id);

  const enrollmentsByStudent = new Map<string, BuildEnrollment[]>();
  for (const e of enrollments) {
    if (!admittedStudentIds.has(e.studentId)) continue;
    const list = enrollmentsByStudent.get(e.studentId);
    if (list) list.push(e);
    else enrollmentsByStudent.set(e.studentId, [e]);
  }

  const rows: BuiltRow[] = [];
  let pending = 0;
  const excluded = 0; // never set here — draft-time exclusion happens post-creation (T5 PATCH), not at build time.
  let skippedAlreadyInvoiced = 0;
  let skippedNoFeeStructure = 0;
  let skippedOnLeave = 0;
  let withAdjustments = 0;

  for (const fullGroup of enrollmentsByStudent.values()) {
    const { studentId, studentName } = fullGroup[0];
    const parentId = parentByStudent.get(studentId) ?? null;

    // Leave (cuti) is per enrollment: drop on-leave enrollments BEFORE the
    // programId dedupe and fee-line building, so a student with two
    // enrollments in the same program, one on leave, is still billed for that
    // program once. With no leave set `group === fullGroup` (unchanged).
    const group = onLeaveEnrollmentIds && onLeaveEnrollmentIds.size > 0
      ? fullGroup.filter((e) => !onLeaveEnrollmentIds.has(e.enrollmentId))
      : fullGroup;

    // Full leave (nothing left to bill) is checked BEFORE already-invoiced, so
    // a student whose invoice was cancelled for leave reads "Sedang cuti".
    if (group.length === 0) {
      skippedOnLeave++;
      const leaveLabels = [
        ...new Set(fullGroup.map((e) => e.classLabel).filter((l): l is string => l !== null)),
      ].sort();
      rows.push({
        studentId,
        studentNameSnapshot: studentName,
        classLabelSnapshot: leaveLabels.length > 0 ? leaveLabels.join(", ") : null,
        parentId,
        status: "SKIPPED_ON_LEAVE",
        totalDue: new Prisma.Decimal(0),
        lines: [],
      });
      continue;
    }

    // Deterministic (sorted) join of every distinct in-scope class name of the
    // BILLED (non-leave) enrollments. A single-enrollment student's group of
    // one collapses to that same single label, so this is byte-identical to
    // today's output when there is only one enrollment.
    const distinctClassLabels = [
      ...new Set(group.map((e) => e.classLabel).filter((l): l is string => l !== null)),
    ].sort();
    const classLabelSnapshot = distinctClassLabels.length > 0 ? distinctClassLabels.join(", ") : null;

    if (alreadyInvoicedStudentIds.has(studentId)) {
      skippedAlreadyInvoiced++;
      rows.push({
        studentId,
        studentNameSnapshot: studentName,
        classLabelSnapshot,
        parentId,
        status: "SKIPPED_ALREADY_INVOICED",
        totalDue: new Prisma.Decimal(0),
        lines: [],
      });
      continue;
    }

    // Concatenate the base fee lines of every distinct in-scope program for
    // this student (deduped by programId so a student with two in-scope
    // classes in the SAME program — a data edge case, not the dual-stream
    // norm — doesn't get that program's fees doubled).
    const distinctProgramIds = [...new Set(group.map((e) => e.programId))];
    const programNameById = new Map<string, string>();
    for (const e of group) {
      if (!programNameById.has(e.programId)) programNameById.set(e.programId, e.programName);
    }

    const baseLines = distinctProgramIds.flatMap((programId) =>
      (feesByProgram.get(programId) ?? []).map((f) => ({ ...f, programId }))
    );

    if (baseLines.length === 0) {
      skippedNoFeeStructure++;
      rows.push({
        studentId,
        studentNameSnapshot: studentName,
        classLabelSnapshot,
        parentId,
        status: "SKIPPED_NO_FEE_STRUCTURE",
        totalDue: new Prisma.Decimal(0),
        lines: [],
      });
      continue;
    }

    // Disambiguate labels by program name ONLY when the merged lines
    // actually span more than one program — a student whose second
    // enrollment's program has no fee structure still gets undisambiguated
    // labels, and a single-program student's labels stay byte-identical to
    // today.
    const contributingProgramIds = new Set(baseLines.map((l) => l.programId));
    const disambiguate = contributingProgramIds.size > 1;

    // `FeeComponentDef` is a TENANT-LEVEL shared catalog (prisma/seed.ts
    // ~1037-1077): the same "spp" component is attached to every program via
    // separate `ProgramFeeStructure` rows with DIFFERENT amounts. A KB +
    // DCARE student therefore produces two base lines carrying the SAME
    // feeComponentId. `applyAdjustments` matches eligible adjustments by
    // feeComponentId per line — feeding it two lines for one shared
    // component would apply a single keringanan grant twice (once per
    // line), which is exactly the bug this merge closes. So: collapse every
    // group of base lines that shares a feeComponentId into ONE line before
    // calling applyAdjustments, so each grant can match at most one line and
    // therefore fires exactly once, "across the merged line set" per spec.
    //
    // PERCENT-base rule for a merged/shared component: the grant's base is
    // the SUMMED amount across every program that shares the component —
    // i.e. the family's total obligation for that fee, not any single
    // program's slice of it. This is the only rule that doesn't privilege
    // whichever program happened to be first, and it keeps a stacked
    // PERCENT+FIXED combination arithmetically coherent (both apply against
    // the same merged base). A single-owner component (the normal case,
    // and every existing test fixture) is a group of size 1 and is passed
    // through byte-identical to today — label and amount unchanged.
    const byComponent = new Map<string, typeof baseLines>();
    for (const line of baseLines) {
      const list = byComponent.get(line.feeComponentId);
      if (list) list.push(line);
      else byComponent.set(line.feeComponentId, [line]);
    }

    const mergedBaseLines = [...byComponent.entries()].map(([feeComponentId, group2]) => {
      if (group2.length === 1) {
        const f = group2[0];
        return {
          feeComponentId,
          labelSnapshot: disambiguate ? `${f.label} (${programNameById.get(f.programId)})` : f.label,
          amount: new Prisma.Decimal(f.amount),
        };
      }
      let amount = group2.reduce(
        (acc, f) => acc.plus(new Prisma.Decimal(f.amount)),
        new Prisma.Decimal(0)
      );
      // Harga paket: when this component's merged line really comes from BOTH programs of
      // exactly one active bundle, the bundle amount replaces those two programs' fees. Any
      // other program carrying the component (a pop-up class) is still added on top. Zero or
      // several matching bundles keep the sum; a one-program component never reaches here.
      if (bundleFees && bundleFees.length > 0) {
        const linePrograms = new Set(group2.map((f) => f.programId));
        const matches = bundleFees.filter(
          (b) =>
            b.feeComponentId === feeComponentId &&
            b.schoolProgramId !== b.daycareProgramId &&
            linePrograms.has(b.schoolProgramId) &&
            linePrograms.has(b.daycareProgramId),
        );
        if (matches.length === 1) {
          const bundle = matches[0];
          amount = group2
            .filter((f) => f.programId !== bundle.schoolProgramId && f.programId !== bundle.daycareProgramId)
            .reduce((acc, f) => acc.plus(new Prisma.Decimal(f.amount)), new Prisma.Decimal(bundle.amount));
        }
      }
      const programNames = [
        ...new Set(group2.map((f) => programNameById.get(f.programId) ?? f.programId)),
      ].sort();
      return {
        feeComponentId,
        labelSnapshot: `${group2[0].label} (${programNames.join(" + ")})`,
        amount,
      };
    });

    // Do NOT re-sum here — `applyAdjustments` owns totalDue (rule 6: the
    // resolver's total is authoritative, never re-derived). Called ONCE over
    // the full merged/concatenated base line set.
    const { lines, totalDue, adjustmentApplied } = applyAdjustments({
      baseLines: mergedBaseLines,
      adjustments: adjustmentsByStudent.get(studentId) ?? [],
      academicYearId,
      dueDate,
    });

    if (adjustmentApplied) withAdjustments++;
    pending++;

    rows.push({
      studentId,
      studentNameSnapshot: studentName,
      classLabelSnapshot,
      parentId,
      status: "PENDING",
      totalDue,
      lines: lines.map((l) => ({ ...l, source: "BASE" as const })),
    });
  }

  return {
    rows,
    summary: {
      total: rows.length,
      pending,
      excluded,
      skippedAlreadyInvoiced,
      skippedNoFeeStructure,
      skippedOnLeave,
      withAdjustments,
    },
  };
}
