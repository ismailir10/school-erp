import { describe, it, expect } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  buildBillingRunRows,
  type BuildEnrollment,
  type BuildInput,
  type FeeStructureLine,
} from "../build-billing-run";
import type { AdjustmentInput } from "../apply-adjustments";

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

const YEAR = "ay-2026";
const DUE_DATE = "2026-04-10";

function enrollment(overrides: Partial<BuildEnrollment> = {}): BuildEnrollment {
  return {
    enrollmentId: "enr-1",
    studentId: "student-1",
    studentName: "Budi",
    classLabel: "TKIT A",
    programId: "program-tkit",
    programName: "TKIT",
    classSectionId: "class-a",
    ...overrides,
  };
}

function feeLine(overrides: Partial<FeeStructureLine> = {}): FeeStructureLine {
  return {
    feeComponentId: "fc-spp",
    label: "SPP Bulanan",
    amount: D("500000"),
    ...overrides,
  };
}

function adjustment(overrides: Partial<AdjustmentInput> = {}): AdjustmentInput {
  return {
    id: "adj-1",
    academicYearId: YEAR,
    feeComponentId: "fc-spp",
    type: "DISCOUNT",
    mode: "PERCENT",
    value: "10",
    reason: "Diskon saudara kandung",
    status: "ACTIVE",
    validFrom: null,
    validTo: null,
    ...overrides,
  };
}

/** Defaults every field of BuildInput so each test states only what it varies. */
function build(overrides: Partial<BuildInput> = {}) {
  const defaults: BuildInput = {
    enrollments: [enrollment()],
    scope: { classSectionIds: ["class-a"], includeStudentIds: [], excludeStudentIds: [] },
    feesByProgram: new Map([["program-tkit", [feeLine()]]]),
    adjustmentsByStudent: new Map(),
    alreadyInvoicedStudentIds: new Set(),
    parentByStudent: new Map(),
    academicYearId: YEAR,
    dueDate: DUE_DATE,
    ...overrides,
  };
  return buildBillingRunRows(defaults);
}

