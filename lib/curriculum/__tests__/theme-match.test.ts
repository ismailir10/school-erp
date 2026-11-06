import { describe, it, expect } from "vitest";
import {
  normaliseThemeName,
  indexThemes,
  resolveThemeNames,
} from "../theme-match";

describe("normaliseThemeName", () => {
  it("trims, collapses internal whitespace, and casefolds", () => {
    expect(normaliseThemeName("  Aku   Sayang   Bumi ")).toBe("aku sayang bumi");
    expect(normaliseThemeName("AKU SAYANG BUMI")).toBe("aku sayang bumi");
  });

  it("collapses tabs and newlines from spreadsheet cells", () => {
    expect(normaliseThemeName("Aku\tSayang\nBumi")).toBe("aku sayang bumi");
  });

  it("preserves punctuation — different punctuation is a different theme", () => {
    expect(normaliseThemeName("Aku, Sayang Bumi")).not.toBe(
      normaliseThemeName("Aku Sayang Bumi"),
    );
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normaliseThemeName("   ")).toBe("");
  });
});

describe("indexThemes", () => {
  it("indexes by normalised name", () => {
    const { idByNormalisedName, duplicateNames } = indexThemes([
      { id: "t1", name: "Aku Sayang Bumi" },
      { id: "t2", name: "Diriku" },
    ]);
    expect(idByNormalisedName.get("aku sayang bumi")).toBe("t1");
    expect(idByNormalisedName.get("diriku")).toBe("t2");
    expect(duplicateNames).toEqual([]);
  });

  it("keeps the first occurrence and reports normalised duplicates", () => {
    const { idByNormalisedName, duplicateNames } = indexThemes([
      { id: "t1", name: "Diriku" },
      { id: "t2", name: "  diriku  " },
    ]);
    expect(idByNormalisedName.get("diriku")).toBe("t1");
    expect(duplicateNames).toEqual(["  diriku  "]);
  });

  it("skips whitespace-only theme names", () => {
    const { idByNormalisedName } = indexThemes([{ id: "t1", name: "   " }]);
    expect(idByNormalisedName.size).toBe(0);
  });
});

describe("resolveThemeNames", () => {
  const index = indexThemes([
    { id: "t1", name: "Aku Sayang Bumi" },
    { id: "t2", name: "Diriku" },
    { id: "t3", name: "Tanaman" },
  ]);

  it("resolves matching names to ids in input order", () => {
    const { themeIds, unmatched } = resolveThemeNames(
      ["Tanaman", "Diriku"],
      index,
    );
    expect(themeIds).toEqual(["t3", "t2"]);
    expect(unmatched).toEqual([]);
  });

  it("matches across capitalisation and whitespace drift", () => {
    const { themeIds, unmatched } = resolveThemeNames(
      ["  AKU   sayang BUMI "],
      index,
    );
    expect(themeIds).toEqual(["t1"]);
    expect(unmatched).toEqual([]);
  });

  it("reports unmatched names trimmed, without guessing", () => {
    const { themeIds, unmatched } = resolveThemeNames(
      ["Diriku", "  Kendaraan  "],
      index,
    );
    expect(themeIds).toEqual(["t2"]);
    expect(unmatched).toEqual(["Kendaraan"]);
  });

  it("de-duplicates repeated ids and repeated unmatched names", () => {
    const { themeIds, unmatched } = resolveThemeNames(
      ["Diriku", "diriku", "Kendaraan", "KENDARAAN "],
      index,
    );
    expect(themeIds).toEqual(["t2"]);
    expect(unmatched).toEqual(["Kendaraan"]);
  });

  it("ignores blank cells", () => {
    const { themeIds, unmatched } = resolveThemeNames(["", "   "], index);
    expect(themeIds).toEqual([]);
    expect(unmatched).toEqual([]);
  });
});

describe("indexThemes — kelompok scope", () => {
  const themes = [
    { id: "shared-diriku", name: "Diriku", ageGroup: null },
    { id: "a-diriku", name: "Diriku", ageGroup: "A" as const },
    { id: "b-only", name: "Kendaraan", ageGroup: "B" as const },
    { id: "shared-mpls", name: "MPLS", ageGroup: null },
  ];

  it("prefers the group-specific theme over a shared one of the same name", () => {
    const idx = indexThemes(themes, "A");
    expect(idx.idByNormalisedName.get("diriku")).toBe("a-diriku");
    expect(idx.idByNormalisedName.get("mpls")).toBe("shared-mpls");
    expect(idx.duplicateNames).toEqual([]);
  });

  it("falls back to the shared theme when the group has none", () => {
    expect(indexThemes(themes, "B").idByNormalisedName.get("diriku")).toBe("shared-diriku");
  });

  it("reports names that only match the other kelompok as unmatched", () => {
    const res = resolveThemeNames(["Kendaraan", "MPLS"], indexThemes(themes, "A"));
    expect(res.themeIds).toEqual(["shared-mpls"]);
    expect(res.unmatched).toEqual(["Kendaraan"]);
  });

  it("without an ageGroup behaves as before", () => {
    expect(indexThemes(themes).idByNormalisedName.get("diriku")).toBe("shared-diriku");
  });
});
