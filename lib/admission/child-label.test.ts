import { describe, it, expect } from "vitest";
import { admissionChildLabel } from "./child-label";

describe("admissionChildLabel", () => {
  it("returns the trimmed name when present", () => {
    expect(admissionChildLabel("  Aisyah ")).toBe("Aisyah");
  });

  it.each(["", "   ", null, undefined])("falls back to the placeholder for %j", (value) => {
    expect(admissionChildLabel(value)).toBe("Belum diisi");
  });
});
