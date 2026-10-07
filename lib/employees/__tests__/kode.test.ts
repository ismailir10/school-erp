import { describe, it, expect } from "vitest";
import { employeeInitials, isKodeCollision, maxKodeNumber, nextEmployeeKode } from "../kode";

describe("nextEmployeeKode (STR-4)", () => {
  it("issues a strictly increasing global sequence across different initials", () => {
    // Reproduces the stress run: RE29 > RD30 lexicographically, so the old
    // generator re-issued RD30 for "Rani Dewi".
    const existing = ["BS5", "TG28"];
    const re = nextEmployeeKode("Race Emp", existing);
    expect(re).toBe("RE29");
    const rd = nextEmployeeKode("Race Dua", [...existing, re]);
    expect(rd).toBe("RD30");
    const rani = nextEmployeeKode("Rani Dewi", [...existing, re, rd]);
    expect(rani).toBe("RD31");
  });

  it("compares numerically, not as strings (99 -> 100)", () => {
    expect(nextEmployeeKode("Ana Budi", ["AB99", "ZZ9"])).toBe("AB100");
    expect(nextEmployeeKode("Ana Budi", ["AB100", "AB99"])).toBe("AB101");
  });

  it("starts at 1 when the tenant has no codes (or none with a number)", () => {
    expect(nextEmployeeKode("Ana Budi", [])).toBe("AB1");
    expect(nextEmployeeKode("Ana Budi", ["LEGACY"])).toBe("AB1");
  });

  it("survives absurdly long numeric suffixes without float notation", () => {
    expect(maxKodeNumber(["X123456789012345678901234567890"])).toBe(BigInt("123456789012345678901234567890"));
    expect(nextEmployeeKode("A", ["X999999999999999999999"])).toBe("A1000000000000000000000");
  });
});

describe("employeeInitials", () => {
  it("takes the first letter of up to two words, upper-cased", () => {
    expect(employeeInitials("budi santoso wijaya")).toBe("BS");
    expect(employeeInitials("  Siti  ")).toBe("S");
  });

  it("never splits an emoji surrogate pair; emoji are not letters", () => {
    const code = nextEmployeeKode("😀 Emoji Guru", ["EG29"]);
    expect(code).toBe("EG30");
    // No lone surrogates anywhere in the result.
    expect(code).not.toMatch(/[\uD800-\uDFFF]/);
    expect(employeeInitials("😀😀")).toBe("X");
  });

  it("keeps a non-Latin first letter as-is (Arabic: upper-casing is a no-op)", () => {
    // Decision: accept any Unicode letter. Arabic names get Arabic initials
    // ("مع") rather than all collapsing to "X"; they are plain Postgres text.
    expect(employeeInitials("محمد علي")).toBe("مع");
    expect(nextEmployeeKode("محمد علي", ["AB7"])).toBe("مع8");
  });

  it("falls back to X when the name has no letters", () => {
    expect(employeeInitials("123 !!!")).toBe("X");
    expect(employeeInitials("   ")).toBe("X");
    expect(nextEmployeeKode("---", ["AB7"])).toBe("X8");
  });

  it("skips symbol-only words and uses the next word", () => {
    expect(employeeInitials("(Ust.) Ahmad Fauzi")).toBe("UA");
    expect(employeeInitials("- Ahmad Fauzi")).toBe("AF");
  });

  it("keeps one code point when upper-casing expands (ß -> SS)", () => {
    expect(employeeInitials("ßen")).toBe("S");
  });
});

describe("isKodeCollision", () => {
  it("matches a P2002 whose target mentions kode, in any meta shape", () => {
    expect(isKodeCollision({ code: "P2002", meta: { target: ["tenantId", "kode"] } })).toBe(true);
    expect(isKodeCollision({ code: "P2002", meta: { target: "Employee_tenantId_kode_key" } })).toBe(true);
    expect(
      isKodeCollision({ code: "P2002", meta: { driverAdapterError: { cause: { constraint: { fields: ["tenantId", "kode"] } } } } }),
    ).toBe(true);
  });

  it("rejects other unique violations and other errors", () => {
    expect(isKodeCollision({ code: "P2002", meta: { target: ["email"] } })).toBe(false);
    expect(isKodeCollision({ code: "P2034" })).toBe(false);
    expect(isKodeCollision(new Error("boom"))).toBe(false);
    expect(isKodeCollision(null)).toBe(false);
  });
});
