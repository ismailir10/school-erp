import { describe, it, expect } from "vitest";
import { namesCompatible, studentFields, validateConvertInput } from "./convert-input";

const src = (o: Partial<Parameters<typeof validateConvertInput>[0]> = {}) => ({
  childName: "Aisyah",
  studentData: { dateOfBirth: "2021-03-15", childGender: "P", childOrder: "2", address: { perumahan: "Taman Aster", kodePos: "17530" } },
  ayahData: { name: "Ahmad", phone: "0812", education: "S1_D4" },
  ibuData: null,
  ...o,
});

function ok(s: Parameters<typeof validateConvertInput>[0]) {
  const r = validateConvertInput(s);
  if (!r.ok) throw new Error("expected ok");
  return r.input;
}

describe("validateConvertInput", () => {
  it("needs only a child name and one parent name", () => {
    expect(validateConvertInput(src({ ayahData: null, ibuData: { name: "Fatimah" } })).ok).toBe(true);
    expect(validateConvertInput({ childName: "A", studentData: null, ayahData: { name: "B" }, ibuData: null }).ok).toBe(true);
  });

  it("treats whitespace-only names as missing and names each gap with its field", () => {
    const r = validateConvertInput({ childName: "   ", studentData: { childName: " " }, ayahData: { name: "  " }, ibuData: { phone: "08" } });
    if (r.ok) throw new Error("expected failure");
    expect(r.errors.map((m) => m.field)).toEqual(["studentData.childName", "ayahData.name"]);
    for (const m of r.errors) expect(m.message).toContain("Ubah data");
  });

  it("prefers the thin column but falls back to the blob for the child name", () => {
    expect(ok(src({ childName: "Kolom", studentData: { childName: "Blob" } })).childName).toBe("Kolom");
    expect(ok(src({ childName: "", studentData: { childName: "Blob" } })).childName).toBe("Blob");
  });

  it("maps option values to their labels and joins the address", () => {
    const input = ok(src());
    expect(input.ayah?.education).toBe("S1 / D4");
    const f = studentFields(input, { dcareAddon: false, applicationId: "ea-1" });
    expect(f).toMatchObject({ dateOfBirth: "2021-03-15", gender: "P", childOrder: 2, address: "Taman Aster, 17530" });
    expect(JSON.parse(f.metadata)).toMatchObject({ dcareAddon: false, fromEnrollmentApplication: "ea-1" });
  });

  it("tolerates junk blobs", () => {
    const input = ok({ childName: "A", studentData: "x", ayahData: { name: "B" }, ibuData: 5 });
    expect(input.ibu).toBeNull();
    expect(input.dateOfBirth).toBeNull();
    const r = validateConvertInput({ childName: "A", studentData: [], ayahData: "x", ibuData: [] });
    expect(r.ok).toBe(false);
  });

  it.each(["2021-02-30", "2021-13-01", "15-03-2021", "2021/03/15", "besok", "0000-00-00"])(
    "drops a date of birth that is not a real YYYY-MM-DD date: %s",
    (dateOfBirth) => {
      expect(ok(src({ studentData: { dateOfBirth } })).dateOfBirth).toBeNull();
    },
  );

  it("keeps a real date of birth, including a leap day", () => {
    expect(ok(src({ studentData: { dateOfBirth: "2020-02-29" } })).dateOfBirth).toBe("2020-02-29");
  });

  it.each(["not-an-email", "a@", "@x.com", "a b@x.com"])("drops an invalid draft email so it cannot become a match key: %s", (email) => {
    const input = ok(src({ ayahData: { name: "Ahmad", email }, ibuData: { name: "Fatimah", email: " ok@x.com " } }));
    expect(input.ayah?.email).toBeNull();
    expect(input.ibu?.email).toBe("ok@x.com");
  });
});

describe("namesCompatible", () => {
  it.each([
    ["Ahmad Fauzi", "  ahmad   FAUZI "],
    ["Bapak Ahmad Fauzi", "Ahmad"],
    ["Ibu Fatimah Az-Zahra", "Bu Fatimah"],
    ["H. Ahmad Fauzi", "Fauzi Rahman"],
  ])("%s ~ %s", (a, b) => expect(namesCompatible(a, b)).toBe(true));

  it.each([
    ["Ahmad Fauzi", "Budi Santoso"],
    ["Bapak Budi", "Ibu Budiarti"],
    ["Pak H. Ali", "Bu Hj. Ani"], // only honorifics and sub-3-letter tokens in common
    ["Bu A", "Pak B"],
  ])("%s !~ %s", (a, b) => expect(namesCompatible(a, b)).toBe(false));
});
