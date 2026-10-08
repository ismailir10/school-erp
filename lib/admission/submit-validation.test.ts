import { describe, it, expect } from "vitest";
import { submitAdmissionSchema, flattenSubmitErrors } from "./submit-validation";

const VALID = {
  childName: "Aisyah Putri",
  dateOfBirth: "2020-03-15",
  childGender: "P" as const,
  parentName: "Ibu Fatimah",
  parentPhone: "081234567890",
};

describe("submitAdmissionSchema", () => {
  it("accepts a valid minimal payload", () => {
    const result = submitAdmissionSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.childName).toBe("Aisyah Putri");
      expect(result.data.parentPhone).toBe("081234567890");
    }
  });

  it("rejects missing childName", () => {
    const result = submitAdmissionSchema.safeParse({ ...VALID, childName: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = flattenSubmitErrors(result.error);
      expect(errs.childName).toBe("Nama anak wajib diisi");
    }
  });

  it("rejects whitespace-only childName after trim", () => {
    const result = submitAdmissionSchema.safeParse({ ...VALID, childName: "    " });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = flattenSubmitErrors(result.error);
      expect(errs.childName).toBe("Nama anak wajib diisi");
    }
  });

  it("rejects missing dateOfBirth", () => {
    const result = submitAdmissionSchema.safeParse({ ...VALID, dateOfBirth: undefined });
    expect(result.success).toBe(false);
  });

  it("rejects malformed dateOfBirth", () => {
    const result = submitAdmissionSchema.safeParse({ ...VALID, dateOfBirth: "15/03/2020" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = flattenSubmitErrors(result.error);
      expect(errs.dateOfBirth).toMatch(/format/i);
    }
  });

  it("rejects invalid childGender (only L or P allowed)", () => {
    const result = submitAdmissionSchema.safeParse({ ...VALID, childGender: "X" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = flattenSubmitErrors(result.error);
      expect(errs.childGender).toBe("Pilih jenis kelamin");
    }
  });

  it("rejects malformed parentPhone", () => {
    const result = submitAdmissionSchema.safeParse({ ...VALID, parentPhone: "not-a-phone-!!!" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = flattenSubmitErrors(result.error);
      expect(errs.parentPhone).toBe("Nomor telepon tidak valid. Contoh: 0812 3456 7890");
    }
  });

  it("rejects invalid parentEmail when present", () => {
    const result = submitAdmissionSchema.safeParse({ ...VALID, parentEmail: "not-an-email" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = flattenSubmitErrors(result.error);
      expect(errs.parentEmail).toBe("Email tidak valid");
    }
  });

  it("treats empty-string parentEmail as omitted (form sends '' for unfilled optional)", () => {
    const result = submitAdmissionSchema.safeParse({ ...VALID, parentEmail: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.parentEmail).toBeUndefined();
    }
  });

  it("treats empty-string parentWhatsapp as omitted", () => {
    const result = submitAdmissionSchema.safeParse({ ...VALID, parentWhatsapp: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.parentWhatsapp).toBeUndefined();
    }
  });

  it("treats empty-string programId / notes as omitted", () => {
    const result = submitAdmissionSchema.safeParse({ ...VALID, programId: "", notes: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.programId).toBeUndefined();
      expect(result.data.notes).toBeUndefined();
    }
  });

  it("rejects notes longer than 500 chars", () => {
    const longNotes = "a".repeat(501);
    const result = submitAdmissionSchema.safeParse({ ...VALID, notes: longNotes });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = flattenSubmitErrors(result.error);
      expect(errs.notes).toMatch(/terlalu panjang/i);
    }
  });

  it("trims whitespace on string fields", () => {
    const result = submitAdmissionSchema.safeParse({
      ...VALID,
      childName: "  Aisyah Putri  ",
      parentName: "  Ibu Fatimah  ",
      parentPhone: "  081234567890  ",
      notes: "  Anak mandiri.  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.childName).toBe("Aisyah Putri");
      expect(result.data.parentName).toBe("Ibu Fatimah");
      expect(result.data.parentPhone).toBe("081234567890");
      expect(result.data.notes).toBe("Anak mandiri.");
    }
  });

  it("silently strips admin-only fields injected by attacker", () => {
    const attacker = {
      ...VALID,
      source: "REFERRAL",
      status: "ADMITTED",
      studentId: "evil",
      tenantId: "other-tenant",
      parentEducation: "S3",
      parentIncome: "> Rp 10 Juta",
      followUpDate: "2026-12-01",
    };
    const result = submitAdmissionSchema.safeParse(attacker);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as Record<string, unknown>;
      expect(data.source).toBeUndefined();
      expect(data.status).toBeUndefined();
      expect(data.studentId).toBeUndefined();
      expect(data.tenantId).toBeUndefined();
      expect(data.parentEducation).toBeUndefined();
      expect(data.parentIncome).toBeUndefined();
      expect(data.followUpDate).toBeUndefined();
    }
  });

  it("accepts a prefixed (non-cuid) programId — prod Program ids aren't all cuid()-shaped", () => {
    const result = submitAdmissionSchema.safeParse({
      ...VALID,
      programId: "program_ab57fd0432e25d5b3013",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.programId).toBe("program_ab57fd0432e25d5b3013");
    }
  });

  it("accepts a fully-populated valid payload", () => {
    const result = submitAdmissionSchema.safeParse({
      ...VALID,
      parentWhatsapp: "+62 812-3456-7890",
      parentEmail: "fatimah@example.com",
      programId: "ckabcdefghijklmnopqrstuvw",
      notes: "Anak sudah pernah ikut kelas trial.",
    });
    expect(result.success).toBe(true);
  });
});

describe("flattenSubmitErrors", () => {
  it("returns one message per field, first error wins", () => {
    const result = submitAdmissionSchema.safeParse({
      childName: "",
      dateOfBirth: "bad-date",
      childGender: "X",
      parentName: "",
      parentPhone: "x",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = flattenSubmitErrors(result.error);
      expect(errs.childName).toBe("Nama anak wajib diisi");
      expect(errs.dateOfBirth).toMatch(/format/i);
      expect(errs.childGender).toBe("Pilih jenis kelamin");
      expect(errs.parentName).toBe("Nama orang tua wajib diisi");
      expect(errs.parentPhone).toBe("Nomor telepon tidak valid. Contoh: 0812 3456 7890");
    }
  });

  it("answers an empty body in Indonesian, never Zod's English default (R2-P-13)", () => {
    const result = submitAdmissionSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = flattenSubmitErrors(result.error);
      expect(errs).toEqual({
        childName: "Nama anak wajib diisi",
        dateOfBirth: "Tanggal lahir wajib diisi (format YYYY-MM-DD)",
        childGender: "Pilih jenis kelamin",
        parentName: "Nama orang tua wajib diisi",
        parentPhone: "Nomor telepon wajib diisi",
      });
      for (const msg of Object.values(errs)) expect(msg).not.toMatch(/invalid input|expected/i);
    }
  });

  it("includes a format example in the phone and WhatsApp errors (R2-P-13)", () => {
    const result = submitAdmissionSchema.safeParse({ ...VALID, parentPhone: "abc", parentWhatsapp: "abc" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = flattenSubmitErrors(result.error);
      expect(errs.parentPhone).toContain("Contoh: 0812 3456 7890");
      expect(errs.parentWhatsapp).toContain("Contoh: 0812 3456 7890");
    }
  });
});
