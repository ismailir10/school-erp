import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  weekFindFirst,
  classSectionFindMany,
  studentEnrollmentFindMany,
  assessmentEntryFindMany,
} = vi.hoisted(() => ({
  weekFindFirst: vi.fn(),
  classSectionFindMany: vi.fn(),
  studentEnrollmentFindMany: vi.fn(),
  assessmentEntryFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    week: { findFirst: weekFindFirst },
    classSection: { findMany: classSectionFindMany },
    studentEnrollment: { findMany: studentEnrollmentFindMany },
    assessmentEntry: { findMany: assessmentEntryFindMany },
  },
}));

import {
  aggregateWalas,
  aggregateSentra,
  loadPenilaianMonitor,
} from "@/lib/curriculum/penilaian-monitor";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("aggregateWalas (pure)", () => {
  const classSections = [
    { id: "c1", name: "TK A1", program: { name: "TK Islam Terpadu" } },
    { id: "c2", name: "TK A2", program: { name: "TK Islam Terpadu" } },
  ];
  const enrollments = [
    { studentId: "s1", classSectionId: "c1" },
    { studentId: "s2", classSectionId: "c1" },
    { studentId: "s3", classSectionId: "c2" },
  ];

  it("reports assessed/enrolled, attributing assessed students to their class", () => {
    const r = aggregateWalas(classSections, enrollments, new Set(["s1", "s3"]));
    expect(r).toEqual([
      { classSectionId: "c1", className: "TK A1", programName: "TK Islam Terpadu", enrolled: 2, assessed: 1 },
      { classSectionId: "c2", className: "TK A2", programName: "TK Islam Terpadu", enrolled: 1, assessed: 1 },
    ]);
  });

  it("zero assessed when no student in the assessed set", () => {
    const r = aggregateWalas(classSections, enrollments, new Set());
    expect(r.map((x) => x.assessed)).toEqual([0, 0]);
    expect(r.map((x) => x.enrolled)).toEqual([2, 1]);
  });

  it("ignores enrollments pointing at unknown classes", () => {
    const r = aggregateWalas(
      classSections,
      [{ studentId: "s9", classSectionId: "ghost" }],
      new Set(["s9"]),
    );
    expect(r.every((x) => x.enrolled === 0 && x.assessed === 0)).toBe(true);
  });
});

describe("aggregateSentra (pure)", () => {
  it("always returns all 8 centers in canonical order", () => {
    const r = aggregateSentra([]);
    expect(r).toHaveLength(8);
    expect(r.map((x) => x.label)).toEqual([
      "Sentra Ibadah",
      "Sentra Bahan Alam",
      "Sentra Seni",
      "Sentra Memasak",
      "Sentra Main Peran",
      "Sentra Balok",
      "Sentra Persiapan",
      "Sentra Area",
    ]);
    expect(r.every((x) => x.entries === 0 && x.studentsAssessed === 0)).toBe(true);
  });

  it("counts entries and distinct students per center", () => {
    const r = aggregateSentra([
      { center: "WORSHIP", studentId: "s1" },
      { center: "WORSHIP", studentId: "s1" }, // same student, 2 indicators
      { center: "WORSHIP", studentId: "s2" },
      { center: "ART", studentId: "s3" },
      { center: null, studentId: "s4" }, // defensive: skipped
    ]);
    const worship = r.find((x) => x.label === "Sentra Ibadah")!;
    const art = r.find((x) => x.label === "Sentra Seni")!;
    expect(worship).toMatchObject({ entries: 3, studentsAssessed: 2 });
    expect(art).toMatchObject({ entries: 1, studentsAssessed: 1 });
  });

  it("groups by sentra name when the entry has one, appending non-legacy sentra", () => {
    const r = aggregateSentra([
      { center: "WORSHIP", sentra: { name: "Ibadah" }, studentId: "s1" },
      { center: null, sentra: { name: "Makro" }, studentId: "s2" },
      { center: null, sentra: { name: "Makro" }, studentId: "s3" },
    ]);
    expect(r.find((x) => x.label === "Sentra Ibadah")).toMatchObject({ entries: 1 });
    expect(r.at(-1)).toEqual({ label: "Sentra Makro", entries: 2, studentsAssessed: 2 });
  });
});

