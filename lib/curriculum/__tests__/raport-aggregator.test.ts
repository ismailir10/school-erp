import { describe, it, expect, vi, beforeEach } from "vitest";

const { assessmentEntryFindMany, studentAttendanceFindMany } = vi.hoisted(() => ({
  assessmentEntryFindMany: vi.fn(),
  studentAttendanceFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    assessmentEntry: { findMany: assessmentEntryFindMany },
    studentAttendance: { findMany: studentAttendanceFindMany },
  },
}));

import {
  dominantLevel,
  suggestSectionLevels,
  summarizeAttendance,
  loadRaportDraft,
  BUCKETED_SECTIONS,
  type RaportLevel,
} from "@/lib/curriculum/raport-aggregator";

const C: RaportLevel = "CONSISTENT";
const E: RaportLevel = "EMERGING";
const N: RaportLevel = "NEEDS_REINFORCEMENT";

describe("dominantLevel", () => {
  it("empty counts → null", () => {
    expect(
      dominantLevel({ CONSISTENT: 0, EMERGING: 0, NEEDS_REINFORCEMENT: 0, total: 0 }),
    ).toBeNull();
  });

  it("clear winner", () => {
    expect(
      dominantLevel({ CONSISTENT: 3, EMERGING: 1, NEEDS_REINFORCEMENT: 0, total: 4 }),
    ).toBe("CONSISTENT");
  });

  it("tie breaks toward lower achievement (NEEDS over EMERGING)", () => {
    expect(
      dominantLevel({ CONSISTENT: 0, EMERGING: 2, NEEDS_REINFORCEMENT: 2, total: 4 }),
    ).toBe("NEEDS_REINFORCEMENT");
  });

  it("tie breaks toward lower achievement (EMERGING over CONSISTENT)", () => {
    expect(
      dominantLevel({ CONSISTENT: 2, EMERGING: 2, NEEDS_REINFORCEMENT: 0, total: 4 }),
    ).toBe("EMERGING");
  });
});

describe("suggestSectionLevels", () => {
  it("empty rows → every bucketed section null with zero counts", () => {
    const out = suggestSectionLevels([]);
    for (const s of BUCKETED_SECTIONS) {
      expect(out[s].suggested).toBeNull();
      expect(out[s].counts.total).toBe(0);
    }
  });

  it("maps each element 1:1 to its section + INTRODUCTION never suggested", () => {
    const out = suggestSectionLevels([
      { element: "RELIGIOUS_MORAL", level: C },
      { element: "RELIGIOUS_MORAL", level: C },
      { element: "IDENTITY", level: E },
      { element: "STEAM", level: N },
    ]);
    expect(out.RELIGIOUS_MORAL.suggested).toBe("CONSISTENT");
    expect(out.RELIGIOUS_MORAL.counts.total).toBe(2);
    expect(out.IDENTITY.suggested).toBe("EMERGING");
    expect(out.STEAM.suggested).toBe("NEEDS_REINFORCEMENT");
    expect(out.INTRODUCTION.suggested).toBeNull();
    expect(out.INTRODUCTION.counts.total).toBe(0);
  });

  it("PERFORMANCE_SHOWCASE pools MOTOR_SKILLS + ART", () => {
    const out = suggestSectionLevels([
      { element: "MOTOR_SKILLS", level: C },
      { element: "MOTOR_SKILLS", level: C },
      { element: "ART", level: E },
    ]);
    expect(out.PERFORMANCE_SHOWCASE.counts.total).toBe(3);
    expect(out.PERFORMANCE_SHOWCASE.counts.CONSISTENT).toBe(2);
    expect(out.PERFORMANCE_SHOWCASE.counts.EMERGING).toBe(1);
    expect(out.PERFORMANCE_SHOWCASE.suggested).toBe("CONSISTENT");
    // MOTOR/ART do not leak into other sections
    expect(out.STEAM.counts.total).toBe(0);
  });

  it("unknown elements are dropped (design-locked element list)", () => {
    const out = suggestSectionLevels([{ element: "MYSTERY", level: C }]);
    for (const s of BUCKETED_SECTIONS) expect(out[s].counts.total).toBe(0);
  });
});

