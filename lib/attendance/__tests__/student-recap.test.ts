import { describe, it, expect, vi, beforeEach } from "vitest";

const { enrollmentFindMany, attendanceGroupBy, sectionFindFirst } = vi.hoisted(
  () => ({
    enrollmentFindMany: vi.fn(),
    attendanceGroupBy: vi.fn(),
    sectionFindFirst: vi.fn(),
  }),
);

vi.mock("@/lib/db", () => ({
  prisma: {
    studentEnrollment: { findMany: enrollmentFindMany },
    studentAttendance: { findMany: attendanceGroupBy },
    classSection: { findFirst: sectionFindFirst },
  },
}));

import {
  parseMonthYear,
  monthWindow,
  getStudentRecap,
  resolveRecapRequest,
  buildRecapCsv,
  type StudentRecapRow,
} from "@/lib/attendance/student-recap";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseMonthYear", () => {
  it("accepts valid month/year", () => {
    expect(parseMonthYear("6", "2026")).toEqual({ month: 6, year: 2026 });
  });

  it("accepts zero-padded months (input type=month splits to '06')", () => {
    expect(parseMonthYear("06", "2026")).toEqual({ month: 6, year: 2026 });
  });

  it.each([
    ["0", "2026"],
    ["13", "2026"],
    ["6", "1999"],
    ["6", "2101"],
    ["foo", "2026"],
    ["6", "bar"],
    ["1.5", "2026"],
    ["6abc", "2026"],
    ["", "2026"],
    ["6", ""],
    // String-round-trip validators pass "NaN" (String(NaN) === "NaN", all
    // range compares false) — regression guard for the regex approach.
    ["NaN", "2026"],
    ["6", "NaN"],
    ["-6", "2026"],
    ["123", "2026"],
  ])("rejects month=%s year=%s", (m, y) => {
    expect(parseMonthYear(m, y)).toBeNull();
  });
});

describe("monthWindow", () => {
  it("pads single-digit months and rolls to next month", () => {
    expect(monthWindow(6, 2026)).toEqual({ gte: "2026-06-01", lt: "2026-07-01" });
  });

  it("rolls December into January of the next year", () => {
    expect(monthWindow(12, 2026)).toEqual({ gte: "2026-12-01", lt: "2027-01-01" });
  });
});

describe("getStudentRecap", () => {
  const enrollment = (
    studentId: string,
    name: string,
    classSectionId: string,
    className: string,
  ) => ({
    studentId,
    classSectionId,
    student: { name, nickname: null, nis: null },
    classSection: { name: className },
  });

  it("merges status counts onto the roster and computes total", async () => {
    enrollmentFindMany.mockResolvedValue([
      enrollment("s1", "Aisyah", "cs1", "TK A"),
      enrollment("s2", "Budi", "cs1", "TK A"),
    ]);
    attendanceGroupBy.mockResolvedValue([
      ...Array.from({ length: 18 }, (_, index) => ({ studentId: "s1", classSectionId: "cs1", status: "PRESENT", date: `2026-06-PRESENT-${index}`, sessionId: null })),
      ...Array.from({ length: 2 }, (_, index) => ({ studentId: "s1", classSectionId: "cs1", status: "SICK", date: `2026-06-SICK-${index}`, sessionId: null })),
      ...Array.from({ length: 1 }, (_, index) => ({ studentId: "s2", classSectionId: "cs1", status: "PERMISSION", date: `2026-06-PERMISSION-${index}`, sessionId: null })),
    ]);

    const rows = await getStudentRecap("t1", 6, 2026);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      studentId: "s1",
      present: 18,
      sick: 2,
      absent: 0,
      permission: 0,
      total: 20,
    });
    expect(rows[1]).toMatchObject({ studentId: "s2", permission: 1, total: 1 });
  });

  it("includes never-marked students with zero counts", async () => {
    enrollmentFindMany.mockResolvedValue([
      enrollment("s3", "Citra", "cs1", "TK A"),
    ]);
    attendanceGroupBy.mockResolvedValue([]);

    const rows = await getStudentRecap("t1", 6, 2026);
    expect(rows[0]).toMatchObject({
      present: 0,
      absent: 0,
      sick: 0,
      permission: 0,
      total: 0,
    });
  });

  it("sorts by class name then student name (id collation)", async () => {
    enrollmentFindMany.mockResolvedValue([
      enrollment("s1", "Zaid", "cs2", "TK B"),
      enrollment("s2", "Aisyah", "cs2", "TK B"),
      enrollment("s3", "Budi", "cs1", "TK A"),
    ]);
    attendanceGroupBy.mockResolvedValue([]);

    const rows = await getStudentRecap("t1", 6, 2026);
    expect(rows.map((r) => r.name)).toEqual(["Budi", "Aisyah", "Zaid"]);
  });

  it("scopes both queries to the tenant and month window, with class filter", async () => {
    enrollmentFindMany.mockResolvedValue([]);
    attendanceGroupBy.mockResolvedValue([]);

    await getStudentRecap("t1", 12, 2026, "cs9");

    expect(enrollmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "ACTIVE",
          classSection: { id: "cs9", tenantId: "t1" },
          student: { tenantId: "t1" },
        }),
      }),
    );
    expect(attendanceGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isVoided: false,
          classSection: { id: "cs9", tenantId: "t1" },
          date: { gte: "2026-12-01", lt: "2027-01-01" },
        }),
      }),
    );
  });

  it("attributes counts to the enrollment's class when a student moved classes", async () => {
    // Records marked under the old class (cs1) must not inflate the row for
    // the student's current class (cs2) — counts key on studentId AND class.
    enrollmentFindMany.mockResolvedValue([
      enrollment("s1", "Aisyah", "cs2", "TK B"),
    ]);
    attendanceGroupBy.mockResolvedValue([
      ...Array.from({ length: 5 }, (_, index) => ({ studentId: "s1", classSectionId: "cs1", status: "PRESENT", date: `2026-06-PRESENT-${index}`, sessionId: null })),
      ...Array.from({ length: 3 }, (_, index) => ({ studentId: "s1", classSectionId: "cs2", status: "PRESENT", date: `2026-06-PRESENT-${index}`, sessionId: null })),
    ]);

    const rows = await getStudentRecap("t1", 6, 2026);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ classSectionId: "cs2", present: 3, total: 3 });
  });
});

