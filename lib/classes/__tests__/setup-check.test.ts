import { describe, it, expect } from "vitest";
import { checkClassSetup, groupOf, type SetupClass } from "../setup-check";

const cls = (over: Partial<SetupClass> = {}): SetupClass => ({
  id: "c1",
  name: "TK A 1",
  programName: "TK A",
  recurringFeeTotal: 499000,
  ...over,
});

describe("groupOf", () => {
  it.each([
    ["TK A 1", "A"],
    ["TKA 4", "A"],
    ["tk b 3", "B"],
    ["TK B3", "B"],
    ["TKIT-A", "A"],
    ["TK-B 2", "B"],
    ["KB A", "A"],
    ["RA B", "B"],
    ["TK B (Reguler)", "B"],
    ["TK A - 2026", "A"],
    ["TKB", "B"],
    ["TK A", "A"],
    ["TK  B", "B"],
    ["TK Islam Terpadu Kelas A", "A"],
  ])("reads %s as group %s", (name, group) => {
    expect(groupOf(name)).toBe(group);
  });

  it.each([
    "Sakura",
    "KB Aster",
    "TK Bunga",
    "TK Bintang",
    "TKBunga",
    "TK Annisa",
    "TK A/B",
    "Daycare",
    "D'Care",
    "Day Care",
    "POPUP Weekend",
    "TK Islam Terpadu",
    "Program AB",
    "KB",
  ])("reads %s as no group", (name) => {
    expect(groupOf(name)).toBeNull();
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

  it("catches the mismatch whichever way the program is spelled", () => {
    for (const programName of ["TKB", "TK-B", "TK B (Reguler)", "TK Islam Terpadu Kelas B"]) {
      expect(checkClassSetup([cls({ programName })]).map((w) => w.kind)).toEqual(["PROGRAM_NAME_MISMATCH"]);
    }
  });

  it("flags a class whose program has no billable fee lines", () => {
    expect(checkClassSetup([cls({ recurringFeeTotal: null })])).toEqual([
      { kind: "NO_FEE_STRUCTURE", classSectionId: "c1", className: "TK A 1", programName: "TK A" },
    ]);
  });

  it("keeps a zero total quiet: lines exist, the amount is the admin's call", () => {
    expect(checkClassSetup([cls({ recurringFeeTotal: 0 })])).toEqual([]);
  });

  it("never warns about fees when the fee is unknown", () => {
    expect(checkClassSetup([cls({ recurringFeeTotal: undefined })])).toEqual([]);
  });

  it("reports both problems on one class", () => {
    const kinds = checkClassSetup([cls({ programName: "TK B", recurringFeeTotal: null })]).map((w) => w.kind);
    expect(kinds).toEqual(["NO_FEE_STRUCTURE", "PROGRAM_NAME_MISMATCH"]);
  });

  it("does not guess when either side names no group", () => {
    expect(checkClassSetup([cls({ name: "Sakura", programName: "TK B" })])).toEqual([]);
    expect(checkClassSetup([cls({ programName: "Daycare" })])).toEqual([]);
    expect(checkClassSetup([cls({ name: "KB Aster", programName: "Playgroup A" })])).toEqual([]);
  });

  it("keeps class order across several classes", () => {
    const out = checkClassSetup([
      cls({ id: "c1" }),
      cls({ id: "c2", name: "TK B 1", programName: "TK A" }),
      cls({ id: "c3", recurringFeeTotal: null }),
    ]);
    expect(out.map((w) => w.classSectionId)).toEqual(["c2", "c3"]);
  });
});