describe("summarizeAttendance", () => {
  it("maps statuses to counts, ignores PRESENT + unknown", () => {
    const att = summarizeAttendance(
      ["SICK", "SICK", "PERMISSION", "ABSENT", "PRESENT", "WHATEVER"],
      20,
    );
    expect(att).toEqual({
      sickDays: 2,
      permittedAbsenceDays: 1,
      unexcusedAbsenceDays: 1,
      totalSchoolDays: 20,
    });
  });

  it("empty statuses → all zero, denominator passthrough", () => {
    expect(summarizeAttendance([], 17)).toEqual({
      sickDays: 0,
      permittedAbsenceDays: 0,
      unexcusedAbsenceDays: 0,
      totalSchoolDays: 17,
    });
  });
});

describe("loadRaportDraft", () => {
  beforeEach(() => vi.clearAllMocks());

  const term = {
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    endDate: new Date("2026-03-31T00:00:00.000Z"),
  };

  it("aggregates penilaian + attendance into a draft, tenant+void scoped", async () => {
    assessmentEntryFindMany.mockResolvedValue([
      { level: "CONSISTENT", indicator: { objective: { element: "RELIGIOUS_MORAL" } } },
      { level: "EMERGING", indicator: { objective: { element: "MOTOR_SKILLS" } } },
      { level: "CONSISTENT", indicator: { objective: { element: "ART" } } },
    ]);
    studentAttendanceFindMany
      .mockResolvedValueOnce([{ studentId: "s1", date: "2026-01-01", sessionId: null, status: "SICK" }, { studentId: "s1", date: "2026-01-02", sessionId: null, status: "ABSENT" }, { studentId: "s1", date: "2026-01-03", sessionId: null, status: "PRESENT" }]) // student rows
      .mockResolvedValueOnce([{ date: "2026-01-05" }, { date: "2026-01-06" }]); // distinct school days

    const draft = await loadRaportDraft("t1", "s1", term);

    expect(draft.sections.RELIGIOUS_MORAL.suggested).toBe("CONSISTENT");
    expect(draft.sections.PERFORMANCE_SHOWCASE.counts.total).toBe(2); // MOTOR + ART pooled
    expect(draft.attendance).toEqual({
      sickDays: 1,
      permittedAbsenceDays: 0,
      unexcusedAbsenceDays: 1,
      totalSchoolDays: 2,
    });

    // void-filtered + tenant + window scoping on the penilaian query
    const entryWhere = assessmentEntryFindMany.mock.calls[0][0].where;
    expect(entryWhere.tenantId).toBe("t1");
    expect(entryWhere.studentId).toBe("s1");
    expect(entryWhere.voidedAt).toBeNull();
    expect(entryWhere.date.gte).toEqual(term.startDate);
    expect(entryWhere.date.lte).toEqual(term.endDate);

    // attendance queries use string-YMD window + non-voided + tenant via student
    const studentWhere = studentAttendanceFindMany.mock.calls[0][0].where;
    expect(studentWhere.studentId).toBe("s1");
    expect(studentWhere.isVoided).toBe(false);
    expect(studentWhere.date).toEqual({ gte: "2026-01-01", lte: "2026-03-31" });
    expect(studentWhere.student).toEqual({ tenantId: "t1" });

    // school-day denominator query is tenant-wide (no studentId), distinct date
    const schoolDayCall = studentAttendanceFindMany.mock.calls[1][0];
    expect(schoolDayCall.where.studentId).toBeUndefined();
    expect(schoolDayCall.where.student).toEqual({ tenantId: "t1" });
    expect(schoolDayCall.distinct).toEqual(["date"]);
  });

  it("no penilaian → all sections null", async () => {
    assessmentEntryFindMany.mockResolvedValue([]);
    studentAttendanceFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const draft = await loadRaportDraft("t1", "s1", term);
    for (const s of BUCKETED_SECTIONS) expect(draft.sections[s].suggested).toBeNull();
    expect(draft.attendance.totalSchoolDays).toBe(0);
  });
});
