import { describe, it, expect } from "vitest";
import { leaveReviewFormSchema, rejectLeaveRequestSchema } from "@/lib/validations/leave";

describe("rejectLeaveRequestSchema", () => {
  it("accepts a non-empty reason, trimmed", () => {
    const r = rejectLeaveRequestSchema.safeParse({ note: "  Tidak memenuhi syarat  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.note).toBe("Tidak memenuhi syarat");
  });

  it("rejects a reason shorter than 5 characters after trimming", () => {
    const r = rejectLeaveRequestSchema.safeParse({ note: "  ok  " });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Alasan penolakan minimal 5 karakter");
    expect(rejectLeaveRequestSchema.safeParse({ note: "Penuh" }).success).toBe(true);
  });

  it("rejects a missing or blank reason", () => {
    expect(rejectLeaveRequestSchema.safeParse({}).success).toBe(false);
    expect(rejectLeaveRequestSchema.safeParse({ note: "   " }).success).toBe(false);
  });
});

describe("leaveReviewFormSchema", () => {
  it("requires note only when action is reject", () => {
    expect(leaveReviewFormSchema.safeParse({ action: "approve", note: "" }).success).toBe(true);
    expect(leaveReviewFormSchema.safeParse({ action: "approve" }).success).toBe(true);
    expect(leaveReviewFormSchema.safeParse({ action: "reject", note: "Alasan jelas" }).success).toBe(true);
  });

  it("rejects a blank reason when action is reject, with the message on note", () => {
    const r = leaveReviewFormSchema.safeParse({ action: "reject", note: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join(".") === "note" && i.message === "Alasan penolakan wajib diisi")).toBe(true);
    }
  });

  it("rejects a too-short reason on reject with the min-length message on note, but not on approve", () => {
    const r = leaveReviewFormSchema.safeParse({ action: "reject", note: " abc " });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join(".") === "note" && i.message === "Alasan penolakan minimal 5 karakter")).toBe(true);
    }
    expect(leaveReviewFormSchema.safeParse({ action: "approve", note: "ok" }).success).toBe(true);
  });

  it("rejects an unknown action value", () => {
    expect(leaveReviewFormSchema.safeParse({ action: "delete", note: "x" }).success).toBe(false);
  });
});
