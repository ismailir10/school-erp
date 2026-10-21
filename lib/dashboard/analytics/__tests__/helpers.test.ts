import { describe, expect, it } from "vitest";
import {
  addDaysYmd,
  agingKey,
  bucketAging,
  bucketByMonth,
  buildAttendanceDays,
  completionPct,
  daysBetweenYmd,
  eightWeekStarts,
  nextMonthStart,
  rankLowestClasses,
  rateOf,
  sixMonths,
  sumPresent,
  weekIndexOf,
} from "../helpers";

describe("addDaysYmd / daysBetweenYmd", () => {
  it("crosses month and year boundaries", () => {
    expect(addDaysYmd("2026-10-21", -29)).toBe("2026-09-22");
    expect(addDaysYmd("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysYmd("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetweenYmd("2026-09-22", "2026-10-21")).toBe(29);
    expect(daysBetweenYmd("2026-10-21", "2026-10-21")).toBe(0);
    expect(daysBetweenYmd("2026-10-22", "2026-10-21")).toBe(-1);
  });
});

describe("rateOf", () => {
  it("rounds to an integer and is null for an empty total", () => {
    expect(rateOf(2, 3)).toBe(67);
    expect(rateOf(1, 3)).toBe(33);
    expect(rateOf(1, 200)).toBe(1); // 0.5 rounds up
    expect(rateOf(0, 5)).toBe(0);
    expect(rateOf(5, 5)).toBe(100);
    expect(rateOf(0, 0)).toBeNull();
  });
});

describe("buildAttendanceDays", () => {
  it("returns [] for no rows", () => {
    expect(buildAttendanceDays([])).toEqual([]);
  });

  it("collapses (date,status) groups into ascending days with integer rates", () => {
    const days = buildAttendanceDays([
      { date: "2026-10-20", status: "PRESENT", count: 8 },
      { date: "2026-10-19", status: "PRESENT", count: 1 },
      { date: "2026-10-19", status: "ABSENT", count: 1 },
      { date: "2026-10-20", status: "SICK", count: 1 },
      { date: "2026-10-20", status: "PERMISSION", count: 1 },
    ]);
    expect(days).toEqual([
      { date: "2026-10-19", present: 1, permission: 0, sick: 0, absent: 1, total: 2, rate: 50 },
      { date: "2026-10-20", present: 8, permission: 1, sick: 1, absent: 0, total: 10, rate: 80 },
    ]);
  });

  it("ignores unknown statuses entirely", () => {
    expect(buildAttendanceDays([{ date: "2026-10-20", status: "LATE", count: 4 }])).toEqual([]);
  });
});

describe("sumPresent", () => {
  it("counts only known statuses", () => {
    expect(
      sumPresent([
        { status: "PRESENT", count: 3 },
        { status: "SICK", count: 1 },
        { status: "WEIRD", count: 9 },
      ]),
    ).toEqual({ present: 3, total: 4 });
    expect(sumPresent([])).toEqual({ present: 0, total: 0 });
  });
});

describe("rankLowestClasses", () => {
  const names = new Map([
    ["a", "Kelas A"],
    ["b", "Kelas B"],
    ["c", "Kelas C"],
    ["d", "Kelas D"],
  ]);
  it("sorts ascending by rate then name, limits to 3, drops unknown classes", () => {
    const out = rankLowestClasses(
      [
        { classSectionId: "a", status: "PRESENT", count: 9 },
        { classSectionId: "a", status: "ABSENT", count: 1 },
        { classSectionId: "b", status: "PRESENT", count: 5 },
        { classSectionId: "b", status: "SICK", count: 5 },
        { classSectionId: "c", status: "PRESENT", count: 5 },
        { classSectionId: "c", status: "ABSENT", count: 5 },
        { classSectionId: "d", status: "PRESENT", count: 10 },
        { classSectionId: "inactive", status: "ABSENT", count: 50 },
      ],
      names,
    );
    expect(out).toEqual([
      { classSectionId: "b", name: "Kelas B", rate: 50, total: 10 },
      { classSectionId: "c", name: "Kelas C", rate: 50, total: 10 },
      { classSectionId: "a", name: "Kelas A", rate: 90, total: 10 },
    ]);
  });
  it("is empty for no rows", () => {
    expect(rankLowestClasses([], names)).toEqual([]);
  });
});

describe("eightWeekStarts", () => {
  it("returns 8 Mondays ending with the current week", () => {
    const w = eightWeekStarts("2026-10-21"); // Wednesday
    expect(w).toHaveLength(8);
    expect(w[7]).toBe("2026-10-19");
    expect(w[0]).toBe("2026-08-31");
    expect(w).toEqual([
      "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21",
      "2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19",
    ]);
  });
  it("treats Sunday as the end of the previous Mon-start week", () => {
    expect(eightWeekStarts("2026-10-25")[7]).toBe("2026-10-19");
    expect(eightWeekStarts("2026-10-26")[7]).toBe("2026-10-26");
  });
  it("spans a month and year boundary", () => {
    const w = eightWeekStarts("2027-01-06");
    expect(w[7]).toBe("2027-01-04");
    expect(w[0]).toBe("2026-11-16");
    expect(w).toContain("2026-12-28");
  });
});

describe("weekIndexOf", () => {
  const starts = eightWeekStarts("2026-10-21");
  it("maps dates to their week and rejects out-of-range dates", () => {
    expect(weekIndexOf("2026-10-19", starts)).toBe(7);
    expect(weekIndexOf("2026-10-23", starts)).toBe(7);
    expect(weekIndexOf("2026-08-31", starts)).toBe(0);
    expect(weekIndexOf("2026-08-30", starts)).toBe(-1);
  });
  it("optionally drops weekends", () => {
    expect(weekIndexOf("2026-10-24", starts, true)).toBe(-1);
    expect(weekIndexOf("2026-10-25", starts, true)).toBe(-1);
    expect(weekIndexOf("2026-10-24", starts)).toBe(7);
    expect(weekIndexOf("2026-10-23", starts, true)).toBe(7);
  });
});

describe("completionPct", () => {
  it("is null when nothing was possible", () => {
    expect(completionPct(0, 0)).toBeNull();
    expect(completionPct(5, 0)).toBeNull();
  });
  it("rounds and caps at 100", () => {
    expect(completionPct(1, 3)).toBe(33);
    expect(completionPct(2, 3)).toBe(67);
    expect(completionPct(0, 10)).toBe(0);
    expect(completionPct(10, 10)).toBe(100);
    expect(completionPct(15, 10)).toBe(100);
  });
});

describe("sixMonths / nextMonthStart", () => {
  it("ends with the current month, oldest first", () => {
    expect(sixMonths("2026-10-21")).toEqual([
      "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
  });
  it("wraps over a year boundary", () => {
    expect(sixMonths("2027-02-01")).toEqual([
      "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02",
    ]);
    expect(sixMonths("2026-12-31")[5]).toBe("2026-12");
  });
  it("finds the first day of the next month", () => {
    expect(nextMonthStart("2026-10")).toBe("2026-11-01");
    expect(nextMonthStart("2026-12")).toBe("2027-01-01");
  });
});

describe("bucketByMonth", () => {
  it("sums by month prefix, zero-fills, ignores out-of-window keys", () => {
    const months = sixMonths("2026-10-21");
    expect(
      bucketByMonth(
        [
          { key: "2026-10-03", amount: 100 },
          { key: "2026-10-31", amount: 50 },
          { key: "2026-07", amount: 7 },
          { key: "2026-04-30", amount: 999 },
          { key: "2026-11-01", amount: 999 },
        ],
        months,
      ),
    ).toEqual([0, 0, 7, 0, 0, 150]);
  });
  it("is all zeros for empty input", () => {
    expect(bucketByMonth([], ["2026-10"])).toEqual([0]);
  });
});

describe("agingKey", () => {
  const today = "2026-10-21";
  const due = (daysLate: number) => addDaysYmd(today, -daysLate);
  it.each([
    [-5, "current"],
    [0, "current"],
    [1, "d1_30"],
    [30, "d1_30"],
    [31, "d31_60"],
    [60, "d31_60"],
    [61, "d61_90"],
    [90, "d61_90"],
    [91, "d90_plus"],
    [400, "d90_plus"],
  ])("%i days past due -> %s", (late, key) => {
    expect(agingKey(due(late), today)).toBe(key);
  });
});

describe("bucketAging", () => {
  it("always returns the five keys in order, skipping non-positive balances", () => {
    const today = "2026-10-21";
    const out = bucketAging(
      [
        { dueDate: "2026-10-25", outstanding: 100, count: 1 },
        { dueDate: "2026-10-01", outstanding: 200, count: 2 },
        { dueDate: "2026-10-02", outstanding: 50, count: 1 },
        { dueDate: "2026-07-01", outstanding: 0, count: 3 },
        { dueDate: "2026-01-01", outstanding: -5, count: 1 },
      ],
      today,
    );
    expect(out.map((a) => a.key)).toEqual(["current", "d1_30", "d31_60", "d61_90", "d90_plus"]);
    expect(out).toEqual([
      { key: "current", amount: 100, count: 1 },
      { key: "d1_30", amount: 250, count: 3 },
      { key: "d31_60", amount: 0, count: 0 },
      { key: "d61_90", amount: 0, count: 0 },
      { key: "d90_plus", amount: 0, count: 0 },
    ]);
  });
  it("is all zero for no rows", () => {
    expect(bucketAging([], "2026-10-21").every((a) => a.amount === 0 && a.count === 0)).toBe(true);
  });
});
