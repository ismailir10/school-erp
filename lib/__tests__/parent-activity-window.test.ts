import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    studentAttendance: { findMany: vi.fn() },
    studentJournalNote: { findMany: vi.fn() },
    studentJournalEntry: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    reportCardEntry: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { getStudentRecentActivity } from "@/lib/parent-activity";

/**
 * The attendance and journal-entry filters are calendar days (`date: { gte:
 * "YYYY-MM-DD" }`), so "the last 30 days" must be counted in Jakarta days.
 * The cutoff used the UTC date of the instant 30 days ago, which for the first
 * seven hours of each WIB day is a day too early: the window was 31 days.
 */
describe("getStudentRecentActivity — day-based window follows the Jakarta calendar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    for (const model of [
      prisma.studentAttendance,
      prisma.studentJournalNote,
      prisma.studentJournalEntry,
      prisma.invoice,
      prisma.reportCardEntry,
      prisma.user,
    ]) {
      vi.mocked(model.findMany).mockResolvedValue([] as never);
    }
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function gte(model: { findMany: unknown }): string {
    const call = vi.mocked(model.findMany as typeof prisma.studentAttendance.findMany).mock.calls[0]![0] as {
      where: { date: { gte: string } };
    };
    return call.where.date.gte;
  }

  it("at 03:00 WIB on 15 Oct (20:00Z on the 14th) the cutoff is 15 Sep, exactly 30 Jakarta days back", async () => {
    vi.setSystemTime(new Date("2026-10-14T20:00:00.000Z"));
    await getStudentRecentActivity("stu-1", "t1");
    expect(gte(prisma.studentAttendance)).toBe("2026-09-15");
    expect(gte(prisma.studentJournalEntry)).toBe("2026-09-15");
  });

  it("at 12:00 WIB the same Jakarta day gives the same cutoff", async () => {
    vi.setSystemTime(new Date("2026-10-15T05:00:00.000Z"));
    await getStudentRecentActivity("stu-1", "t1");
    expect(gte(prisma.studentAttendance)).toBe("2026-09-15");
  });

  it("at 23:30 WIB still counts from that Jakarta day", async () => {
    vi.setSystemTime(new Date("2026-10-15T16:30:00.000Z"));
    await getStudentRecentActivity("stu-1", "t1");
    expect(gte(prisma.studentAttendance)).toBe("2026-09-15");
  });

  it("honours a custom window", async () => {
    vi.setSystemTime(new Date("2026-10-14T20:00:00.000Z"));
    await getStudentRecentActivity("stu-1", "t1", { days: 7 });
    expect(gte(prisma.studentAttendance)).toBe("2026-10-08");
  });

  it("keeps the instant-based filters on the real instant", async () => {
    vi.setSystemTime(new Date("2026-10-14T20:00:00.000Z"));
    await getStudentRecentActivity("stu-1", "t1");
    const note = vi.mocked(prisma.studentJournalNote.findMany).mock.calls[0]![0] as {
      where: { createdAt: { gte: Date } };
    };
    expect(note.where.createdAt.gte.toISOString()).toBe("2026-09-14T20:00:00.000Z");
  });
});