describe("buildRecapCsv", () => {
  const row = (over: Partial<StudentRecapRow>): StudentRecapRow => ({
    studentId: "s1",
    name: "Aisyah",
    nickname: null,
    nis: "001",
    classSectionId: "cs1",
    className: "TK A",
    present: 18,
    absent: 1,
    sick: 2,
    permission: 1,
    total: 22,
    ...over,
  });

  it("emits header, CRLF rows, and Bahasa status column order", () => {
    const csv = buildRecapCsv([row({})]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("NIS,Nama,Kelas,Hadir,Sakit,Izin,Alpa,Total Hari Tercatat");
    expect(lines[1]).toBe('"001","Aisyah","TK A",18,2,1,1,22');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("escapes embedded quotes and renders null NIS as empty cell", () => {
    const csv = buildRecapCsv([row({ nis: null, name: 'Budi "Bud" Santoso' })]);
    expect(csv).toContain('"","Budi ""Bud"" Santoso"');
  });

  it("renders header-only CSV for an empty roster", () => {
    expect(buildRecapCsv([])).toBe(
      "NIS,Nama,Kelas,Hadir,Sakit,Izin,Alpa,Total Hari Tercatat\r\n",
    );
  });

  it("neutralizes formula-injection prefixes in names (public daftar input)", () => {
    const csv = buildRecapCsv([row({ name: '=HYPERLINK("http://x")' })]);
    // Leading apostrophe stops Excel evaluating the cell; quotes still escaped.
    expect(csv).toContain('"\'=HYPERLINK(""http://x"")"');
  });
});

describe("resolveRecapRequest", () => {
  it("400s invalid month/year without touching the database", async () => {
    const r = await resolveRecapRequest(
      "t1",
      new URLSearchParams({ month: "NaN", year: "2026" }),
    );
    expect(r).toEqual({ ok: false, error: "Bulan dan tahun tidak valid", status: 400 });
    expect(sectionFindFirst).not.toHaveBeenCalled();
    expect(enrollmentFindMany).not.toHaveBeenCalled();
  });

  it("404s a class section outside the tenant", async () => {
    sectionFindFirst.mockResolvedValue(null);
    const r = await resolveRecapRequest(
      "t1",
      new URLSearchParams({ month: "6", year: "2026", classSectionId: "cs-foreign" }),
    );
    expect(r).toEqual({ ok: false, error: "Kelas tidak ditemukan", status: 404 });
    expect(sectionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cs-foreign", tenantId: "t1" },
      }),
    );
    expect(enrollmentFindMany).not.toHaveBeenCalled();
  });

  it("returns rows + parsed month/year on the happy path", async () => {
    sectionFindFirst.mockResolvedValue({ id: "cs1" });
    enrollmentFindMany.mockResolvedValue([]);
    attendanceGroupBy.mockResolvedValue([]);
    const r = await resolveRecapRequest(
      "t1",
      new URLSearchParams({ month: "06", year: "2026", classSectionId: "cs1" }),
    );
    expect(r).toEqual({ ok: true, rows: [], month: 6, year: 2026 });
  });
});