describe("buildBillingRunRows", () => {
  it("empty enrollments yields an empty result with a zeroed summary", () => {
    const out = build({
      enrollments: [],
      scope: { classSectionIds: ["class-a"], includeStudentIds: [], excludeStudentIds: [] },
    });
    expect(out.rows).toEqual([]);
    expect(out.summary).toEqual({
      total: 0,
      pending: 0,
      excluded: 0,
      skippedAlreadyInvoiced: 0,
      skippedNoFeeStructure: 0,
      skippedOnLeave: 0,
      withAdjustments: 0,
    });
  });

  it("rule 1: a student enrolled in an in-scope class is included", () => {
    const out = build();
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].studentId).toBe("student-1");
    expect(out.rows[0].status).toBe("PENDING");
  });

  it("rule 1: a student not enrolled in any in-scope class and not explicitly included is excluded from the result entirely", () => {
    const out = build({
      enrollments: [enrollment({ classSectionId: "class-z" })],
      scope: { classSectionIds: ["class-a"], includeStudentIds: [], excludeStudentIds: [] },
    });
    expect(out.rows).toHaveLength(0);
    expect(out.summary.total).toBe(0);
  });

  it("a student in includeStudentIds who is not in any selected class still gets a row", () => {
    const out = build({
      enrollments: [enrollment({ studentId: "student-2", classSectionId: "class-not-selected" })],
      scope: { classSectionIds: ["class-a"], includeStudentIds: ["student-2"], excludeStudentIds: [] },
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].studentId).toBe("student-2");
    expect(out.rows[0].status).toBe("PENDING");
  });

  it("excludeStudentIds wins over class scope", () => {
    const out = build({
      enrollments: [enrollment()],
      scope: { classSectionIds: ["class-a"], includeStudentIds: [], excludeStudentIds: ["student-1"] },
    });
    expect(out.rows).toHaveLength(0);
  });

  it("excludeStudentIds wins over includeStudentIds", () => {
    const out = build({
      enrollments: [enrollment()],
      scope: {
        classSectionIds: [],
        includeStudentIds: ["student-1"],
        excludeStudentIds: ["student-1"],
      },
    });
    expect(out.rows).toHaveLength(0);
  });

  it("rule 2: dedup — a student in two in-scope classes yields exactly one row", () => {
    const out = build({
      enrollments: [
        enrollment({ classSectionId: "class-a" }),
        enrollment({ classSectionId: "class-b" }),
      ],
      scope: { classSectionIds: ["class-a", "class-b"], includeStudentIds: [], excludeStudentIds: [] },
    });
    expect(out.rows).toHaveLength(1);
    expect(out.summary.total).toBe(1);
  });

  it("rule 3: an already-invoiced student is SKIPPED_ALREADY_INVOICED with no lines and zero totalDue", () => {
    const out = build({
      alreadyInvoicedStudentIds: new Set(["student-1"]),
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].status).toBe("SKIPPED_ALREADY_INVOICED");
    expect(out.rows[0].lines).toEqual([]);
    expect(out.rows[0].totalDue.toString()).toBe("0");
    expect(out.summary.skippedAlreadyInvoiced).toBe(1);
    expect(out.summary.pending).toBe(0);
  });

  it("rule 4: a program with no active recurring fee structures is SKIPPED_NO_FEE_STRUCTURE with no lines and zero totalDue", () => {
    const out = build({
      feesByProgram: new Map(),
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].status).toBe("SKIPPED_NO_FEE_STRUCTURE");
    expect(out.rows[0].lines).toEqual([]);
    expect(out.rows[0].totalDue.toString()).toBe("0");
    expect(out.summary.skippedNoFeeStructure).toBe(1);
    expect(out.summary.pending).toBe(0);
  });

  it("rule 5+6: an eligible student gets PENDING lines built by applyAdjustments, totalDue is the resolver's total", () => {
    const out = build({
      feesByProgram: new Map([
        ["program-tkit", [feeLine({ feeComponentId: "fc-spp", amount: D("500000") })]],
      ]),
      adjustmentsByStudent: new Map([
        ["student-1", [adjustment({ mode: "PERCENT", value: "10" })]],
      ]),
    });
    expect(out.rows).toHaveLength(1);
    const row = out.rows[0];
    expect(row.status).toBe("PENDING");
    expect(row.lines).toHaveLength(1);
    expect(row.lines[0].amount.toString()).toBe("500000");
    expect(row.lines[0].adjustmentAmount.toString()).toBe("-50000");
    expect(row.lines[0].finalAmount.toString()).toBe("450000");
    expect(row.lines[0].source).toBe("BASE");
    // totalDue is the resolver's total, not a re-sum done by the builder.
    expect(row.totalDue.toString()).toBe("450000");
  });

  it("rule 5: no adjustments means lines carry the base amount verbatim", () => {
    const out = build();
    const row = out.rows[0];
    expect(row.lines[0].adjustmentAmount.toString()).toBe("0");
    expect(row.lines[0].finalAmount.toString()).toBe(row.lines[0].amount.toString());
    expect(row.totalDue.toString()).toBe("500000");
  });

  it("rule 7: summary.withAdjustments counts only rows where the resolver reported adjustmentApplied", () => {
    const out = build({
      enrollments: [
        enrollment({ studentId: "student-1" }),
        enrollment({ studentId: "student-2" }),
      ],
      scope: { classSectionIds: ["class-a"], includeStudentIds: [], excludeStudentIds: [] },
      adjustmentsByStudent: new Map([
        ["student-1", [adjustment({ mode: "PERCENT", value: "10" })]],
        // student-2 has no matching adjustment (different fee component).
        ["student-2", [adjustment({ feeComponentId: "fc-other" })]],
      ]),
    });
    expect(out.rows).toHaveLength(2);
    expect(out.summary.pending).toBe(2);
    expect(out.summary.withAdjustments).toBe(1);
  });

  it("keringanan lands on the right line with the right note", () => {
    const out = build({
      feesByProgram: new Map([
        [
          "program-tkit",
          [
            feeLine({ feeComponentId: "fc-spp", label: "SPP Bulanan", amount: D("500000") }),
            feeLine({ feeComponentId: "fc-uang-pangkal", label: "Uang Pangkal", amount: D("1000000") }),
          ],
        ],
      ]),
      adjustmentsByStudent: new Map([
        [
          "student-1",
          [adjustment({ feeComponentId: "fc-spp", mode: "FIXED", value: "50000", reason: "Diskon guru" })],
        ],
      ]),
    });
    const row = out.rows[0];
    const spp = row.lines.find((l) => l.feeComponentId === "fc-spp")!;
    const pangkal = row.lines.find((l) => l.feeComponentId === "fc-uang-pangkal")!;
    expect(spp.adjustmentAmount.toString()).toBe("-50000");
    expect(spp.adjustmentNote).toBe("Diskon guru");
    expect(spp.finalAmount.toString()).toBe("450000");
    // The other line is untouched.
    expect(pangkal.adjustmentAmount.toString()).toBe("0");
    expect(pangkal.adjustmentNote).toBeNull();
    expect(pangkal.finalAmount.toString()).toBe("1000000");
    expect(row.totalDue.toString()).toBe("1450000");
  });

  it("parentByStudent and classLabelSnapshot are carried onto the row", () => {
    const out = build({
      parentByStudent: new Map([["student-1", "parent-1"]]),
    });
    expect(out.rows[0].parentId).toBe("parent-1");
    expect(out.rows[0].classLabelSnapshot).toBe("TKIT A");
  });

  it("a student with no parent guardian gets parentId null, not an error", () => {
    const out = build({ parentByStudent: new Map() });
    expect(out.rows[0].parentId).toBeNull();
  });

  describe("dual enrollment (T8 — enrollment-flexibility)", () => {
    it("a student with a KB + DCARE enrollment yields one row with both programs' fee components, totalDue equal to the resolver's total", () => {
      const out = build({
        enrollments: [
          enrollment({
            studentId: "student-1",
            classLabel: "KB Aster",
            programId: "program-kb",
            programName: "KB",
            classSectionId: "class-kb",
          }),
          enrollment({
            studentId: "student-1",
            classLabel: "D'Care Aster",
            programId: "program-dcare",
            programName: "D'Care",
            classSectionId: "class-dcare",
          }),
        ],
        scope: { classSectionIds: ["class-kb", "class-dcare"], includeStudentIds: [], excludeStudentIds: [] },
        feesByProgram: new Map([
          ["program-kb", [feeLine({ feeComponentId: "fc-spp-kb", label: "SPP Bulanan", amount: D("500000") })]],
          ["program-dcare", [feeLine({ feeComponentId: "fc-spp-dcare", label: "SPP Bulanan", amount: D("300000") })]],
        ]),
      });

      expect(out.rows).toHaveLength(1);
      expect(out.summary.total).toBe(1);
      const row = out.rows[0];
      expect(row.status).toBe("PENDING");
      expect(row.lines).toHaveLength(2);
      const kbLine = row.lines.find((l) => l.feeComponentId === "fc-spp-kb")!;
      const dcareLine = row.lines.find((l) => l.feeComponentId === "fc-spp-dcare")!;
      expect(kbLine).toBeDefined();
      expect(dcareLine).toBeDefined();
      // totalDue is verbatim from applyAdjustments, never re-summed.
      expect(row.totalDue.toString()).toBe("800000");
    });

    it("label disambiguation appears only when merged lines span more than one program", () => {
      const out = build({
        enrollments: [
          enrollment({
            studentId: "student-1",
            classLabel: "KB Aster",
            programId: "program-kb",
            programName: "KB",
            classSectionId: "class-kb",
          }),
          enrollment({
            studentId: "student-1",
            classLabel: "D'Care Aster",
            programId: "program-dcare",
            programName: "D'Care",
            classSectionId: "class-dcare",
          }),
        ],
        scope: { classSectionIds: ["class-kb", "class-dcare"], includeStudentIds: [], excludeStudentIds: [] },
        feesByProgram: new Map([
          ["program-kb", [feeLine({ feeComponentId: "fc-spp-kb", label: "SPP", amount: D("500000") })]],
          ["program-dcare", [feeLine({ feeComponentId: "fc-spp-dcare", label: "SPP", amount: D("300000") })]],
        ]),
      });

      const row = out.rows[0];
      const kbLine = row.lines.find((l) => l.feeComponentId === "fc-spp-kb")!;
      const dcareLine = row.lines.find((l) => l.feeComponentId === "fc-spp-dcare")!;
      expect(kbLine.labelSnapshot).toBe("SPP (KB)");
      expect(dcareLine.labelSnapshot).toBe("SPP (D'Care)");
    });

    it("classLabelSnapshot joins both class names, sorted, when a student has two in-scope enrollments", () => {
      const out = build({
        enrollments: [
          enrollment({
            studentId: "student-1",
            classLabel: "KB Aster",
            programId: "program-kb",
            programName: "KB",
            classSectionId: "class-kb",
          }),
          enrollment({
            studentId: "student-1",
            classLabel: "D'Care Aster",
            programId: "program-dcare",
            programName: "D'Care",
            classSectionId: "class-dcare",
          }),
        ],
        scope: { classSectionIds: ["class-kb", "class-dcare"], includeStudentIds: [], excludeStudentIds: [] },
        feesByProgram: new Map([
          ["program-kb", [feeLine({ feeComponentId: "fc-spp-kb", amount: D("500000") })]],
          ["program-dcare", [feeLine({ feeComponentId: "fc-spp-dcare", amount: D("300000") })]],
        ]),
      });

      expect(out.rows[0].classLabelSnapshot).toBe("D'Care Aster, KB Aster");
    });

    it("a single-enrollment student's row and labels are byte-identical to today (no disambiguation, single class label)", () => {
      const out = build();
      const row = out.rows[0];
      expect(row.lines[0].labelSnapshot).toBe("SPP Bulanan");
      expect(row.classLabelSnapshot).toBe("TKIT A");
    });

    it("a program with fees plus a program without fees is PENDING with only the fees that exist, undisambiguated", () => {
      const out = build({
        enrollments: [
          enrollment({
            studentId: "student-1",
            classLabel: "KB Aster",
            programId: "program-kb",
            programName: "KB",
            classSectionId: "class-kb",
          }),
          enrollment({
            studentId: "student-1",
            classLabel: "D'Care Aster",
            programId: "program-dcare",
            programName: "D'Care",
            classSectionId: "class-dcare",
          }),
        ],
        scope: { classSectionIds: ["class-kb", "class-dcare"], includeStudentIds: [], excludeStudentIds: [] },
        feesByProgram: new Map([
          ["program-kb", [feeLine({ feeComponentId: "fc-spp-kb", label: "SPP", amount: D("500000") })]],
          // program-dcare has no fee structure rows at all.
        ]),
      });

      expect(out.rows).toHaveLength(1);
      const row = out.rows[0];
      expect(row.status).toBe("PENDING");
      expect(row.lines).toHaveLength(1);
      // Only one program contributed lines, so no disambiguation.
      expect(row.lines[0].labelSnapshot).toBe("SPP");
      expect(out.summary.skippedNoFeeStructure).toBe(0);
      expect(out.summary.pending).toBe(1);
    });

    it("SKIPPED_NO_FEE_STRUCTURE only when NO in-scope program has fees, across all of a student's enrollments", () => {
      const out = build({
        enrollments: [
          enrollment({
            studentId: "student-1",
            programId: "program-kb",
            programName: "KB",
            classSectionId: "class-kb",
          }),
          enrollment({
            studentId: "student-1",
            programId: "program-dcare",
            programName: "D'Care",
            classSectionId: "class-dcare",
          }),
        ],
        scope: { classSectionIds: ["class-kb", "class-dcare"], includeStudentIds: [], excludeStudentIds: [] },
        feesByProgram: new Map(), // neither program has fees
      });

      expect(out.rows).toHaveLength(1);
      expect(out.rows[0].status).toBe("SKIPPED_NO_FEE_STRUCTURE");
      expect(out.summary.skippedNoFeeStructure).toBe(1);
      expect(out.summary.pending).toBe(0);
    });

    it("a keringanan adjustment applies once across the merged fee set, matching only the program's own fee component", () => {
      const out = build({
        enrollments: [
          enrollment({
            studentId: "student-1",
            programId: "program-kb",
            programName: "KB",
            classSectionId: "class-kb",
          }),
          enrollment({
            studentId: "student-1",
            programId: "program-dcare",
            programName: "D'Care",
            classSectionId: "class-dcare",
          }),
        ],
        scope: { classSectionIds: ["class-kb", "class-dcare"], includeStudentIds: [], excludeStudentIds: [] },
        feesByProgram: new Map([
          ["program-kb", [feeLine({ feeComponentId: "fc-spp-kb", label: "SPP", amount: D("500000") })]],
          ["program-dcare", [feeLine({ feeComponentId: "fc-spp-dcare", label: "SPP", amount: D("300000") })]],
        ]),
        adjustmentsByStudent: new Map([
          ["student-1", [adjustment({ feeComponentId: "fc-spp-kb", mode: "PERCENT", value: "10" })]],
        ]),
      });

      const row = out.rows[0];
      const kbLine = row.lines.find((l) => l.feeComponentId === "fc-spp-kb")!;
      const dcareLine = row.lines.find((l) => l.feeComponentId === "fc-spp-dcare")!;
      expect(kbLine.adjustmentAmount.toString()).toBe("-50000");
      expect(dcareLine.adjustmentAmount.toString()).toBe("0"); // untouched — different feeComponentId
      // 450000 + 300000
      expect(row.totalDue.toString()).toBe("750000");
      expect(out.summary.withAdjustments).toBe(1);
    });

    // The tests above deliberately give each program its OWN feeComponentId,
    // which is what let the double-discount bug hide. `FeeComponentDef` is a
    // TENANT-LEVEL shared catalog (prisma/seed.ts attaches one "spp" to TKIT,
    // KB, DCARE and POPUP alike), so the realistic dual-enrolment shape is two
    // base lines carrying the SAME feeComponentId with DIFFERENT amounts.
    it("a FIXED keringanan on a feeComponentId SHARED by both programs fires exactly once, not once per program", () => {
      const out = build({
        enrollments: [
          enrollment({ studentId: "student-1", programId: "program-kb", programName: "KB", classSectionId: "class-kb" }),
          enrollment({ studentId: "student-1", programId: "program-dcare", programName: "D'Care", classSectionId: "class-dcare" }),
        ],
        scope: { classSectionIds: ["class-kb", "class-dcare"], includeStudentIds: [], excludeStudentIds: [] },
        // Same fc-spp on both programs — the shared-catalog case.
        feesByProgram: new Map([
          ["program-kb", [feeLine({ feeComponentId: "fc-spp", label: "SPP", amount: D("500000") })]],
          ["program-dcare", [feeLine({ feeComponentId: "fc-spp", label: "SPP", amount: D("300000") })]],
        ]),
        adjustmentsByStudent: new Map([
          ["student-1", [adjustment({ feeComponentId: "fc-spp", mode: "FIXED", value: "50000" })]],
        ]),
      });

      const row = out.rows[0];
      const sppLines = row.lines.filter((l) => l.feeComponentId === "fc-spp");
      // Collapsed to ONE line so a single grant cannot match twice.
      expect(sppLines).toHaveLength(1);
      expect(sppLines[0].amount.toString()).toBe("800000"); // 500000 + 300000
      // The bug would have produced -100000 here (50000 taken off each line).
      expect(sppLines[0].adjustmentAmount.toString()).toBe("-50000");
      expect(row.totalDue.toString()).toBe("750000");
      expect(out.summary.withAdjustments).toBe(1);
    });

    it("a PERCENT keringanan on a SHARED feeComponentId uses the summed cross-program amount as its base", () => {
      const out = build({
        enrollments: [
          enrollment({ studentId: "student-1", programId: "program-kb", programName: "KB", classSectionId: "class-kb" }),
          enrollment({ studentId: "student-1", programId: "program-dcare", programName: "D'Care", classSectionId: "class-dcare" }),
        ],
        scope: { classSectionIds: ["class-kb", "class-dcare"], includeStudentIds: [], excludeStudentIds: [] },
        feesByProgram: new Map([
          ["program-kb", [feeLine({ feeComponentId: "fc-spp", label: "SPP", amount: D("500000") })]],
          ["program-dcare", [feeLine({ feeComponentId: "fc-spp", label: "SPP", amount: D("300000") })]],
        ]),
        adjustmentsByStudent: new Map([
          ["student-1", [adjustment({ feeComponentId: "fc-spp", mode: "PERCENT", value: "10" })]],
        ]),
      });

      const row = out.rows[0];
      const spp = row.lines.find((l) => l.feeComponentId === "fc-spp")!;
      // 10% of the merged 800000 base — not 10% of 500000 plus 10% of 300000
      // charged twice, and not 10% of whichever program happened to sort first.
      expect(spp.adjustmentAmount.toString()).toBe("-80000");
      expect(row.totalDue.toString()).toBe("720000");
    });

    it("excludeSet still wins over class-scope even when the student has multiple in-scope enrollments", () => {
      const out = build({
        enrollments: [
          enrollment({
            studentId: "student-1",
            programId: "program-kb",
            programName: "KB",
            classSectionId: "class-kb",
          }),
          enrollment({
            studentId: "student-1",
            programId: "program-dcare",
            programName: "D'Care",
            classSectionId: "class-dcare",
          }),
        ],
        scope: {
          classSectionIds: ["class-kb", "class-dcare"],
          includeStudentIds: [],
          excludeStudentIds: ["student-1"],
        },
        feesByProgram: new Map([
          ["program-kb", [feeLine({ feeComponentId: "fc-spp-kb", amount: D("500000") })]],
          ["program-dcare", [feeLine({ feeComponentId: "fc-spp-dcare", amount: D("300000") })]],
        ]),
      });

      expect(out.rows).toHaveLength(0);
      expect(out.summary.total).toBe(0);
    });
  });

  it("summary.total counts every row regardless of status", () => {
    const out = build({
      enrollments: [
        enrollment({ studentId: "student-1" }),
        enrollment({ studentId: "student-2" }),
        enrollment({ studentId: "student-3" }),
      ],
      scope: { classSectionIds: ["class-a"], includeStudentIds: [], excludeStudentIds: [] },
      alreadyInvoicedStudentIds: new Set(["student-2"]),
      feesByProgram: new Map(), // forces student-3 (and student-1) to SKIPPED_NO_FEE_STRUCTURE
    });
    expect(out.summary.total).toBe(3);
    expect(out.summary.skippedAlreadyInvoiced).toBe(1);
    expect(out.summary.skippedNoFeeStructure).toBe(2);
    expect(out.summary.pending).toBe(0);
  });
});

