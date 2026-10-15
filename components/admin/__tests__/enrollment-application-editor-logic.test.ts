import { describe, it, expect } from "vitest";
import { ADDRESS_KEYS, buildPatchBody, editorSchemaFor, feeNoteLine, maskUnchanged, toEditorValues } from "../enrollment-application-editor-logic";

const source = {
  studentData: { childName: "Aisyah", weightKg: 14.5, address: { kodePos: "40123" }, priorFamilyAttendees: [{ name: "Rani", yearEntered: "2019" }] },
  ayahData: { name: "Budi", phone: "081234567890", legacyKey: "ignored" },
  ibuData: null,
  consentData: { onlyParent: "ayah", agreed: true },
  programId: "p-1",
  dcareAddon: false,
};

describe("toEditorValues", () => {
  it("turns stored blobs into input strings and fills the gaps", () => {
    const v = toEditorValues(source);
    expect(v.studentData.weightKg).toBe("14.5");
    expect(v.studentData.address.kodePos).toBe("40123");
    expect(v.studentData.address.perumahan).toBe("");
    expect(v.ibuData.name).toBe("");
    expect(v.consentData.onlyParent).toBe("ayah");
    expect(v.programId).toBe("p-1");
  });

  it("hydrates all eight address keys, in form order, from a full or an old blob", () => {
    expect([...ADDRESS_KEYS]).toEqual(["perumahan", "blokCluster", "rtRw", "kodePos", "kelurahan", "kecamatan", "kotaKab", "provinsi"]);
    const full = { perumahan: "P", blokCluster: "B", rtRw: "1/2", kodePos: "40115", kelurahan: "K", kecamatan: "C", kotaKab: "Kota", provinsi: "Jabar" };
    expect(toEditorValues({ ...source, ayahData: { address: full } }).ayahData.address).toEqual(full);
    const old = toEditorValues(source).studentData.address;
    expect(old).toEqual({ perumahan: "", blokCluster: "", rtRw: "", kodePos: "40123", kelurahan: "", kecamatan: "", kotaKab: "", provinsi: "" });
  });

  it("round-trips a changed region key into the patch", () => {
    const initial = toEditorValues(source);
    const next = structuredClone(initial);
    next.studentData.address.kelurahan = "Citarum";
    next.ibuData.address.provinsi = "Jawa Barat";
    expect(buildPatchBody(initial, next)).toEqual({
      studentData: { address: { kelurahan: "Citarum" } },
      ibuData: { address: { provinsi: "Jawa Barat" } },
    });
  });

  it("ignores an onlyParent value outside the allowed set", () => {
    expect(toEditorValues({ ...source, consentData: { onlyParent: "kakek" } }).consentData.onlyParent).toBe("");
  });
});

describe("buildPatchBody", () => {
  it("is empty when nothing changed", () => {
    const v = toEditorValues(source);
    expect(buildPatchBody(v, structuredClone(v))).toEqual({});
  });

  it("carries only changed keys; a blank is kept so the API can clear it", () => {
    const initial = toEditorValues(source);
    const next = structuredClone(initial);
    next.studentData.address.kodePos = "";
    next.ayahData.phone = "0856";
    next.consentData.onlyParent = "";
    next.dcareAddon = true;
    expect(buildPatchBody(initial, next)).toEqual({
      studentData: { address: { kodePos: "" } },
      ayahData: { phone: "0856" },
      consentData: { onlyParent: "" },
      dcareAddon: true,
    });
  });

  it("replaces the prior-family list as a whole and ignores blank rows", () => {
    const initial = toEditorValues(source);
    const next = structuredClone(initial);
    next.studentData.priorFamilyAttendees = [{ name: "", yearEntered: "" }];
    expect(buildPatchBody(initial, next)).toEqual({ studentData: { priorFamilyAttendees: [] } });
    next.studentData.priorFamilyAttendees = [...initial.studentData.priorFamilyAttendees, { name: " ", yearEntered: "" }];
    expect(buildPatchBody(initial, next)).toEqual({});
  });
});

describe("editorSchemaFor (derived from the server's staff schemas)", () => {
  const ok = () => toEditorValues({ studentData: {}, ayahData: {}, ibuData: {}, consentData: {}, programId: null, dcareAddon: false });
  const editorSchema = editorSchemaFor(ok());

  it("accepts a fully blank form: completeness is not staff's gate", () => {
    expect(editorSchema.safeParse(ok()).success).toBe(true);
  });

  it("rejects the same malformed values the API does", () => {
    const v = ok();
    v.ayahData.phone = "abc";
    v.ibuData.email = "nope";
    v.studentData.dateOfBirth = "15/03/2021";
    v.studentData.agama = "LAIN";
    const r = editorSchema.safeParse(v);
    expect(r.success).toBe(false);
    const paths = !r.success ? r.error.issues.map((i) => i.path.join(".")) : [];
    expect(paths).toEqual(expect.arrayContaining(["ayahData.phone", "ibuData.email", "studentData.dateOfBirth", "studentData.agama"]));
  });
});

describe("maskUnchanged", () => {
  it("validates only what changed: an untouched invalid stored value passes, an edited one does not", () => {
    const initial = toEditorValues({ ...source, studentData: { agama: "islam", address: { kodePos: "x".repeat(20) } }, ayahData: { phone: "08-ab" } });
    const schema = editorSchemaFor(initial);
    const untouched = structuredClone(initial);
    untouched.studentData.nickname = "Aisy";
    expect(schema.safeParse(untouched).success).toBe(true);
    const edited = structuredClone(untouched);
    edited.ayahData.phone = "abc";
    expect(schema.safeParse(edited).success).toBe(false);
  });

  it("keeps the changed values and the program / Day Care untouched", () => {
    const initial = toEditorValues(source);
    const next = structuredClone(initial);
    next.ayahData.phone = "0856";
    next.programId = "p-2";
    const masked = maskUnchanged(initial, next);
    expect(masked.ayahData.phone).toBe("0856");
    expect(masked.ayahData.name).toBe("");
    expect(masked.studentData.address.kodePos).toBe("");
    expect(masked.programId).toBe("p-2");
    // the input is not mutated
    expect(next.ayahData.name).toBe("Budi");
  });
});

describe("feeNoteLine", () => {
  const rp = (n: number) => `Rp ${n}`;
  it("names each outcome", () => {
    expect(feeNoteLine("repriced", 450, rp)).toBe("Biaya pendaftaran dihitung ulang: Rp 450");
    expect(feeNoteLine("repriced", null, rp)).toBe("Biaya pendaftaran dihitung ulang.");
    expect(feeNoteLine("unchanged_paid", 1, rp)).toBe("Biaya sudah lunas, tidak berubah.");
    expect(feeNoteLine("unchanged_waived", 1, rp)).toBe("Biaya sudah dibebaskan, tidak berubah.");
    expect(feeNoteLine("unchanged_inactive_program", 1, rp)).toBe("Program sudah tidak aktif, biaya tidak berubah.");
    expect(feeNoteLine("none", 1, rp)).toBeNull();
    expect(feeNoteLine(undefined, 1, rp)).toBeNull();
  });
});
