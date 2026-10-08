import { describe, it, expect } from "vitest";
import { raportMeasurementSchema, raportUpsertSchema } from "../raport";

function issues(v: Record<string, unknown>) {
  const r = raportMeasurementSchema.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

describe("raport height / weight (ADM-14)", () => {
  it("accepts in-range values, the ceilings, null and omitted", () => {
    expect(issues({ heightCm: 95.5, weightKg: 14 })).toEqual([]);
    expect(issues({ heightCm: 250, weightKg: 200 })).toEqual([]);
    expect(issues({ heightCm: null, weightKg: null })).toEqual([]);
    expect(issues({})).toEqual([]);
  });

  it("caps height at 250 cm and weight at 200 kg in Indonesian", () => {
    expect(issues({ heightCm: 251 })).toEqual([{ path: "heightCm", message: "Tinggi maksimal 250 cm" }]);
    expect(issues({ weightKg: 200.5 })).toEqual([{ path: "weightKg", message: "Berat maksimal 200 kg" }]);
  });

  it("rejects zero and negatives with 'Harus lebih dari 0'", () => {
    expect(issues({ heightCm: 0 })[0].message).toBe("Harus lebih dari 0");
    expect(issues({ weightKg: -3 })[0].message).toBe("Harus lebih dari 0");
  });

  it("rejects non-numbers and NaN with 'Harus berupa angka'", () => {
    expect(issues({ heightCm: "tinggi" })[0].message).toBe("Harus berupa angka");
    expect(issues({ weightKg: Number.NaN })[0].message).toBe("Harus berupa angka");
  });

  it("is the same rule the PUT schema applies", () => {
    const r = raportUpsertSchema.safeParse({
      sectionLevels: {},
      sectionNarratives: {},
      permittedAbsenceDays: 0,
      sickDays: 0,
      unexcusedAbsenceDays: 0,
      totalSchoolDays: 4,
      heightCm: 300,
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Tinggi maksimal 250 cm");
  });
});