describe("buildBillingRunRows — enrollment leave (cuti)", () => {
  const SCOPE = { classSectionIds: ["class-a", "class-d"], includeStudentIds: [], excludeStudentIds: [] };
  const school = (overrides: Partial<BuildEnrollment> = {}) =>
    enrollment({ enrollmentId: "enr-school", classSectionId: "class-a", ...overrides });
  const daycare = (overrides: Partial<BuildEnrollment> = {}) =>
    enrollment({
      enrollmentId: "enr-daycare",
      classSectionId: "class-d",
      classLabel: "Daycare Pagi",
      programId: "program-dcare",
      programName: "Daycare",
      ...overrides,
    });
  const fees = new Map([
    ["program-tkit", [feeLine({ feeComponentId: "fc-spp-tkit", amount: D("500000") })]],
    ["program-dcare", [feeLine({ feeComponentId: "fc-spp-dcare", amount: D("300000") })]],
  ]);

  it("skips a student whose only enrollment is on leave: no lines, zero total, counted in the summary", () => {
    const out = build({
      enrollments: [school()],
      scope: SCOPE,
      feesByProgram: fees,
      onLeaveEnrollmentIds: new Set(["enr-school"]),
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      studentId: "student-1",
      status: "SKIPPED_ON_LEAVE",
      lines: [],
      classLabelSnapshot: "TKIT A",
    });
    expect(out.rows[0].totalDue.toString()).toBe("0");
    expect(out.summary).toMatchObject({
      total: 1,
      pending: 0,
      skippedOnLeave: 1,
      skippedAlreadyInvoiced: 0,
      skippedNoFeeStructure: 0,
    });
  });

  it("full leave beats already-invoiced", () => {
    const out = build({
      enrollments: [school()],
      scope: SCOPE,
      feesByProgram: fees,
      alreadyInvoicedStudentIds: new Set(["student-1"]),
      onLeaveEnrollmentIds: new Set(["enr-school"]),
    });
    expect(out.rows[0].status).toBe("SKIPPED_ON_LEAVE");
    expect(out.summary.skippedOnLeave).toBe(1);
    expect(out.summary.skippedAlreadyInvoiced).toBe(0);
  });

  it("a partly-on-leave student is billed for the remaining enrollment only", () => {
    const out = build({
      enrollments: [school(), daycare()],
      scope: SCOPE,
      feesByProgram: fees,
      onLeaveEnrollmentIds: new Set(["enr-daycare"]),
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].status).toBe("PENDING");
    expect(out.rows[0].lines.map((l) => l.feeComponentId)).toEqual(["fc-spp-tkit"]);
    // Single remaining program: labels are not disambiguated.
    expect(out.rows[0].lines[0].labelSnapshot).toBe("SPP Bulanan");
    expect(out.rows[0].totalDue.toString()).toBe("500000");
    expect(out.summary).toMatchObject({ pending: 1, skippedOnLeave: 0 });
  });

  it("classLabelSnapshot lists only the billed (non-leave) classes", () => {
    const out = build({
      enrollments: [school(), daycare()],
      scope: SCOPE,
      feesByProgram: fees,
      onLeaveEnrollmentIds: new Set(["enr-daycare"]),
    });
    expect(out.rows[0].classLabelSnapshot).toBe("TKIT A");
  });

  it("two enrollments in the SAME program, one on leave, bill that program once", () => {
    const out = build({
      enrollments: [
        school({ enrollmentId: "enr-a1", classSectionId: "class-a", classLabel: "TKIT A" }),
        school({ enrollmentId: "enr-a2", classSectionId: "class-a", classLabel: "TKIT B" }),
      ],
      scope: SCOPE,
      feesByProgram: fees,
      onLeaveEnrollmentIds: new Set(["enr-a2"]),
    });
    expect(out.rows[0].status).toBe("PENDING");
    expect(out.rows[0].lines).toHaveLength(1);
    expect(out.rows[0].totalDue.toString()).toBe("500000");
    expect(out.rows[0].classLabelSnapshot).toBe("TKIT A");
  });

  it("a remaining enrollment with no fee structure is SKIPPED_NO_FEE_STRUCTURE, not on leave", () => {
    const out = build({
      enrollments: [school(), daycare()],
      scope: SCOPE,
      feesByProgram: new Map([["program-dcare", [feeLine({ feeComponentId: "fc-spp-dcare" })]]]),
      onLeaveEnrollmentIds: new Set(["enr-daycare"]),
    });
    expect(out.rows[0]).toMatchObject({ status: "SKIPPED_NO_FEE_STRUCTURE", classLabelSnapshot: "TKIT A" });
    expect(out.summary).toMatchObject({ skippedNoFeeStructure: 1, skippedOnLeave: 0 });
  });

  it("a remaining already-invoiced student stays SKIPPED_ALREADY_INVOICED", () => {
    const out = build({
      enrollments: [school(), daycare()],
      scope: SCOPE,
      feesByProgram: fees,
      alreadyInvoicedStudentIds: new Set(["student-1"]),
      onLeaveEnrollmentIds: new Set(["enr-daycare"]),
    });
    expect(out.rows[0].status).toBe("SKIPPED_ALREADY_INVOICED");
    expect(out.summary.skippedOnLeave).toBe(0);
  });

  it("only the student on leave is skipped; other students bill normally", () => {
    const out = build({
      enrollments: [
        school({ enrollmentId: "enr-1", studentId: "student-1" }),
        school({ enrollmentId: "enr-2", studentId: "student-2" }),
      ],
      scope: SCOPE,
      feesByProgram: fees,
      onLeaveEnrollmentIds: new Set(["enr-2"]),
    });
    const byStudent = Object.fromEntries(out.rows.map((r) => [r.studentId, r.status]));
    expect(byStudent).toEqual({ "student-1": "PENDING", "student-2": "SKIPPED_ON_LEAVE" });
    expect(out.summary).toMatchObject({ total: 2, pending: 1, skippedOnLeave: 1 });
  });

  it("an empty or absent leave set changes nothing (byte-identical output)", () => {
    const input = {
      enrollments: [school(), daycare()],
      scope: SCOPE,
      feesByProgram: fees,
    };
    const baseline = build(input);
    expect(build({ ...input, onLeaveEnrollmentIds: new Set() })).toEqual(baseline);
    expect(build({ ...input, onLeaveEnrollmentIds: new Set(["enr-unrelated"]) })).toEqual(baseline);
    expect(baseline.summary.skippedOnLeave).toBe(0);
  });
});

