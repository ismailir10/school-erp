import { describe, expect, it, vi } from "vitest";
import {
  attendanceLast7Days,
  computeHealthBadge,
  todaySessionState,
} from "../health";
import type { PrismaClient } from "@/lib/generated/prisma/client";

type GroupByRow = {
  classSectionId: string;
  status: string;
  _count: { _all: number };
};

function mockPrismaForAttendance(rows: GroupByRow[]): PrismaClient {
  return {
    studentAttendance: {
      groupBy: vi.fn().mockResolvedValue(rows),
    },
  } as unknown as PrismaClient;
}

function mockPrismaForSessions(opts: {
  holiday: { id: string } | null;
  sessionsHeld: string[];
}): PrismaClient {
  return {
    holiday: {
      findFirst: vi.fn().mockResolvedValue(opts.holiday),
    },
    classSession: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          opts.sessionsHeld.map((classSectionId) => ({ classSectionId })),
        ),
    },
  } as unknown as PrismaClient;
}

describe("computeHealthBadge", () => {
  const base = {
    status: "ACTIVE",
    enrolledCount: 15,
    capacity: 20,
    attendance7dPct: 90,
    todaySession: "Held" as const,
  };

  it("returns Tidak Aktif when status is INACTIVE", () => {
    expect(computeHealthBadge({ ...base, status: "INACTIVE" })).toBe(
      "Tidak Aktif",
    );
  });

  it("INACTIVE overrides every other signal", () => {
    expect(
      computeHealthBadge({
        ...base,
        status: "INACTIVE",
        attendance7dPct: 10,
        enrolledCount: 0,
        todaySession: "Missing",
      }),
    ).toBe("Tidak Aktif");
  });

  it("returns Libur when today is Holiday (regardless of attendance)", () => {
    expect(
      computeHealthBadge({ ...base, todaySession: "Holiday" }),
    ).toBe("Libur");
    expect(
      computeHealthBadge({
        ...base,
        todaySession: "Holiday",
        attendance7dPct: 30,
      }),
    ).toBe("Libur");
  });

  it("returns the neutral Belum ada siswa (not Kritis) when roster is empty", () => {
    expect(
      computeHealthBadge({ ...base, enrolledCount: 0 }),
    ).toBe("Belum ada siswa");
    // Even with a bad attendance signal there is no roster to be critical about.
    expect(
      computeHealthBadge({ ...base, enrolledCount: 0, attendance7dPct: 10 }),
    ).toBe("Belum ada siswa");
  });

  it("returns Kritis when attendance7dPct < 70", () => {
    expect(
      computeHealthBadge({ ...base, attendance7dPct: 69.9 }),
    ).toBe("Kritis");
    expect(
      computeHealthBadge({ ...base, attendance7dPct: 0 }),
    ).toBe("Kritis");
  });

  it("returns Sehat when attendance >= 85 AND capacity >= 50% AND today Held", () => {
    expect(
      computeHealthBadge({
        ...base,
        attendance7dPct: 85,
        enrolledCount: 10,
        capacity: 20,
        todaySession: "Held",
      }),
    ).toBe("Sehat");
    expect(
      computeHealthBadge({
        ...base,
        attendance7dPct: 100,
        enrolledCount: 20,
        capacity: 20,
      }),
    ).toBe("Sehat");
  });

  it("returns Perhatian when attendance 70-84%", () => {
    expect(
      computeHealthBadge({ ...base, attendance7dPct: 70 }),
    ).toBe("Perhatian");
    expect(
      computeHealthBadge({ ...base, attendance7dPct: 84.9 }),
    ).toBe("Perhatian");
  });

  it("returns Perhatian when capacity utilization < 50% even with high attendance", () => {
    expect(
      computeHealthBadge({
        ...base,
        attendance7dPct: 95,
        enrolledCount: 4,
        capacity: 20,
      }),
    ).toBe("Perhatian");
  });

  it("returns Perhatian when today's session is Missing without holiday reason", () => {
    expect(
      computeHealthBadge({
        ...base,
        attendance7dPct: 95,
        todaySession: "Missing",
      }),
    ).toBe("Perhatian");
  });

  it("returns Perhatian when capacity is zero (utilization 0%) but roster exists", () => {
    expect(
      computeHealthBadge({
        ...base,
        capacity: 0,
        enrolledCount: 1,
        attendance7dPct: 90,
      }),
    ).toBe("Perhatian");
  });

  it("treats null attendance7dPct as no-attendance-signal — neither Sehat nor Kritis from it", () => {
    expect(
      computeHealthBadge({ ...base, attendance7dPct: null }),
    ).toBe("Perhatian");
    expect(
      computeHealthBadge({
        ...base,
        attendance7dPct: null,
        enrolledCount: 0,
      }),
    ).toBe("Belum ada siswa");
  });

  it("Sehat requires Held today (not Missing, not Holiday handled earlier)", () => {
    expect(
      computeHealthBadge({
        ...base,
        attendance7dPct: 100,
        enrolledCount: 20,
        capacity: 20,
        todaySession: "Missing",
      }),
    ).toBe("Perhatian");
  });

  it("Libur wins over Belum ada siswa (no roster) for an ACTIVE class on a holiday", () => {
    expect(
      computeHealthBadge({
        ...base,
        enrolledCount: 0,
        todaySession: "Holiday",
      }),
    ).toBe("Libur");
  });
});

