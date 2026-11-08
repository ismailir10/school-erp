import { describe, expect, it } from "vitest";
import { parseWorkingDays } from "../dates";

describe("parseWorkingDays", () => {
  it("parses a JSON array", () => {
    const { set, unknownCodes } = parseWorkingDays('["MON","TUE","FRI"]');
    expect([...set].sort()).toEqual(["FRI", "MON", "TUE"]);
    expect(unknownCodes).toEqual([]);
  });

  it("parses the legacy CSV form", () => {
    const { set, unknownCodes } = parseWorkingDays("MON,TUE,WED,THU,FRI");
    expect([...set].sort()).toEqual(["FRI", "MON", "THU", "TUE", "WED"]);
    expect(unknownCodes).toEqual([]);
  });

  it("tolerates case and whitespace in both forms", () => {
    expect([...parseWorkingDays(' mon , Tue ,wed ').set].sort()).toEqual(["MON", "TUE", "WED"]);
    expect([...parseWorkingDays('[" mon ","Tue"]').set].sort()).toEqual(["MON", "TUE"]);
  });

  it("reports unknown codes in both forms", () => {
    expect(parseWorkingDays('["MONDAY","TUE"]').unknownCodes).toEqual(["MONDAY"]);
    expect(parseWorkingDays("MON,FOO").unknownCodes).toEqual(["FOO"]);
  });

  it("throws on JSON that is not an array", () => {
    expect(() => parseWorkingDays('{"a":1}')).toThrow("org_config_working_days_not_array");
    expect(() => parseWorkingDays('"MON"')).toThrow("org_config_working_days_not_array");
  });

  it("throws on a value with no recognisable day code", () => {
    expect(() => parseWorkingDays("garbage")).toThrow("org_config_working_days_invalid_json");
    expect(() => parseWorkingDays("")).toThrow("org_config_working_days_invalid_json");
    expect(() => parseWorkingDays("[not json")).toThrow("org_config_working_days_invalid_json");
  });
});
