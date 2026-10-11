import { describe, it, expect } from "vitest";
import { submitAdmissionSchema, flattenSubmitErrors, CONTACT_REQUIRED_ERROR } from "./submit-validation";

const VALID = {
  parentName: "Ibu Fatimah",
  parentPhone: "081234567890",
};

function errorsFor(input: unknown) {
  const result = submitAdmissionSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? {} : flattenSubmitErrors(result.error);
}

describe("submitAdmissionSchema", () => {
  it("accepts a parent name and a phone only — every child field is optional", () => {
    const result = submitAdmissionSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.parentName).toBe("Ibu Fatimah");
      expect(result.data.parentPhone).toBe("081234567890");
      expect(result.data.childName).toBeUndefined();
      expect(result.data.dateOfBirth).toBeUndefined();
      expect(result.data.childGender).toBeUndefined();
    }
  });

  it.each([
    ["phone", { parentPhone: "081234567890" }],
    ["WhatsApp", { parentWhatsapp: "081234567890" }],
    ["email", { parentEmail: "fatimah@example.com" }],
  ])("accepts %s as the only contact", (_label, contact) => {
    expect(submitAdmissionSchema.safeParse({ parentName: "Ibu Fatimah", ...contact }).success).toBe(true);
  });

  it("rejects a payload without any contact and says so under `contact`", () => {
    const errs = errorsFor({ parentName: "Ibu Fatimah" });
    expect(errs).toEqual({ contact: CONTACT_REQUIRED_ERROR });
  });

  it("treats blank contact strings as no contact", () => {
    const errs = errorsFor({ parentName: "Ibu Fatimah", parentPhone: "  ", parentWhatsapp: "", parentEmail: "" });
    expect(errs.contact).toBe(CONTACT_REQUIRED_ERROR);
  });

  it("rejects missing or whitespace-only parentName", () => {
    expect(errorsFor({ ...VALID, parentName: "" }).parentName).toBe("Nama orang tua wajib diisi");
    expect(errorsFor({ ...VALID, parentName: "    " }).parentName).toBe("Nama orang tua wajib diisi");
  });

  it("rejects a parentName longer than 80 characters", () => {
    expect(errorsFor({ ...VALID, parentName: "a".repeat(81) }).parentName).toBe(
      "Nama orang tua terlalu panjang",
    );
  });

  it("rejects malformed parentPhone with the format example", () => {
    expect(errorsFor({ ...VALID, parentPhone: "not-a-phone-!!!" }).parentPhone).toBe(
      "Nomor telepon tidak valid. Contoh: 0812 3456 7890",
    );
  });

  it("does not add a contact error on top of a malformed phone", () => {
    const errs = errorsFor({ ...VALID, parentPhone: "abc" });
    expect(errs.contact).toBeUndefined();
  });

  it("rejects an email longer than 254 characters", () => {
    expect(errorsFor({ ...VALID, parentEmail: `${"a".repeat(250)}@example.com` }).parentEmail).toBe(
      "Email tidak valid",
    );
  });

  it("rejects a programId longer than 64 characters", () => {
    expect(errorsFor({ ...VALID, programId: "p".repeat(65) }).programId).toBe("Program tidak valid");
    expect(submitAdmissionSchema.safeParse({ ...VALID, programId: "p".repeat(64) }).success).toBe(true);
  });

  it("rejects invalid parentEmail when present", () => {
    expect(errorsFor({ ...VALID, parentEmail: "not-an-email" }).parentEmail).toBe("Email tidak valid");
  });

  it("treats empty-string optional fields as omitted (form sends '' for unfilled)", () => {
    const result = submitAdmissionSchema.safeParse({
      ...VALID,
      parentEmail: "",
      parentWhatsapp: "",
      parentRelationship: "",
      childName: "",
      dateOfBirth: "",
      childGender: "",
      programId: "",
      notes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      for (const key of [
        "parentEmail",
        "parentWhatsapp",
        "parentRelationship",
        "childName",
        "dateOfBirth",
        "childGender",
        "programId",
        "notes",
      ] as const) {
        expect(result.data[key]).toBeUndefined();
      }
    }
  });

  it("accepts Ayah, Ibu and Wali as relationship and rejects anything else", () => {
    for (const rel of ["AYAH", "IBU", "WALI"]) {
      expect(submitAdmissionSchema.safeParse({ ...VALID, parentRelationship: rel }).success).toBe(true);
    }
    expect(errorsFor({ ...VALID, parentRelationship: "PAMAN" }).parentRelationship).toBe(
      "Pilih Ayah, Ibu, atau Wali",
    );
  });

  describe("date of birth is checked only when given", () => {
    it("accepts a plausible date", () => {
      expect(submitAdmissionSchema.safeParse({ ...VALID, dateOfBirth: "2021-03-15" }).success).toBe(true);
    });

    it("rejects a malformed date", () => {
      expect(errorsFor({ ...VALID, dateOfBirth: "15/03/2020" }).dateOfBirth).toMatch(/format/i);
    });

    it.each([
      ["2035-01-01", /masa depan/],
      ["1900-01-01", /maksimal 8 tahun/],
    ])("rejects the implausible age %s", (dob, message) => {
      expect(errorsFor({ ...VALID, dateOfBirth: dob }).dateOfBirth).toMatch(message);
    });
  });

  it("accepts L and P and rejects any other childGender", () => {
    expect(submitAdmissionSchema.safeParse({ ...VALID, childGender: "L" }).success).toBe(true);
    expect(errorsFor({ ...VALID, childGender: "X" }).childGender).toBe("Pilih jenis kelamin");
  });

  it("rejects a childName longer than 80 characters", () => {
    expect(errorsFor({ ...VALID, childName: "a".repeat(81) }).childName).toBe("Nama anak terlalu panjang");
  });

  it("rejects notes longer than 500 chars", () => {
    expect(errorsFor({ ...VALID, notes: "a".repeat(501) }).notes).toMatch(/terlalu panjang/i);
  });

  it("trims whitespace on string fields", () => {
    const result = submitAdmissionSchema.safeParse({
      parentName: "  Ibu Fatimah  ",
      parentPhone: "  081234567890  ",
      childName: "  Aisyah Putri  ",
      notes: "  Anak mandiri.  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.parentName).toBe("Ibu Fatimah");
      expect(result.data.parentPhone).toBe("081234567890");
      expect(result.data.childName).toBe("Aisyah Putri");
      expect(result.data.notes).toBe("Anak mandiri.");
    }
  });

  it("silently strips admin-only fields injected by attacker", () => {
    const result = submitAdmissionSchema.safeParse({
      ...VALID,
      source: "REFERRAL",
      status: "ADMITTED",
      studentId: "evil",
      tenantId: "other-tenant",
      parentEducation: "S3",
      parentIncome: "> Rp 10 Juta",
      followUpDate: "2026-12-01",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as Record<string, unknown>;
      for (const key of ["source", "status", "studentId", "tenantId", "parentEducation", "parentIncome", "followUpDate"]) {
        expect(data[key]).toBeUndefined();
      }
    }
  });

  it("accepts a prefixed (non-cuid) programId — prod Program ids aren't all cuid()-shaped", () => {
    const result = submitAdmissionSchema.safeParse({ ...VALID, programId: "program_ab57fd0432e25d5b3013" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.programId).toBe("program_ab57fd0432e25d5b3013");
  });

  it("accepts a fully-populated valid payload", () => {
    expect(
      submitAdmissionSchema.safeParse({
        ...VALID,
        parentRelationship: "IBU",
        parentWhatsapp: "+62 812-3456-7890",
        parentEmail: "fatimah@example.com",
        childName: "Aisyah Putri",
        dateOfBirth: "2021-03-15",
        childGender: "P",
        programId: "ckabcdefghijklmnopqrstuvw",
        notes: "Anak sudah pernah ikut kelas trial.",
      }).success,
    ).toBe(true);
  });
});

describe("flattenSubmitErrors", () => {
  it("answers an empty body in Indonesian, never Zod's English default (R2-P-13)", () => {
    const errs = errorsFor({});
    expect(errs.parentName).toBe("Nama orang tua wajib diisi");
    for (const msg of Object.values(errs)) expect(msg).not.toMatch(/invalid input|expected/i);
  });

  it("returns one message per field, first error wins", () => {
    const errs = errorsFor({ parentName: "", parentPhone: "x", dateOfBirth: "bad-date", childGender: "X" });
    expect(errs.parentName).toBe("Nama orang tua wajib diisi");
    expect(errs.parentPhone).toBe("Nomor telepon tidak valid. Contoh: 0812 3456 7890");
    expect(errs.dateOfBirth).toMatch(/format/i);
    expect(errs.childGender).toBe("Pilih jenis kelamin");
  });

  it("includes a format example in the phone and WhatsApp errors (R2-P-13)", () => {
    const errs = errorsFor({ ...VALID, parentPhone: "abc", parentWhatsapp: "abc" });
    expect(errs.parentPhone).toContain("Contoh: 0812 3456 7890");
    expect(errs.parentWhatsapp).toContain("Contoh: 0812 3456 7890");
  });
});