describe("attendanceLast7Days", () => {
  it("returns empty map when sectionIds is empty", async () => {
    const prisma = mockPrismaForAttendance([]);
    const out = await attendanceLast7Days(prisma, [], "2026-05-19");
    expect(out.size).toBe(0);
  });

  it("counts PRESENT in numerator, every status in denominator", async () => {
    const prisma = mockPrismaForAttendance([
      { classSectionId: "sec1", status: "PRESENT", _count: { _all: 8 } },
      { classSectionId: "sec1", status: "SICK", _count: { _all: 1 } },
      { classSectionId: "sec1", status: "PERMISSION", _count: { _all: 1 } },
      { classSectionId: "sec1", status: "ABSENT", _count: { _all: 0 } },
    ]);
    const out = await attendanceLast7Days(prisma, ["sec1"], "2026-05-19");
    expect(out.get("sec1")).toEqual({
      presentCount: 8,
      totalCount: 10,
      attendance7dPct: 80,
    });
  });

  it("SICK and PERMISSION do NOT count toward present (excused but not in class)", async () => {
    const prisma = mockPrismaForAttendance([
      { classSectionId: "sec1", status: "SICK", _count: { _all: 10 } },
    ]);
    const out = await attendanceLast7Days(prisma, ["sec1"], "2026-05-19");
    expect(out.get("sec1")).toEqual({
      presentCount: 0,
      totalCount: 10,
      attendance7dPct: 0,
    });
  });

  it("returns attendance7dPct=null for sections with zero rows", async () => {
    const prisma = mockPrismaForAttendance([]);
    const out = await attendanceLast7Days(prisma, ["sec1"], "2026-05-19");
    expect(out.get("sec1")).toEqual({
      presentCount: 0,
      totalCount: 0,
      attendance7dPct: null,
    });
  });

  it("handles multiple sections independently", async () => {
    const prisma = mockPrismaForAttendance([
      { classSectionId: "sec1", status: "PRESENT", _count: { _all: 7 } },
      { classSectionId: "sec1", status: "ABSENT", _count: { _all: 3 } },
      { classSectionId: "sec2", status: "PRESENT", _count: { _all: 10 } },
    ]);
    const out = await attendanceLast7Days(
      prisma,
      ["sec1", "sec2", "sec3"],
      "2026-05-19",
    );
    expect(out.get("sec1")?.attendance7dPct).toBe(70);
    expect(out.get("sec2")?.attendance7dPct).toBe(100);
    expect(out.get("sec3")?.attendance7dPct).toBeNull();
  });

  it("queries with isVoided=false and sessionId not null", async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    const prisma = {
      studentAttendance: { groupBy },
    } as unknown as PrismaClient;
    await attendanceLast7Days(prisma, ["sec1"], "2026-05-19");
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isVoided: false,
          sessionId: { not: null },
        }),
      }),
    );
  });

  it("uses a 7-day inclusive window [today-6, today]", async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    const prisma = {
      studentAttendance: { groupBy },
    } as unknown as PrismaClient;
    await attendanceLast7Days(prisma, ["sec1"], "2026-05-19");
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: { gte: "2026-05-13", lte: "2026-05-19" },
        }),
      }),
    );
  });
});

describe("todaySessionState", () => {
  it("returns empty map when sectionIds is empty", async () => {
    const prisma = mockPrismaForSessions({ holiday: null, sessionsHeld: [] });
    const out = await todaySessionState(
      prisma,
      [],
      "2026-05-19",
      "tenant1",
      true,
    );
    expect(out.size).toBe(0);
  });

  it("returns Holiday for every section when isWorkingDay is false", async () => {
    const prisma = mockPrismaForSessions({ holiday: null, sessionsHeld: [] });
    const out = await todaySessionState(
      prisma,
      ["sec1", "sec2"],
      "2026-05-19",
      "tenant1",
      false,
    );
    expect(out.get("sec1")?.state).toBe("Holiday");
    expect(out.get("sec2")?.state).toBe("Holiday");
  });

  it("returns Holiday for every section when a Holiday row matches today", async () => {
    const prisma = mockPrismaForSessions({
      holiday: { id: "hol1" },
      sessionsHeld: [],
    });
    const out = await todaySessionState(
      prisma,
      ["sec1"],
      "2026-05-19",
      "tenant1",
      true,
    );
    expect(out.get("sec1")?.state).toBe("Holiday");
  });

  it("returns Held for sections with a ClassSession on today and Missing for those without", async () => {
    const prisma = mockPrismaForSessions({
      holiday: null,
      sessionsHeld: ["sec1"],
    });
    const out = await todaySessionState(
      prisma,
      ["sec1", "sec2"],
      "2026-05-19",
      "tenant1",
      true,
    );
    expect(out.get("sec1")?.state).toBe("Held");
    expect(out.get("sec2")?.state).toBe("Missing");
  });
});
