import { describe, it, expect } from "vitest";
import {
  assessmentEntryCreateSchema,
  assessmentEntryBulkCreateSchema,
  assessmentEntryUpdateSchema,
  assessmentEntryCenterSessionSchema,
  assessmentEntryVoidSchema,
  MAX_BULK_ENTRIES,
  MAX_CENTER_SESSION_ENTRIES,
} from "@/lib/validations/assessment-entry";

const validHomeroom = {
  studentId: "stu1",
  indicatorId: "ind1",
  date: "2026-05-14",
  source: "HOMEROOM" as const,
  level: "CONSISTENT" as const,
};

const validCenter = {
  studentId: "stu1",
  indicatorId: "ind1",
  date: "2026-05-14",
  source: "CENTER" as const,
  center: "WORSHIP" as const,
  activity: "Doa pagi",
  level: "EMERGING" as const,
};

describe("assessmentEntryCreateSchema", () => {
  it("accepts a valid HOMEROOM entry", () => {
    const r = assessmentEntryCreateSchema.safeParse(validHomeroom);
    expect(r.success).toBe(true);
  });

  it("accepts a valid CENTER entry", () => {
    const r = assessmentEntryCreateSchema.safeParse(validCenter);
    expect(r.success).toBe(true);
  });

  it("rejects HOMEROOM entry that includes a center", () => {
    const r = assessmentEntryCreateSchema.safeParse({
      ...validHomeroom,
      center: "WORSHIP",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("center"))).toBe(true);
    }
  });

  it("rejects CENTER entry without a center", () => {
    const { center: _ignored, ...without } = validCenter;
    const r = assessmentEntryCreateSchema.safeParse(without);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("center"))).toBe(true);
    }
  });

  it("rejects malformed date", () => {
    const r = assessmentEntryCreateSchema.safeParse({
      ...validHomeroom,
      date: "14-05-2026",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown level", () => {
    const r = assessmentEntryCreateSchema.safeParse({
      ...validHomeroom,
      level: "BSH",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown center value", () => {
    const r = assessmentEntryCreateSchema.safeParse({
      ...validCenter,
      center: "FOO",
    });
    expect(r.success).toBe(false);
  });

  it("rejects activity over 200 chars", () => {
    const r = assessmentEntryCreateSchema.safeParse({
      ...validCenter,
      activity: "x".repeat(201),
    });
    expect(r.success).toBe(false);
  });

  it("rejects note over 500 chars", () => {
    const r = assessmentEntryCreateSchema.safeParse({
      ...validHomeroom,
      note: "x".repeat(501),
    });
    expect(r.success).toBe(false);
  });
});

describe("assessmentEntryBulkCreateSchema", () => {
  it("accepts a 1-entry bulk", () => {
    const r = assessmentEntryBulkCreateSchema.safeParse({
      entries: [validHomeroom],
    });
    expect(r.success).toBe(true);
  });

  it("accepts a max-size bulk", () => {
    const entries = Array.from({ length: MAX_BULK_ENTRIES }, (_, i) => ({
      ...validHomeroom,
      studentId: `stu${i}`,
    }));
    const r = assessmentEntryBulkCreateSchema.safeParse({ entries });
    expect(r.success).toBe(true);
  });

  it("rejects an empty bulk", () => {
    const r = assessmentEntryBulkCreateSchema.safeParse({ entries: [] });
    expect(r.success).toBe(false);
  });

  it("rejects a bulk over the cap", () => {
    const entries = Array.from({ length: MAX_BULK_ENTRIES + 1 }, (_, i) => ({
      ...validHomeroom,
      studentId: `stu${i}`,
    }));
    const r = assessmentEntryBulkCreateSchema.safeParse({ entries });
    expect(r.success).toBe(false);
  });

  it("rejects when any entry violates the source/center rule", () => {
    const r = assessmentEntryBulkCreateSchema.safeParse({
      entries: [validHomeroom, { ...validHomeroom, center: "WORSHIP" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("assessmentEntryUpdateSchema", () => {
  it("accepts level-only patch", () => {
    const r = assessmentEntryUpdateSchema.safeParse({ level: "CONSISTENT" });
    expect(r.success).toBe(true);
  });

  it("accepts note clearing via null", () => {
    const r = assessmentEntryUpdateSchema.safeParse({ note: null });
    expect(r.success).toBe(true);
  });

  it("accepts empty patch (no-op)", () => {
    const r = assessmentEntryUpdateSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("rejects unknown level on patch", () => {
    const r = assessmentEntryUpdateSchema.safeParse({ level: "BSH" });
    expect(r.success).toBe(false);
  });
});

describe("assessmentEntryCenterSessionSchema", () => {
  const baseSession = {
    sentraId: "sentra_1",
    date: "2026-05-14",
    activity: "Doa pagi + asmaul husna",
    entries: [
      {
        studentId: "stu1",
        indicatorId: "ind1",
        level: "CONSISTENT" as const,
      },
    ],
  };

  it("accepts a valid session", () => {
    const r = assessmentEntryCenterSessionSchema.safeParse(baseSession);
    expect(r.success).toBe(true);
  });

  it("accepts a session with empty entries (no-op save)", () => {
    const r = assessmentEntryCenterSessionSchema.safeParse({
      ...baseSession,
      entries: [],
    });
    expect(r.success).toBe(true);
  });

  it("rejects when sentraId is missing", () => {
    const { sentraId: _ignored, ...without } = baseSession;
    const r = assessmentEntryCenterSessionSchema.safeParse(without);
    expect(r.success).toBe(false);
  });

  it("rejects when activity is empty AND entries are present", () => {
    const r = assessmentEntryCenterSessionSchema.safeParse({
      ...baseSession,
      activity: "",
    });
    expect(r.success).toBe(false);
  });

  it("accepts empty activity when entries are also empty (no-op session)", () => {
    const r = assessmentEntryCenterSessionSchema.safeParse({
      ...baseSession,
      activity: "",
      entries: [],
    });
    expect(r.success).toBe(true);
  });

  it("rejects when activity is over 200 chars", () => {
    const r = assessmentEntryCenterSessionSchema.safeParse({
      ...baseSession,
      activity: "x".repeat(201),
    });
    expect(r.success).toBe(false);
  });

  it("rejects when entries exceed the cap", () => {
    const r = assessmentEntryCenterSessionSchema.safeParse({
      ...baseSession,
      entries: Array.from(
        { length: MAX_CENTER_SESSION_ENTRIES + 1 },
        (_, i) => ({
          studentId: `stu${i}`,
          indicatorId: "ind1",
          level: "CONSISTENT",
        }),
      ),
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty sentraId", () => {
    const r = assessmentEntryCenterSessionSchema.safeParse({
      ...baseSession,
      sentraId: "",
    });
    expect(r.success).toBe(false);
  });
});

describe("assessmentEntryVoidSchema (C7a/T2)", () => {
  it("accepts a trimmed reason between 3 and 500 chars", () => {
    const r = assessmentEntryVoidSchema.safeParse({
      voidReason: "Salah skala — koreksi setelah ulang amatan",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.voidReason).toBe(
        "Salah skala — koreksi setelah ulang amatan",
      );
    }
  });

  it("trims surrounding whitespace before length check", () => {
    const r = assessmentEntryVoidSchema.safeParse({
      voidReason: "   koreksi data   ",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.voidReason).toBe("koreksi data");
  });

  it("rejects empty string", () => {
    const r = assessmentEntryVoidSchema.safeParse({ voidReason: "" });
    expect(r.success).toBe(false);
  });

  it("rejects whitespace-only reason (trims to less than 3 chars)", () => {
    const r = assessmentEntryVoidSchema.safeParse({ voidReason: "  a  " });
    expect(r.success).toBe(false);
  });

  it("rejects a string of only whitespace (canonical bypass attempt)", () => {
    const r = assessmentEntryVoidSchema.safeParse({ voidReason: "     " });
    expect(r.success).toBe(false);
  });

  it("rejects reasons longer than 500 chars after trim", () => {
    const r = assessmentEntryVoidSchema.safeParse({
      voidReason: "x".repeat(501),
    });
    expect(r.success).toBe(false);
  });

  it("rejects missing voidReason key", () => {
    const r = assessmentEntryVoidSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});
