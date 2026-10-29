import { describe, it, expect } from "vitest";
import { cancelEnrollmentLeaveSchema, createEnrollmentLeaveSchema } from "../enrollment-leave";

const valid = { enrollmentId: "enr-1", startMonth: "2026-12", endMonth: "2027-01", reason: "Pulang kampung" };

function messages(input: unknown): Record<string, string> {
  const r = createEnrollmentLeaveSchema.safeParse(input);
  if (r.success) return {};
  return Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
}

describe("createEnrollmentLeaveSchema", () => {
  it("accepts a valid body, including a one-month leave", () => {
    expect(createEnrollmentLeaveSchema.safeParse(valid).success).toBe(true);
    expect(createEnrollmentLeaveSchema.safeParse({ ...valid, endMonth: "2026-12" }).success).toBe(true);
  });

  it("trims the reason", () => {
    const r = createEnrollmentLeaveSchema.parse({ ...valid, reason: "  Pulang kampung  " });
    expect(r.reason).toBe("Pulang kampung");
  });

  it("never lets a studentId or tenantId through", () => {
    const r = createEnrollmentLeaveSchema.parse({ ...valid, studentId: "stu-evil", tenantId: "tnt-evil" });
    expect(r).not.toHaveProperty("studentId");
    expect(r).not.toHaveProperty("tenantId");
  });

  it("requires an enrollment", () => {
    expect(messages({ ...valid, enrollmentId: "  " })).toHaveProperty("enrollmentId", "Pendaftaran kelas wajib dipilih");
    expect(messages({ ...valid, enrollmentId: undefined })).toHaveProperty("enrollmentId");
  });

  it.each(["2026-13", "2026-00", "2026-1", "Desember 2026", "2026-12-01", ""])(
    "rejects a malformed month %j",
    (bad) => {
      expect(messages({ ...valid, startMonth: bad })).toHaveProperty("startMonth");
      expect(messages({ ...valid, endMonth: bad })).toHaveProperty("endMonth");
    },
  );

  it("rejects an end before the start, on the end field", () => {
    expect(messages({ ...valid, startMonth: "2027-02", endMonth: "2027-01" })).toEqual({
      endMonth: "Bulan akhir tidak boleh sebelum bulan mulai",
    });
  });

  it("does not stack the order error on a malformed month", () => {
    const m = messages({ ...valid, startMonth: "2027-02", endMonth: "nope" });
    expect(Object.keys(m)).toEqual(["endMonth"]);
    expect(m.endMonth).not.toMatch(/sebelum/);
  });

  it("requires a reason of 3 to 200 characters after trimming", () => {
    expect(messages({ ...valid, reason: "" })).toHaveProperty("reason");
    expect(messages({ ...valid, reason: "  ab  " })).toHaveProperty("reason", "Alasan minimal 3 karakter");
    expect(messages({ ...valid, reason: undefined })).toHaveProperty("reason");
    expect(createEnrollmentLeaveSchema.safeParse({ ...valid, reason: "abc" }).success).toBe(true);
    expect(createEnrollmentLeaveSchema.safeParse({ ...valid, reason: "a".repeat(200) }).success).toBe(true);
    expect(messages({ ...valid, reason: "a".repeat(201) })).toHaveProperty("reason", "Alasan maksimal 200 karakter");
  });
});

describe("cancelEnrollmentLeaveSchema", () => {
  it("accepts only status INACTIVE", () => {
    expect(cancelEnrollmentLeaveSchema.safeParse({ status: "INACTIVE" }).success).toBe(true);
    expect(cancelEnrollmentLeaveSchema.safeParse({ status: "ACTIVE" }).success).toBe(false);
    expect(cancelEnrollmentLeaveSchema.safeParse({}).success).toBe(false);
    expect(cancelEnrollmentLeaveSchema.safeParse({ status: "inactive" }).success).toBe(false);
  });
});
