import { describe, it, expect } from "vitest";
import { changedKeys, mergeSection, splitClears } from "./staff-edit";

describe("splitClears", () => {
  it("moves blank known fields (\"\", whitespace, null, []) into clears and keeps the rest", () => {
    const { value, clears } = splitClears("ayahData", { name: "Ahmad", phone: "", email: null, employerName: "  " });
    expect(value).toEqual({ name: "Ahmad" });
    expect(clears.sort()).toEqual(["email", "employerName", "phone"]);
  });

  it("handles nested address keys and a wholly cleared address", () => {
    expect(splitClears("studentData", { address: { kodePos: "", rtRw: "01/02" } })).toEqual({
      value: { address: { rtRw: "01/02" } },
      clears: ["address.kodePos"],
    });
    expect(splitClears("studentData", { address: null }).clears).toEqual(["address"]);
    expect(splitClears("studentData", { priorFamilyAttendees: [] }).clears).toEqual(["priorFamilyAttendees"]);
  });

  it("never lets an unknown key, blank or not, through or into clears", () => {
    const { value, clears } = splitClears("consentData", { onlyParent: "ayah", signatureToken: "", agreed: true });
    expect(value).toEqual({ onlyParent: "ayah" });
    expect(clears).toEqual([]);
  });

  it("passes a non-object through for the schema to reject", () => {
    expect(splitClears("studentData", "x")).toEqual({ value: "x", clears: [] });
  });
});

describe("mergeSection", () => {
  it("overlays the patch, merges address one level deep, and keeps untouched keys", () => {
    const stored = { name: "A", phone: "1", address: { perumahan: "P", kodePos: "1" } };
    const next = mergeSection(stored, { phone: "2", address: { kodePos: "9" } }, []);
    expect(next).toEqual({ name: "A", phone: "2", address: { perumahan: "P", kodePos: "9" } });
    expect(stored.phone).toBe("1"); // input untouched
  });

  it("applies clears, dropping an address that ends up empty", () => {
    expect(mergeSection({ name: "A", phone: "1", address: { kodePos: "1" } }, {}, ["phone", "address.kodePos"])).toEqual({ name: "A" });
  });

  it("treats a missing or non-object stored blob as empty", () => {
    expect(mergeSection(null, { name: "A" }, [])).toEqual({ name: "A" });
    expect(mergeSection([], { name: "A" }, ["x"])).toEqual({ name: "A" });
  });
});

describe("changedKeys", () => {
  it("lists only the keys whose value differs, by name", () => {
    expect(changedKeys({ a: 1, b: { c: 1 }, d: "x" }, { a: 1, b: { c: 2 }, e: "y" })).toEqual(["b", "d", "e"]);
    expect(changedKeys(null, {})).toEqual([]);
  });

  it("ignores key order at every depth (jsonb returns its own order)", () => {
    const before = { ibu: { signedAt: "t", name: "I" }, ayah: { name: "A", signatureToken: "x" }, list: [{ b: 1, a: 2 }] };
    const after = { ayah: { signatureToken: "x", name: "A" }, ibu: { name: "I", signedAt: "t" }, list: [{ a: 2, b: 1 }] };
    expect(changedKeys(before, after)).toEqual([]);
    expect(changedKeys(before, { ...after, list: [{ a: 2, b: 2 }] })).toEqual(["list"]);
    expect(changedKeys({ a: [1, 2] }, { a: [2, 1] })).toEqual(["a"]); // array order IS meaningful
  });
});
