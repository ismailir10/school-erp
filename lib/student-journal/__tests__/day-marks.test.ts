import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  studentEnrollment: { findMany: vi.fn() },
  studentJournalDayMark: { findMany: vi.fn(), findFirst: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { getDayMarksForStudentWeek, getDayMark } from "../day-marks";
import { isMarkableDate } from "../day-mark-rules";

const WEEK = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];

beforeEach(() => vi.clearAllMocks());

describe("isMarkableDate", () => {
  it("allows today and past school days", () => {
    expect(isMarkableDate("2026-10-27", "2026-10-27")).toBe(true);
    expect(isMarkableDate("2026-10-26", "2026-10-27")).toBe(true);
  });
  it("refuses future days and weekends", () => {
    expect(isMarkableDate("2026-10-28", "2026-10-27")).toBe(false);
    expect(isMarkableDate("2026-10-24", "2026-10-27")).toBe(false); // Saturday
    expect(isMarkableDate("2026-10-25", "2026-10-27")).toBe(false); // Sunday
  });
});

describe("getDayMarksForStudentWeek", () => {
  it("maps date → keterangan for the student's active classes only, scoped to the tenant", async () => {
    db.studentEnrollment.findMany.mockResolvedValue([{ classSectionId: "c1" }]);
    db.studentJournalDayMark.findMany.mockResolvedValue([{ date: "2026-10-27", reason: "Renang" }]);
    expect(await getDayMarksForStudentWeek("t1", "s1", WEEK)).toEqual({ "2026-10-27": "Renang" });
    expect(db.studentEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { studentId: "s1", status: "ACTIVE", classSection: { tenantId: "t1" } } }),
    );
    expect(db.studentJournalDayMark.findMany.mock.calls[0][0].where).toEqual({
      tenantId: "t1", classSectionId: { in: ["c1"] }, date: { in: WEEK },
    });
  });

  it("joins distinct reasons when two of the student's classes mark the same day", async () => {
    db.studentEnrollment.findMany.mockResolvedValue([{ classSectionId: "c1" }, { classSectionId: "c2" }]);
    db.studentJournalDayMark.findMany.mockResolvedValue([
      { date: "2026-10-27", reason: "Renang" },
      { date: "2026-10-27", reason: "Libur" },
      { date: "2026-10-27", reason: "Renang" },
    ]);
    expect(await getDayMarksForStudentWeek("t1", "s1", WEEK)).toEqual({ "2026-10-27": "Renang · Libur" });
  });

  it("returns nothing, and runs no mark query, for a student with no active class", async () => {
    db.studentEnrollment.findMany.mockResolvedValue([]);
    expect(await getDayMarksForStudentWeek("t1", "s1", WEEK)).toEqual({});
    expect(db.studentJournalDayMark.findMany).not.toHaveBeenCalled();
  });
});

describe("getDayMark", () => {
  it("looks the mark up by tenant, class and date", async () => {
    db.studentJournalDayMark.findFirst.mockResolvedValue({ reason: "Renang" });
    expect(await getDayMark("t1", "c1", "2026-10-27")).toEqual({ reason: "Renang" });
    expect(db.studentJournalDayMark.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "t1", classSectionId: "c1", date: "2026-10-27" });
  });
});