describe("buildBillingRunRows — per-student run scope", () => {
  const school = (overrides: Partial<BuildEnrollment> = {}) =>
    enrollment({ enrollmentId: "enr-school", classSectionId: "class-a", ...overrides });
  const daycare = (overrides: Partial<BuildEnrollment> = {}) =>
    enrollment({
      enrollmentId: "enr-daycare",
      classSectionId: "class-d",
      classLabel: "Daycare Pagi",
      programId: "program-dcare",
      programName: "Daycare",
      ...overrides,
    });
  const fees = new Map([
    ["program-tkit", [feeLine({ feeComponentId: "fc-spp-tkit", amount: D("500000") })]],
    ["program-dcare", [feeLine({ feeComponentId: "fc-spp-dcare", amount: D("300000") })]],
  ]);
  const scope = (overrides: Partial<BuildInput["scope"]> = {}): BuildInput["scope"] => ({
    classSectionIds: ["class-a"],
    includeStudentIds: [],
    excludeStudentIds: [],
    ...overrides,
  });

  it("a student with one ticked and one non-ticked placement is priced for both, once", () => {
    const out = build({ enrollments: [school(), daycare()], scope: scope(), feesByProgram: fees });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].status).toBe("PENDING");
    expect(out.rows[0].lines.map((l) => l.feeComponentId).sort()).toEqual(["fc-spp-dcare", "fc-spp-tkit"]);
    expect(out.rows[0].totalDue.toString()).toBe("800000");
    expect(out.rows[0].classLabelSnapshot).toBe("Daycare Pagi, TKIT A");
  });

  it("the same holds when only the daycare class is ticked", () => {
    const out = build({
      enrollments: [school(), daycare()],
      scope: scope({ classSectionIds: ["class-d"] }),
      feesByProgram: fees,
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].totalDue.toString()).toBe("800000");
  });

  it("a student with no ticked placement and no include is absent, however many placements they hold", () => {
    const out = build({
      enrollments: [school({ classSectionId: "class-x" }), daycare({ classSectionId: "class-y" })],
      scope: scope(),
      feesByProgram: fees,
    });
    expect(out.rows).toEqual([]);
    expect(out.summary.total).toBe(0);
  });

  it("exclude wins even when one placement is ticked and the student is also included", () => {
    const out = build({
      enrollments: [school(), daycare()],
      scope: scope({ includeStudentIds: ["student-1"], excludeStudentIds: ["student-1"] }),
      feesByProgram: fees,
    });
    expect(out.rows).toEqual([]);
  });

  it("include admits a student whose placements are all non-ticked, priced for all of them", () => {
    const out = build({
      enrollments: [school({ classSectionId: "class-x" }), daycare({ classSectionId: "class-y" })],
      scope: scope({ includeStudentIds: ["student-1"] }),
      feesByProgram: fees,
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].totalDue.toString()).toBe("800000");
  });

  it("admitting one student does not drag in another student's placements", () => {
    const out = build({
      enrollments: [
        school(),
        daycare(),
        school({ enrollmentId: "enr-other", studentId: "student-2", classSectionId: "class-x" }),
      ],
      scope: scope(),
      feesByProgram: fees,
    });
    expect(out.rows.map((r) => r.studentId)).toEqual(["student-1"]);
  });
});

