import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  semesterFindFirst,
  assessmentEntryFindMany,
  weekFindFirst,
  studentEnrollmentFindMany,
} = vi.hoisted(() => ({
  semesterFindFirst: vi.fn(),
  assessmentEntryFindMany: vi.fn(),
  weekFindFirst: vi.fn(),
  studentEnrollmentFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    semester: { findFirst: semesterFindFirst },
    assessmentEntry: { findMany: assessmentEntryFindMany },
    week: { findFirst: weekFindFirst },
    studentEnrollment: { findMany: studentEnrollmentFindMany },
  },
}));

import {
  loadStudentPerkembangan,
  aggregateByElement,
} from "@/lib/curriculum/perkembangan-loader";

beforeEach(() => {
  vi.clearAllMocks();
  studentEnrollmentFindMany.mockResolvedValue([
    { studentId: "stu1", classSection: { ageGroup: "A" } },
  ]);
});

describe("aggregateByElement (pure)", () => {
  it("returns 5 zero-rows for empty input", () => {
    const r = aggregateByElement([]);
    expect(r).toHaveLength(5);
    expect(r.every((row) => row.counts.total === 0)).toBe(true);
    expect(r.map((row) => row.element)).toEqual([
      "RELIGIOUS_MORAL",
      "IDENTITY",
      "STEAM",
      "MOTOR_SKILLS",
      "ART",
    ]);
  });

  it("counts CONSISTENT / EMERGING / NEEDS_REINFORCEMENT per element", () => {
    const r = aggregateByElement([
      { element: "RELIGIOUS_MORAL", level: "CONSISTENT" },
      { element: "RELIGIOUS_MORAL", level: "CONSISTENT" },
      { element: "RELIGIOUS_MORAL", level: "EMERGING" },
      { element: "STEAM", level: "NEEDS_REINFORCEMENT" },
    ]);
    const nam = r.find((x) => x.element === "RELIGIOUS_MORAL")!;
    expect(nam.counts).toEqual({
      CONSISTENT: 2,
      EMERGING: 1,
      NEEDS_REINFORCEMENT: 0,
      total: 3,
    });
    const steam = r.find((x) => x.element === "STEAM")!;
    expect(steam.counts.NEEDS_REINFORCEMENT).toBe(1);
    expect(steam.counts.total).toBe(1);
  });

  it("ignores rows with unknown element values (future-proof)", () => {
    const r = aggregateByElement([
      { element: "FUTURE_ELEMENT", level: "CONSISTENT" },
      { element: "ART", level: "CONSISTENT" },
    ]);
    expect(r.find((x) => x.element === "ART")!.counts.total).toBe(1);
    // Total across all known elements should equal 1, not 2.
    const grand = r.reduce((sum, row) => sum + row.counts.total, 0);
    expect(grand).toBe(1);
  });
});

