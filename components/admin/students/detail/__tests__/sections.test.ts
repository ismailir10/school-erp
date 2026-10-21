import { describe, it, expect } from "vitest";
import { GROUPS, LAZY_SECTIONS, defaultOpenSections, groupOf, isKnownTarget } from "../sections";

const ALL_OLD_IDS = [
  "data-anak", "kesehatan", "keluarga", "riwayat-kelas", "kehadiran", "keuangan", "keringanan",
  "buku-penghubung", "akademik", "pendaftaran", "dokumen", "riwayat-status", "informasi-tambahan",
];

describe("dossier sections", () => {
  it("has five groups in the agreed order", () => {
    expect(GROUPS.map((g) => g.label)).toEqual([
      "Profil", "Keluarga & Berkas", "Kelas & Akademik", "Keuangan", "Pendaftaran & Catatan",
    ]);
  });

  it("maps every old anchor id to a group, and a group to itself", () => {
    for (const id of ALL_OLD_IDS) expect(groupOf(id), id).not.toBeNull();
    for (const g of GROUPS) expect(groupOf(g.id)).toBe(g.id);
    expect(groupOf("nope")).toBeNull();
  });

  it("puts each sub-section in the group the design names", () => {
    expect(groupOf("informasi-tambahan")).toBe("group-profil");
    expect(groupOf("dokumen")).toBe("group-keluarga");
    expect(groupOf("riwayat-status")).toBe("group-kelas");
    expect(groupOf("keringanan")).toBe("group-keuangan");
    expect(groupOf("buku-penghubung")).toBe("group-catatan");
  });

  it("knows the five lazy rows", () => {
    expect([...LAZY_SECTIONS].sort()).toEqual(["akademik", "buku-penghubung", "kehadiran", "keringanan", "pendaftaran"]);
  });

  describe("isKnownTarget", () => {
    const plain = { hasApplication: false, lifecycleShown: false };
    it("accepts groups and always-present sub-sections", () => {
      expect(isKnownTarget("group-kelas", plain)).toBe(true);
      expect(isKnownTarget("keuangan", plain)).toBe(true);
    });
    it("accepts the conditional ones only when they render", () => {
      expect(isKnownTarget("pendaftaran", plain)).toBe(false);
      expect(isKnownTarget("pendaftaran", { ...plain, hasApplication: true })).toBe(true);
      expect(isKnownTarget("riwayat-status", plain)).toBe(false);
      expect(isKnownTarget("riwayat-status", { ...plain, lifecycleShown: true })).toBe(true);
    });
    it("rejects unknown ids", () => {
      expect(isKnownTarget("", plain)).toBe(false);
      expect(isKnownTarget("something-else", plain)).toBe(false);
    });
  });

  describe("defaultOpenSections", () => {
    it("opens Profil, Keluarga & Berkas and Keuangan on desktop", () => {
      const open = defaultOpenSections(false);
      expect(GROUPS.map((g) => open[g.id])).toEqual([true, true, false, true, false]);
    });
    it("opens only Profil on a phone", () => {
      const open = defaultOpenSections(true);
      expect(GROUPS.map((g) => open[g.id])).toEqual([true, false, false, false, false]);
    });
    it("starts every lazy row closed on both", () => {
      for (const mobile of [false, true]) {
        const open = defaultOpenSections(mobile);
        for (const id of LAZY_SECTIONS) expect(open[id]).toBe(false);
      }
    });
  });
});