describe("loadPenilaianMonitor (integration)", () => {
  it("wires week + walas + sentra together", async () => {
    weekFindFirst.mockResolvedValue({
      id: "w1",
      number: 3,
      startDate: new Date("2026-08-01T00:00:00Z"),
      endDate: new Date("2026-08-07T00:00:00Z"),
      subTheme: { id: "st1", name: "Aku Sehat", theme: { id: "t1", name: "Saya Anak Sehat", semesterId: "sem1" } },
    });
    classSectionFindMany.mockResolvedValue([
      { id: "c1", name: "TK A1", ageGroup: "A", program: { name: "TKIT" } },
    ]);
    studentEnrollmentFindMany.mockResolvedValue([
      { studentId: "s1", classSectionId: "c1" },
      { studentId: "s2", classSectionId: "c1" },
    ]);
    assessmentEntryFindMany.mockImplementation((args: { where: { source: string } }) => {
      if (args.where.source === "HOMEROOM") return Promise.resolve([{ studentId: "s1" }]);
      return Promise.resolve([{ center: "WORSHIP", studentId: "s1" }]);
    });

    const r = await loadPenilaianMonitor(
      "tenant_x",
      "ay1",
      new Date("2026-08-03T00:00:00Z"),
      new Date("2026-08-03T00:00:00Z"),
    );

    expect(r.week).toEqual({ id: "w1", number: 3, subThemeName: "Aku Sehat", themeName: "Saya Anak Sehat" });
    expect(r.walas).toEqual([
      { classSectionId: "c1", className: "TK A1", programName: "TKIT", enrolled: 2, assessed: 1 },
    ]);
    expect(r.sentra.find((x) => x.label === "Sentra Ibadah")).toMatchObject({ entries: 1, studentsAssessed: 1 });
  });

  it("skips the homeroom query and returns null week when no active week", async () => {
    weekFindFirst.mockResolvedValue(null);
    classSectionFindMany.mockResolvedValue([]);
    // no classIds → studentEnrollment.findMany not called
    assessmentEntryFindMany.mockResolvedValue([]); // center query only

    const r = await loadPenilaianMonitor(
      "tenant_x",
      "ay1",
      new Date("2026-08-03T00:00:00Z"),
      new Date("2026-08-03T00:00:00Z"),
    );

    expect(r.week).toBeNull();
    expect(r.walas).toEqual([]);
    expect(studentEnrollmentFindMany).not.toHaveBeenCalled();
    // assessmentEntry.findMany called once (center), never for homeroom
    expect(assessmentEntryFindMany).toHaveBeenCalledTimes(1);
    expect(assessmentEntryFindMany.mock.calls[0][0].where.source).toBe("CENTER");
  });

  it("measures each class against the week of its own kelompok", async () => {
    const mkWeek = (id: string) => ({
      id,
      number: 3,
      startDate: new Date("2026-08-01T00:00:00Z"),
      endDate: new Date("2026-08-07T00:00:00Z"),
      subTheme: { id: `st-${id}`, name: "S", theme: { id: `t-${id}`, name: "T", semesterId: "sem1", ageGroup: null } },
    });
    weekFindFirst.mockImplementation(
      async ({ where }: { where: { subTheme: { theme: { OR: Array<{ ageGroup: string | null }> } } } }) =>
        where.subTheme.theme.OR[0].ageGroup === "A" ? mkWeek("wkA") : mkWeek("wkB"),
    );
    classSectionFindMany.mockResolvedValue([
      { id: "cA", name: "TK A1", ageGroup: "A", program: { name: "TKIT" } },
      { id: "cB", name: "TK B1", ageGroup: "B", program: { name: "TKIT" } },
    ]);
    studentEnrollmentFindMany.mockResolvedValue([
      { studentId: "sA", classSectionId: "cA" },
      { studentId: "sB", classSectionId: "cB" },
    ]);
    assessmentEntryFindMany.mockImplementation(
      async (args: { where: { source: string; weekId?: string } }) => {
        if (args.where.source !== "HOMEROOM") return [];
        // Only the TK B student has an entry, and only in the B week.
        return args.where.weekId === "wkB" ? [{ studentId: "sB" }] : [];
      },
    );

    const r = await loadPenilaianMonitor(
      "tenant_x",
      "ay1",
      new Date("2026-08-03T00:00:00Z"),
      new Date("2026-08-03T00:00:00Z"),
    );

    expect(r.walas).toEqual([
      { classSectionId: "cA", className: "TK A1", programName: "TKIT", enrolled: 1, assessed: 0 },
      { classSectionId: "cB", className: "TK B1", programName: "TKIT", enrolled: 1, assessed: 1 },
    ]);
  });
});

it("distinguishes same-name classes by campus", () => {
  const result = aggregateWalas([
    { id: "north", name: "KB", program: { name: "Kelompok Bermain" }, campus: { name: "Utara" } },
    { id: "south", name: "KB", program: { name: "Kelompok Bermain" }, campus: { name: "Selatan" } },
  ], [], new Set());
  expect(result.map((r) => r.className)).toEqual(["KB · Utara", "KB · Selatan"]);
});