describe("loadStudentPerkembangan", () => {
  it("returns null semester + zeroed elements when no active semester", async () => {
    semesterFindFirst.mockResolvedValue(null);
    const r = await loadStudentPerkembangan("t1", "stu1");
    expect(r.semester).toBeNull();
    expect(r.elements.every((e) => e.counts.total === 0)).toBe(true);
    expect(r.latestThisWeek).toEqual([]);
    expect(r.hasActiveWeek).toBe(false);
    expect(assessmentEntryFindMany).not.toHaveBeenCalled();
    expect(weekFindFirst).not.toHaveBeenCalled();
  });

  it("aggregates entries scoped to the active semester via indicator.objective.semesterId", async () => {
    semesterFindFirst.mockResolvedValue({
      id: "sem1",
      number: 1,
      academicYear: { id: "ay1", name: "2025/2026" },
    });
    assessmentEntryFindMany.mockResolvedValueOnce([
      { level: "CONSISTENT", indicator: { content: "x", objective: { element: "RELIGIOUS_MORAL" } } },
      { level: "EMERGING", indicator: { content: "y", objective: { element: "RELIGIOUS_MORAL" } } },
      { level: "CONSISTENT", indicator: { content: "z", objective: { element: "STEAM" } } },
    ]);
    weekFindFirst.mockResolvedValue(null);
    const r = await loadStudentPerkembangan("t1", "stu1");
    expect(r.semester?.id).toBe("sem1");
    const nam = r.elements.find((e) => e.element === "RELIGIOUS_MORAL")!;
    expect(nam.counts.total).toBe(2);
    expect(nam.counts.CONSISTENT).toBe(1);
    expect(nam.counts.EMERGING).toBe(1);
    // First findMany call must filter by indicator.objective.semesterId
    const callArgs = assessmentEntryFindMany.mock.calls[0][0];
    expect(callArgs.where.indicator.objective.semesterId).toBe("sem1");
    expect(callArgs.where.studentId).toBe("stu1");
    expect(callArgs.where.tenantId).toBe("t1");
  });

  it("populates latestThisWeek when an active week exists", async () => {
    semesterFindFirst.mockResolvedValue({
      id: "sem1",
      number: 1,
      academicYear: { id: "ay1", name: "2025/2026" },
    });
    assessmentEntryFindMany.mockResolvedValueOnce([]);
    weekFindFirst.mockResolvedValue({
      id: "wk1",
      number: 3,
      startDate: new Date("2026-05-11T00:00:00Z"),
      endDate: new Date("2026-05-15T00:00:00Z"),
      subTheme: { id: "st1", name: "Sub", theme: { id: "th1", name: "Theme", semesterId: "sem1" } },
    });
    assessmentEntryFindMany.mockResolvedValueOnce([
      {
        level: "CONSISTENT",
        date: new Date("2026-05-13T00:00:00Z"),
        source: "HOMEROOM",
        center: null,
        indicator: { content: "Doa", objective: { element: "RELIGIOUS_MORAL" } },
      },
      {
        level: "EMERGING",
        date: new Date("2026-05-12T00:00:00Z"),
        source: "CENTER",
        center: "WORSHIP",
        indicator: { content: "Asma", objective: { element: "RELIGIOUS_MORAL" } },
      },
    ]);
    const r = await loadStudentPerkembangan("t1", "stu1");
    expect(r.hasActiveWeek).toBe(true);
    expect(r.latestThisWeek).toHaveLength(2);
    expect(r.latestThisWeek[0].source).toBe("HOMEROOM");
    expect(r.latestThisWeek[0].date).toBe("2026-05-13");
    expect(r.latestThisWeek[1].center).toBe("WORSHIP");
  });

  it("carries the sentra activity through, normalising blanks to null", async () => {
    // m8: `activity` was written by the sentra route but absent from this
    // select, so the parent could never see what their child actually did.
    semesterFindFirst.mockResolvedValue({
      id: "sem1",
      number: 1,
      academicYear: { id: "ay1", name: "2025/2026" },
    });
    assessmentEntryFindMany.mockResolvedValueOnce([]);
    weekFindFirst.mockResolvedValue({
      id: "wk1",
      number: 3,
      startDate: new Date("2026-05-11T00:00:00Z"),
      endDate: new Date("2026-05-15T00:00:00Z"),
      subTheme: { id: "st1", name: "Sub", theme: { id: "th1", name: "Theme", semesterId: "sem1" } },
    });
    assessmentEntryFindMany.mockResolvedValueOnce([
      {
        level: "CONSISTENT",
        date: new Date("2026-05-13T00:00:00Z"),
        source: "CENTER",
        center: "ART",
        activity: "  Menggambar bebas dengan krayon  ",
        indicator: { content: "Doa", objective: { element: "ART" } },
      },
      {
        level: "EMERGING",
        date: new Date("2026-05-12T00:00:00Z"),
        source: "CENTER",
        center: "ART",
        activity: "   ",
        indicator: { content: "Asma", objective: { element: "ART" } },
      },
      {
        level: "EMERGING",
        date: new Date("2026-05-12T00:00:00Z"),
        source: "HOMEROOM",
        center: null,
        activity: null,
        indicator: { content: "Baris", objective: { element: "MOTOR_SKILLS" } },
      },
    ]);

    const r = await loadStudentPerkembangan("t1", "stu1");
    expect(r.latestThisWeek[0].activity).toBe("Menggambar bebas dengan krayon");
    expect(r.latestThisWeek[1].activity).toBeNull();
    expect(r.latestThisWeek[2].activity).toBeNull();

    // The field has to be requested, not just mapped.
    const recentArgs = assessmentEntryFindMany.mock.calls[1]![0]!;
    expect(recentArgs.select.activity).toBe(true);
  });

  it("returns empty latestThisWeek when no active week", async () => {
    semesterFindFirst.mockResolvedValue({
      id: "sem1",
      number: 1,
      academicYear: { id: "ay1", name: "2025/2026" },
    });
    assessmentEntryFindMany.mockResolvedValueOnce([]);
    weekFindFirst.mockResolvedValue(null);
    const r = await loadStudentPerkembangan("t1", "stu1");
    expect(r.hasActiveWeek).toBe(false);
    expect(r.latestThisWeek).toEqual([]);
  });
});
