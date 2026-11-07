import { describe, it, expect } from "vitest";
import { calculateWorkingDays, countAttendanceDays, parseWorkingDays } from "../working-days";

describe("parseWorkingDays", () => {
  it("parses JSON-encoded array", () => {
    expect(parseWorkingDays('["MON","TUE","WED","THU","FRI"]')).toEqual([
      "MON",
      "TUE",
      "WED",
      "THU",
      "FRI",
    ]);
  });

  it("parses legacy CSV form", () => {
    expect(parseWorkingDays("MON,TUE,WED,THU,FRI")).toEqual([
      "MON",
      "TUE",
      "WED",
      "THU",
      "FRI",
    ]);
  });

  it("handles whitespace and lowercase in CSV", () => {
    expect(parseWorkingDays(" mon , tue , wed ")).toEqual(["MON", "TUE", "WED"]);
  });

  it("filters unknown day codes", () => {
    expect(parseWorkingDays('["MON","XYZ","TUE"]')).toEqual(["MON", "TUE"]);
    expect(parseWorkingDays("MON,XYZ,TUE")).toEqual(["MON", "TUE"]);
  });

  it("dedupes repeated codes", () => {
    expect(parseWorkingDays("MON,MON,TUE")).toEqual(["MON", "TUE"]);
  });

  it("returns empty array for null, undefined, or empty input", () => {
    expect(parseWorkingDays(null)).toEqual([]);
    expect(parseWorkingDays(undefined)).toEqual([]);
    expect(parseWorkingDays("")).toEqual([]);
    expect(parseWorkingDays("   ")).toEqual([]);
  });

  it("returns empty array for malformed JSON that does not look like CSV", () => {
    expect(parseWorkingDays("[")).toEqual([]);
    expect(parseWorkingDays("[}}")).toEqual([]);
  });

  it("returns empty array when JSON is not an array", () => {
    expect(parseWorkingDays('{"a":"b"}')).toEqual([]);
  });
});

describe("calculateWorkingDays", () => {
  const monFri = ["MON", "TUE", "WED", "THU", "FRI"];

  it("counts working days excluding weekends", () => {
    // Aug 21 (Wed) to Sep 20 (Fri) 2024
    const result = calculateWorkingDays("2024-08-21", "2024-09-20", monFri, []);
    expect(result).toBe(23); // 23 weekdays in this range
  });

  it("excludes full-day holidays", () => {
    const holidays = [
      { date: "2024-08-17", isHalfDay: false }, // Saturday - no effect
      { date: "2024-09-16", isHalfDay: false }, // Monday - reduces by 1
    ];
    const result = calculateWorkingDays("2024-08-21", "2024-09-20", monFri, holidays);
    expect(result).toBe(22); // 23 - 1 holiday on weekday
  });

  it("counts half-day holidays as 0.5", () => {
    const holidays = [
      { date: "2024-09-02", isHalfDay: true }, // Monday
    ];
    const result = calculateWorkingDays("2024-08-21", "2024-09-20", monFri, holidays);
    expect(result).toBe(22.5); // 23 - 0.5
  });

  it("ignores holidays on weekends", () => {
    const holidays = [
      { date: "2024-08-24", isHalfDay: false }, // Saturday
      { date: "2024-08-25", isHalfDay: false }, // Sunday
    ];
    const result = calculateWorkingDays("2024-08-21", "2024-09-20", monFri, holidays);
    expect(result).toBe(23);
  });
});

describe("countAttendanceDays", () => {
  it("counts PRESENT, LATE, PRESENT_NO_CHECKOUT as full days", () => {
    const records = [
      { status: "PRESENT" },
      { status: "LATE" },
      { status: "PRESENT_NO_CHECKOUT" },
      { status: "ABSENT" },
    ];
    const { daysPresent, daysLeave } = countAttendanceDays(records);
    expect(daysPresent).toBe(3);
    expect(daysLeave).toBe(0);
  });

  it("counts HALF_DAY as 0.5", () => {
    const records = [
      { status: "PRESENT" },
      { status: "HALF_DAY" },
    ];
    const { daysPresent } = countAttendanceDays(records);
    expect(daysPresent).toBe(1.5);
  });

  it("counts LEAVE separately", () => {
    const records = [
      { status: "PRESENT" },
      { status: "LEAVE" },
      { status: "LEAVE" },
    ];
    const { daysPresent, daysLeave } = countAttendanceDays(records);
    expect(daysPresent).toBe(1);
    expect(daysLeave).toBe(2);
  });

  it("counts only APPROVED records; PENDING and REJECTED are not worked days", () => {
    const records = [
      { status: "PRESENT", approvalStatus: "APPROVED" },
      { status: "PRESENT", approvalStatus: "PENDING" },
      { status: "LATE", approvalStatus: "PENDING" },
      { status: "ABSENT", approvalStatus: "REJECTED" },
      { status: "LEAVE", approvalStatus: "PENDING" },
    ];
    expect(countAttendanceDays(records)).toEqual({ daysPresent: 1, daysLeave: 0 });
  });

  it("treats a missing or null approvalStatus as APPROVED", () => {
    const records = [{ status: "PRESENT" }, { status: "LATE", approvalStatus: null }, { status: "LEAVE", approvalStatus: undefined }];
    expect(countAttendanceDays(records)).toEqual({ daysPresent: 2, daysLeave: 1 });
  });
});
