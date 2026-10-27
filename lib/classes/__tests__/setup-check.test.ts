import { describe, it, expect } from "vitest";
import { checkClassSetup, classGroup, programGroup, type SetupClass } from "../setup-check";

const cls = (over: Partial<SetupClass> = {}): SetupClass => ({
  id: "c1",
  name: "TK A 1",
  ageGroup: "A",
  programName: "TK A",
  recurringFeeTotal: 499000,
  ...over,
});

describe("classGroup", () => {
  it.each([
    ["TK A 1", "A"],
    ["TKA 4", "A"],
    ["tk b 3", "B"],
    ["TK B3", "B"],
    ["TKIT-A", "A"],
    ["KB A", "A"],
    ["RA B", "B"],
  ])("reads %s as group %s from the name", (name, group) => {
    expect(classGroup({ name })).toBe(group);
  });

  it("falls back to kelompok usia when the name names no group", () => {
    expect(classGroup({ name: "Sakura", ageGroup: "B" })).toBe("B");
  });

  it("trusts the name over kelompok usia", () => {
    expect(classGroup({ name: "TK A 1", ageGroup: "B" })).toBe("A");
  });

  it("is null when neither says", () => {
    expect(classGroup({ name: "Sakura" })).toBeNull();
    expect(classGroup({ name: "TKBunga", ageGroup: "X" })).toBeNull();
  });

  it("does not read a group out of a longer word", () => {
    expect(classGroup({ name: "TK Bunga" })).toBeNull();
    expect(classGroup({ name: "KB Aster" })).toBeNull();
  });
});

describe("programGroup", () => {
  it.each([
    ["TK A", "A"],
    ["TK  B", "B"],
    ["TK Islam Terpadu Kelas A", "A"],
    ["tk b", "B"],
  ])("reads %s as group %s", (name, group) => {
    expect(programGroup(name)).toBe(group);
  });

  it.each(["Daycare", "KB", "TK Islam Terpadu", "Program AB"])("is null for %s", (name) => {
    expect(programGroup(name)).toBeNull();
  });
});

describe("checkClassSetup", () => {
  it("is quiet for a correctly linked class with fees", () => {
    expect(checkClassSetup([cls()])).toEqual([]);
  });

  it("flags a TK A class linked to the TK B program (the production case)", () => {
    expect(checkClassSetup([cls({ programName: "TK  B", recurringFeeTotal: 504000 })])).toEqual([
      { kind: "PROGRAM_NAME_MISMATCH", classSectionId: "c1", className: "TK A 1", programName: "TK  B" },
    ]);
  });

  it("flags a class whose program has no billable fee lines", () => {
    expect(checkClassSetup([cls({ recurringFeeTotal: null })])).toEqual([
      { kind: "NO_FEE_STRUCTURE", classSectionId: "c1", className: "TK A 1", programName: "TK A" },
    ]);
  });

  it("keeps a zero total quiet: lines exist, the amount is the admin's call", () => {
    expect(checkClassSetup([cls({ recurringFeeTotal: 0 })])).toEqual([]);
  });

  it("reports both problems on one class", () => {
    const kinds = checkClassSetup([cls({ programName: "TK B", recurringFeeTotal: null })]).map((w) => w.kind);
    expect(kinds).toEqual(["NO_FEE_STRUCTURE", "PROGRAM_NAME_MISMATCH"]);
  });

  it("does not guess when either side names no group", () => {
    expect(checkClassSetup([cls({ name: "Sakura", ageGroup: null, programName: "TK B" })])).toEqual([]);
    expect(checkClassSetup([cls({ programName: "Daycare" })])).toEqual([]);
  });

  it("keeps class order across several classes", () => {
    const out = checkClassSetup([
      cls({ id: "c1" }),
      cls({ id: "c2", name: "TK B 1", ageGroup: "B", programName: "TK A" }),
      cls({ id: "c3", recurringFeeTotal: null }),
    ]);
    expect(out.map((w) => w.classSectionId)).toEqual(["c2", "c3"]);
  });
});