describe("buildBillingRunRows — harga paket sekolah + daycare", () => {
  const TK_A = "program-tka";
  const TK_B = "program-tkb";
  const DC = "program-dcare";
  const POPUP = "program-popup";

  const tkA = (o: Partial<BuildEnrollment> = {}) =>
    enrollment({ enrollmentId: "enr-tka", classSectionId: "class-tka", classLabel: "TK A 1", programId: TK_A, programName: "TKIT-A", ...o });
  const tkB = (o: Partial<BuildEnrollment> = {}) =>
    enrollment({ enrollmentId: "enr-tkb", classSectionId: "class-tkb", classLabel: "TK B 1", programId: TK_B, programName: "TKIT-B", ...o });
  const dcare = (o: Partial<BuildEnrollment> = {}) =>
    enrollment({ enrollmentId: "enr-dc", classSectionId: "class-dc", classLabel: "Daycare", programId: DC, programName: "D'Care", ...o });
  const popup = (o: Partial<BuildEnrollment> = {}) =>
    enrollment({ enrollmentId: "enr-pop", classSectionId: "class-pop", classLabel: "Pop-up", programId: POPUP, programName: "Pop-up", ...o });

  const spp = (amount: number, feeComponentId = "fc-spp"): FeeStructureLine => feeLine({ feeComponentId, amount: D(amount) });
  const fees = new Map<string, FeeStructureLine[]>([
    [TK_A, [spp(499_000)]],
    [TK_B, [spp(504_000)]],
    [DC, [spp(1_100_000)]],
    [POPUP, [spp(100_000)]],
  ]);
  const bundle = (school: string, amount: number, over: Partial<NonNullable<BuildInput["bundleFees"]>[number]> = {}) => ({
    schoolProgramId: school,
    daycareProgramId: DC,
    feeComponentId: "fc-spp",
    amount: D(amount),
    ...over,
  });
  const scope = (ids: string[]) => ({ classSectionIds: ids, includeStudentIds: [], excludeStudentIds: [] });
  const ALL_CLASSES = ["class-tka", "class-tkb", "class-dc", "class-pop"];
  const run = (enrollments: BuildEnrollment[], bundleFees?: BuildInput["bundleFees"], extra: Partial<BuildInput> = {}) =>
    build({ enrollments, scope: scope(ALL_CLASSES), feesByProgram: fees, bundleFees, ...extra });

  it("replaces the summed component with the bundle for the pair; label unchanged", () => {
    const out = run([tkA(), dcare()], [bundle(TK_A, 1_560_000)]);
    expect(out.rows).toHaveLength(1);
    const row = out.rows[0];
    expect(row.lines).toHaveLength(1);
    expect(row.lines[0].labelSnapshot).toBe("SPP Bulanan (D'Care + TKIT-A)");
    expect(row.lines[0].amount.toString()).toBe("1560000");
    expect(row.lines[0].finalAmount.toString()).toBe("1560000");
    expect(row.totalDue.toString()).toBe("1560000");
  });

  it("without a bundle the same child is billed the sum (label identical)", () => {
    const withBundle = run([tkA(), dcare()], [bundle(TK_A, 1_560_000)]);
    const without = run([tkA(), dcare()]);
    expect(without.rows[0].totalDue.toString()).toBe("1599000"); // 499000 + 1100000
    const other = run([tkA(), dcare()], [bundle(TK_A, 1_400_000)]);
    expect(other.rows[0].totalDue.toString()).toBe("1400000");
    expect(withBundle.rows[0].lines[0].labelSnapshot).toBe(without.rows[0].lines[0].labelSnapshot);
  });

  it("TK B uses its own bundle, never TK A's", () => {
    const bundles = [bundle(TK_A, 1_560_000), bundle(TK_B, 1_500_000)];
    const out = run([tkB(), dcare()], bundles);
    expect(out.rows[0].totalDue.toString()).toBe("1500000");
    expect(out.rows[0].lines[0].labelSnapshot).toBe("SPP Bulanan (D'Care + TKIT-B)");
  });

  it("a third program carrying the component is added on top of the bundle", () => {
    const out = run([tkA(), dcare(), popup()], [bundle(TK_A, 1_560_000)]);
    expect(out.rows[0].lines).toHaveLength(1);
    expect(out.rows[0].lines[0].amount.toString()).toBe("1660000"); // 1.560.000 + pop-up 100.000
    expect(out.rows[0].lines[0].labelSnapshot).toBe("SPP Bulanan (D'Care + Pop-up + TKIT-A)");
  });

  it("a component priced by only one program is untouched", () => {
    const f = new Map<string, FeeStructureLine[]>([
      [TK_A, [spp(499_000), feeLine({ feeComponentId: "fc-meal", label: "Makan", amount: D("200000") })]],
      [DC, [spp(1_100_000)]],
    ]);
    const out = run([tkA(), dcare()], [bundle(TK_A, 1_400_000)], { feesByProgram: f });
    const byComp = Object.fromEntries(out.rows[0].lines.map((l) => [l.feeComponentId, l.amount.toString()]));
    expect(byComp).toEqual({ "fc-spp": "1400000", "fc-meal": "200000" });
    expect(out.rows[0].totalDue.toString()).toBe("1600000");
  });

  it("a bundle never creates or replaces a line only one program prices", () => {
    // Daycare has no SPP: the TK A SPP line stays its own amount, label undisambiguated by the merge.
    const f = new Map<string, FeeStructureLine[]>([
      [TK_A, [spp(499_000)]],
      [DC, [feeLine({ feeComponentId: "fc-care", label: "Daycare", amount: D("300000") })]],
    ]);
    const out = run([tkA(), dcare()], [bundle(TK_A, 1_560_000)], { feesByProgram: f });
    const byComp = Object.fromEntries(out.rows[0].lines.map((l) => [l.feeComponentId, l.amount.toString()]));
    expect(byComp).toEqual({ "fc-spp": "499000", "fc-care": "300000" });
    expect(out.rows[0].totalDue.toString()).toBe("799000");
  });

  it("two matching bundles are ambiguous: keep the sum", () => {
    const out = run([tkA(), dcare()], [bundle(TK_A, 1_000_000), bundle(TK_A, 1_200_000)]);
    expect(out.rows[0].totalDue.toString()).toBe("1599000");
    expect(out.rows[0].lines[0].amount.toString()).toBe("1599000");
  });

  it("PERCENT keringanan on a bundle is computed from the bundle amount", () => {
    const out = run([tkA(), dcare()], [bundle(TK_A, 1_560_000)], {
      adjustmentsByStudent: new Map([["student-1", [adjustment({ value: "10" })]]]),
    });
    const line = out.rows[0].lines[0];
    expect(line.amount.toString()).toBe("1560000");
    expect(line.adjustmentAmount.toString()).toBe("-156000");
    expect(line.finalAmount.toString()).toBe("1404000");
    expect(out.rows[0].totalDue.toString()).toBe("1404000");
    expect(out.summary.withAdjustments).toBe(1);
  });

  it("stacked PERCENT and FIXED keringanan both follow the bundle", () => {
    const out = run([tkA(), dcare()], [bundle(TK_A, 1_560_000)], {
      adjustmentsByStudent: new Map([
        [
          "student-1",
          [
            adjustment({ id: "adj-pct", value: "10" }),
            adjustment({ id: "adj-fix", mode: "FIXED", value: "60000", reason: "Beasiswa" }),
          ],
        ],
      ]),
    });
    const line = out.rows[0].lines[0];
    expect(line.amount.toString()).toBe("1560000");
    // 10% of 1.560.000 = 156.000, plus a flat 60.000: 1.560.000 - 216.000.
    expect(line.finalAmount.toString()).toBe("1344000");
    expect(out.rows[0].totalDue.toString()).toBe("1344000");
  });

  it("a bundle for a component the pair does not both price is ignored", () => {
    const out = run([tkA(), dcare()], [bundle(TK_A, 100_000, { feeComponentId: "fc-meal" })]);
    expect(out.rows[0].totalDue.toString()).toBe("1599000");
    expect(out.rows[0].lines).toHaveLength(1);
  });

  it("a bundle for a pair the student does not hold is ignored", () => {
    // Student holds TK A + daycare; the bundle belongs to TK B + daycare.
    const out = run([tkA(), dcare()], [bundle(TK_B, 1_500_000)]);
    expect(out.rows[0].totalDue.toString()).toBe("1599000");
    // Student holds only the school program: a bundle never prices a single placement.
    const single = run([tkA()], [bundle(TK_A, 1_560_000)]);
    expect(single.rows[0].totalDue.toString()).toBe("499000");
    expect(single.rows[0].lines[0].labelSnapshot).toBe("SPP Bulanan");
    const dcOnly = run([dcare()], [bundle(TK_A, 1_560_000)]);
    expect(dcOnly.rows[0].totalDue.toString()).toBe("1100000");
  });

  it("absent or empty bundleFees gives byte-identical output to today", () => {
    const baseline = run([tkA(), dcare(), popup()]);
    expect(run([tkA(), dcare(), popup()], [])).toEqual(baseline);
    expect(run([tkA(), dcare(), popup()], undefined)).toEqual(baseline);
  });

  it("the daycare placement on leave bills the school price only (no bundle)", () => {
    const out = run([tkA(), dcare()], [bundle(TK_A, 1_560_000)], { onLeaveEnrollmentIds: new Set(["enr-dc"]) });
    expect(out.rows[0].status).toBe("PENDING");
    expect(out.rows[0].lines).toHaveLength(1);
    expect(out.rows[0].totalDue.toString()).toBe("499000");
    expect(out.rows[0].lines[0].labelSnapshot).toBe("SPP Bulanan");
  });

  it("the bundle applies when only one of the two classes is ticked", () => {
    const out = build({
      enrollments: [tkA(), dcare()],
      scope: scope(["class-tka"]),
      feesByProgram: fees,
      bundleFees: [bundle(TK_A, 1_500_000)],
    });
    expect(out.rows[0].totalDue.toString()).toBe("1500000");
  });
});
