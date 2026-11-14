import { describe, expect, it } from "vitest";
import { studentHealthMetadataSchema } from "../student-health";
import { updateStudentSchema } from "../student";
describe("student health validation", () => {
  it.each([{ weightKg: -1 }, { heightCm: 9999 }, { siblingsKandung: 1.5 }, { weightKg: "abc" }, { headCircumferenceCm: 101 }])("rejects invalid measurements %j on server", (metadata) => {
    expect(studentHealthMetadataSchema.safeParse(metadata).success).toBe(false);
    expect(updateStudentSchema.safeParse({ metadata }).success).toBe(false);
  });
  it("permits valid measurements and unrelated custom metadata", () => {
    expect(studentHealthMetadataSchema.safeParse({ weightKg: "20.5", heightCm: 110, siblingsKandung: 2, foodAllergy: "telur", custom: "catatan" }).success).toBe(true);
  });
});
