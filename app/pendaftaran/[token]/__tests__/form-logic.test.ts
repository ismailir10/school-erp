import { describe, it, expect } from "vitest";
import {
  contactError,
  parentContactIssues,
  resumeStep,
  describeServerIssue,
  stepLabel,
  type ResumeInput,
} from "../form-logic";
import { parentSchema } from "@/lib/enrollment/submit-validation";

const parent = { name: "Budi", phone: "", email: "", employerPhone: "" };

const complete: ResumeInput = {
  student: { childName: "Aisyah", childGender: "P", birthPlace: "Bogor", dateOfBirth: "2021-01-01", agama: "ISLAM", kewarganegaraan: "WNI" },
  ayah: { ...parent },
  ibu: { ...parent, name: "Siti" },
  programId: "p-1",
  documents: {},
  requiredDocuments: [],
  consent: { agreed: true, ayahName: "Budi", ibuName: "Siti", ayahSigned: true, ibuSigned: true },
};

describe("contactError", () => {
  it("accepts empty (optional) and well-formed values", () => {
    expect(contactError("phone", "")).toBeNull();
    expect(contactError("phone", "0812-3456-7890")).toBeNull();
    expect(contactError("phone", "+62 812 3456 7890")).toBeNull();
    expect(contactError("email", "")).toBeNull();
    expect(contactError("email", "ayah@contoh.id")).toBeNull();
  });

  it("rejects what the server's submit schema rejects", () => {
    for (const v of ["abc", "12", "08x12"]) {
      expect(contactError("phone", v)).toMatch(/Nomor HP/);
      expect(parentSchema.shape.phone.safeParse(v).success).toBe(false);
    }
    expect(contactError("email", "bukan-email")).toMatch(/email/i);
    expect(contactError("employerPhone", "kantor")).toMatch(/kantor/);
  });
});

describe("parentContactIssues", () => {
  it("returns the failing fields in on-screen order, keyed by side", () => {
    const issues = parentContactIssues("ayah", { phone: "abc", email: "bukan-email", employerPhone: "021 8877 402" });
    expect(issues.map((i) => i.key)).toEqual(["ayah.phone", "ayah.email"]);
  });
  it("is empty when everything is valid", () => {
    expect(parentContactIssues("ibu", { phone: "", email: "a@b.co", employerPhone: "" })).toEqual([]);
  });
});

describe("resumeStep", () => {
  it("opens an empty draft on Data Anak", () => {
    const empty: ResumeInput = {
      ...complete,
      student: { childName: "", childGender: "", birthPlace: "", dateOfBirth: "", agama: "", kewarganegaraan: "" },
      ayah: { ...parent, name: "" },
      ibu: { ...parent, name: "" },
      programId: "",
      consent: { agreed: false, ayahName: "", ibuName: "", ayahSigned: false, ibuSigned: false },
    };
    expect(resumeStep(empty)).toBe(0);
  });

  it("stops at the first step with missing required data", () => {
    expect(resumeStep({ ...complete, ayah: { ...parent, name: "" } })).toBe(1);
    expect(resumeStep({ ...complete, ibu: { ...parent, name: " " } })).toBe(2);
    expect(resumeStep({ ...complete, programId: "" })).toBe(3);
    expect(resumeStep({ ...complete, student: { ...complete.student, dateOfBirth: "" } })).toBe(0);
  });

  it("returns to a parent step whose saved phone or email the server would reject", () => {
    expect(resumeStep({ ...complete, ayah: { ...parent, phone: "abc" } })).toBe(1);
    expect(resumeStep({ ...complete, ibu: { ...parent, name: "Siti", email: "x" } })).toBe(2);
  });

  it("stops at Berkas only while a school-required document is missing", () => {
    expect(resumeStep({ ...complete, requiredDocuments: ["kk"] })).toBe(4);
    const file = { fileName: "kk.pdf", mimeType: "application/pdf", size: 3, uploadedAt: "2026-10-06T00:00:00.000Z" };
    expect(resumeStep({ ...complete, requiredDocuments: ["kk"], documents: { kk: file } })).toBe(6);
  });

  it("stops at Persetujuan until consent and both signatures exist, then opens Tinjau", () => {
    expect(resumeStep({ ...complete, consent: { ...complete.consent, ibuSigned: false } })).toBe(5);
    expect(resumeStep({ ...complete, consent: { ...complete.consent, agreed: false } })).toBe(5);
    expect(resumeStep(complete)).toBe(6);
  });

  // R2-P-10: a single parent / wali family resumes without the waived side.
  describe("single parent / wali (onlyParent)", () => {
    const onlyIbu: ResumeInput = {
      ...complete,
      ayah: { ...parent, name: "" },
      consent: { agreed: true, ayahName: "", ibuName: "Siti", ayahSigned: false, ibuSigned: true, onlyParent: "ibu" },
    };

    it("skips the waived parent's name and the waived signature, opening Tinjau", () => {
      expect(resumeStep(onlyIbu)).toBe(6);
      const onlyAyah: ResumeInput = {
        ...complete,
        ibu: { ...parent, name: "" },
        consent: { agreed: true, ayahName: "Budi", ibuName: "", ayahSigned: true, ibuSigned: false, onlyParent: "ayah" },
      };
      expect(resumeStep(onlyAyah)).toBe(6);
    });

    it("still requires the filling parent's name, name on the letter and signature", () => {
      expect(resumeStep({ ...onlyIbu, ibu: { ...parent, name: "" } })).toBe(2);
      expect(resumeStep({ ...onlyIbu, consent: { ...onlyIbu.consent, ibuSigned: false } })).toBe(5);
      expect(resumeStep({ ...onlyIbu, consent: { ...onlyIbu.consent, ibuName: " " } })).toBe(5);
    });

    it("ignores a bad contact on the waived side", () => {
      expect(resumeStep({ ...onlyIbu, ayah: { ...parent, name: "", phone: "abc" } })).toBe(6);
    });

    it("without the flag, a missing second parent still sends the parent back", () => {
      expect(resumeStep({ ...onlyIbu, consent: { ...onlyIbu.consent, onlyParent: "" } })).toBe(1);
    });
  });
});

describe("describeServerIssue", () => {
  it("names the step and parent for a contact path and points at the input", () => {
    expect(describeServerIssue("ayahData.phone", "Nomor telepon tidak valid")).toEqual({
      step: 1,
      text: "Langkah 2 · Data Ayah — Nomor telepon tidak valid",
      field: "ayah.phone",
    });
    expect(describeServerIssue("ibuData.email", "Email tidak valid")).toMatchObject({ step: 2, field: "ibu.email" });
  });

  it("maps the other roots to their steps without a field", () => {
    expect(describeServerIssue("studentData.weightKg", "Berat badan tidak valid")).toEqual({
      step: 0,
      text: "Langkah 1 · Data Anak — Berat badan tidak valid",
    });
    expect(describeServerIssue("programId", "Program tidak valid")).toMatchObject({ step: 3 });
    expect(describeServerIssue("consentData.ayah.signatureToken", "x")).toMatchObject({ step: 5 });
  });

  it("leaves unmapped paths as plain text", () => {
    expect(describeServerIssue("_root", "Body bukan JSON")).toEqual({ step: null, text: "Body bukan JSON" });
  });

  it("stepLabel is 1-based", () => {
    expect(stepLabel(1)).toBe("Langkah 2 · Data Ayah");
  });
});
