import { describe, it, expect } from "vitest";
import {
  createAdmissionSchema,
  updateAdmissionSchema,
  admissionDobBounds,
  admissionDobError,
  todayInJakarta,
} from "./admission";

const VALID = {
  parentName: "Ibu Fatimah",
  parentPhone: "081234567890",
};

describe("createAdmissionSchema — lead = parent + one contact", () => {
  it("accepts only a parent name and one contact (child fields are optional)", () => {
    const result = createAdmissionSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.childName).toBeUndefined();
  });

  it.each([
    ["parentPhone", "081234567890"],
    ["parentWhatsapp", "081234567890"],
    ["parentEmail", "ibu@example.com"],
  ])("accepts %s as the only contact", (key, value) => {
    expect(createAdmissionSchema.safeParse({ parentName: "Ibu Fatimah", [key]: value }).success).toBe(true);
  });

  it("rejects a parent with no contact, with the Indonesian message on the first contact field", () => {
    const result = createAdmissionSchema.safeParse({ parentName: "Ibu Fatimah" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].message).toBe("Isi minimal satu kontak: No. HP, WhatsApp atau Email");
      expect(result.error.issues[0].path).toEqual(["parentPhone"]);
    }
  });

  it("treats blank contacts as missing", () => {
    const result = createAdmissionSchema.safeParse({
      parentName: "Ibu Fatimah",
      parentPhone: "  ",
      parentWhatsapp: "",
      parentEmail: "",
    });
    expect(result.success).toBe(false);
  });

  it("requires the parent name", () => {
    const result = createAdmissionSchema.safeParse({ parentName: "", parentPhone: "0812" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("Nama orang tua wajib diisi");
  });

  it("strips fields the lead no longer carries instead of failing old clients", () => {
    const result = createAdmissionSchema.safeParse({
      ...VALID,
      parentEducation: "S1",
      parentOccupation: "Guru",
      parentIncome: "5-10 juta",
      campusPreference: "campus-1",
      followUpDate: "2026-11-01",
      source: "REFERRAL",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      for (const key of ["parentEducation", "parentOccupation", "parentIncome", "campusPreference", "followUpDate", "source"]) {
        expect(result.data).not.toHaveProperty(key);
      }
    }
  });
});

describe("createAdmissionSchema — optionalEnum on childGender", () => {
  it("accepts an empty-string childGender (form default) and coerces to undefined", () => {
    const result = createAdmissionSchema.safeParse({ ...VALID, childGender: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.childGender).toBeUndefined();
  });

  it("accepts null childGender and coerces to undefined", () => {
    const result = createAdmissionSchema.safeParse({ ...VALID, childGender: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.childGender).toBeUndefined();
  });

  it("accepts a valid childGender enum value", () => {
    const result = createAdmissionSchema.safeParse({ ...VALID, childGender: "P" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.childGender).toBe("P");
  });

  it("rejects an unknown childGender value", () => {
    const result = createAdmissionSchema.safeParse({ ...VALID, childGender: "X" });
    expect(result.success).toBe(false);
  });
});

describe("createAdmissionSchema — optionalTrimmed on string fields", () => {
  it("coerces empty parentEmail to undefined (cycle 2026-05-11 regression)", () => {
    const result = createAdmissionSchema.safeParse({ ...VALID, parentEmail: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.parentEmail).toBeUndefined();
  });

  it("rejects malformed parentEmail", () => {
    const result = createAdmissionSchema.safeParse({ ...VALID, parentEmail: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("strips whitespace on optional strings", () => {
    const result = createAdmissionSchema.safeParse({
      ...VALID,
      parentPhone: "  081234567890  ",
      notes: "  hello  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.parentPhone).toBe("081234567890");
      expect(result.data.notes).toBe("hello");
    }
  });
});

describe("createAdmissionSchema — dateOfBirth", () => {
  it("accepts a real YYYY-MM-DD date, and blank (optional)", () => {
    expect(createAdmissionSchema.safeParse({ ...VALID, dateOfBirth: "2021-02-28" }).success).toBe(true);
    expect(createAdmissionSchema.safeParse({ ...VALID, dateOfBirth: "" }).success).toBe(true);
  });

  it("does not apply the public form's age range on the admin side", () => {
    expect(createAdmissionSchema.safeParse({ ...VALID, dateOfBirth: "2000-01-01" }).success).toBe(true);
  });

  it.each(["2020-02-31", "2021-02-29", "2020-13-01", "15/03/2020", "20200315", "bukan tanggal"])(
    "rejects %s",
    (dateOfBirth) => {
      const result = createAdmissionSchema.safeParse({ ...VALID, dateOfBirth });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].message).toBe("Tanggal lahir tidak valid");
    },
  );
});

describe("updateAdmissionSchema — partial + status enum", () => {
  it("accepts empty-string childGender on partial update", () => {
    const result = updateAdmissionSchema.safeParse({ childGender: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.childGender).toBeUndefined();
  });

  it("accepts a valid status transition target", () => {
    const result = updateAdmissionSchema.safeParse({ status: "VISIT_SCHEDULED" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("VISIT_SCHEDULED");
  });

  it("does not demand a contact on a partial body (the route checks the merged row)", () => {
    expect(updateAdmissionSchema.safeParse({ notes: "Telepon lagi besok" }).success).toBe(true);
    expect(updateAdmissionSchema.safeParse({ parentEmail: "" }).success).toBe(true);
  });

  it("still rejects a blank parent name", () => {
    expect(updateAdmissionSchema.safeParse({ parentName: "  " }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    const result = updateAdmissionSchema.safeParse({ status: "BOGUS" });
    expect(result.success).toBe(false);
  });

  it("accepts a fully blank payload (every field optional)", () => {
    const result = updateAdmissionSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("admission birth-date bounds (PUBX-2)", () => {
  const TODAY = "2026-10-07";

  it("computes inclusive min/max for ages 1–8", () => {
    expect(admissionDobBounds(TODAY)).toEqual({ min: "2017-10-08", max: "2025-10-07" });
  });

  it("clamps 29 Feb on non-leap years", () => {
    expect(admissionDobBounds("2028-02-29").max).toBe("2027-02-28");
  });

  it.each([
    ["2025-10-07", null], // turned 1 today
    ["2017-10-08", null], // turns 9 tomorrow
    ["2020-03-15", null],
  ])("accepts %s", (dob, expected) => {
    expect(admissionDobError(dob, TODAY)).toBe(expected);
  });

  it.each([
    ["2035-01-01", "Tanggal lahir tidak boleh di masa depan"],
    ["2026-10-08", "Tanggal lahir tidak boleh di masa depan"],
    ["2025-10-08", "Usia ananda minimal 1 tahun"],
    ["2017-10-07", "Usia ananda maksimal 8 tahun"],
    ["1900-01-01", "Usia ananda maksimal 8 tahun"],
    ["2020-02-31", "Tanggal lahir tidak valid"],
    ["15/03/2020", "Tanggal lahir tidak valid"],
  ])("rejects %s", (dob, message) => {
    expect(admissionDobError(dob, TODAY)).toBe(message);
  });

  it("todayInJakarta uses the Jakarta calendar day (UTC+7)", () => {
    expect(todayInJakarta(new Date("2026-10-06T18:30:00Z"))).toBe("2026-10-07");
    expect(todayInJakarta(new Date("2026-10-06T16:59:00Z"))).toBe("2026-10-06");
  });
});
