import { describe, it, expect } from "vitest";
import { lookupKodePos, searchWilayah, normalizeQuery } from "../lookup";

describe("lookupKodePos (real dataset)", () => {
  it("40115 is one kelurahan: Citarum, Bandung Wetan, Kota Bandung, Jawa Barat", () => {
    expect(lookupKodePos("40115")).toEqual([
      { kodePos: "40115", kelurahan: "Citarum", kecamatan: "Bandung Wetan", kotaKab: "Kota Bandung", provinsi: "Jawa Barat" },
    ]);
  });

  it("12950 includes Kuningan Timur in Setiabudi, Kota Administrasi Jakarta Selatan, DKI Jakarta", () => {
    const hit = lookupKodePos("12950").find((e) => e.kelurahan === "Kuningan Timur");
    expect(hit).toEqual({
      kodePos: "12950",
      kelurahan: "Kuningan Timur",
      kecamatan: "Setiabudi",
      kotaKab: "Kota Administrasi Jakarta Selatan",
      provinsi: "Daerah Khusus Ibukota Jakarta",
    });
  });

  it("99351 is shared by several kelurahan in Ebungfao, Kabupaten Jayapura, Papua, sorted by name", () => {
    const rows = lookupKodePos("99351");
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const names = rows.map((r) => r.kelurahan);
    expect(names).toEqual([...names].sort());
    expect(rows.find((r) => r.kelurahan === "Atabar")).toMatchObject({
      kecamatan: "Ebungfao",
      kotaKab: "Kabupaten Jayapura",
      provinsi: "Papua",
    });
    expect(rows.every((r) => r.kodePos === "99351")).toBe(true);
  });

  it("returns [] for an unknown code", () => {
    expect(lookupKodePos("00000")).toEqual([]);
  });

  it("returns [] unless the input is exactly five digits", () => {
    for (const bad of ["", "4011", "401155", "abcde", "4011a", "40 115", "40115\n40116", "constructor", "__proto__"]) {
      expect(lookupKodePos(bad)).toEqual([]);
    }
    expect(lookupKodePos(undefined as unknown as string)).toEqual([]);
    expect(lookupKodePos(40115 as unknown as string)).toEqual([]);
  });

  it("ignores surrounding whitespace", () => {
    expect(lookupKodePos(" 40115 ")).toEqual(lookupKodePos("40115"));
    expect(lookupKodePos(" 40115 ")).toHaveLength(1);
  });
});

describe("normalizeQuery", () => {
  it("lowercases, strips diacritics and punctuation, collapses spaces", () => {
    expect(normalizeQuery("  Kuníngan,   Timur! ")).toBe("kuningan timur");
    expect(normalizeQuery("Ci-Tarum/40115")).toBe("ci tarum 40115");
  });
});

describe("searchWilayah (real dataset)", () => {
  it("finds Citarum 40115 by kelurahan name", () => {
    const res = searchWilayah("citarum");
    expect(res.some((e) => e.kodePos === "40115" && e.kelurahan === "Citarum" && e.kecamatan === "Bandung Wetan")).toBe(true);
    expect(res.every((e) => /^\d{5}$/.test(e.kodePos))).toBe(true);
  });

  it("is case-, diacritic- and punctuation-insensitive", () => {
    expect(searchWilayah("  CITARUM! ")).toEqual(searchWilayah("citarum"));
  });

  it("matches the start of a word, not the middle", () => {
    expect(searchWilayah("citar").some((e) => e.kelurahan === "Citarum")).toBe(true);
    expect(searchWilayah("itarum")).toEqual([]);
  });

  it("'bandung wetan' returns the Bandung Wetan kecamatan rows, Kota and Kabupaten apart", () => {
    const res = searchWilayah("bandung wetan", 50);
    expect(res.length).toBeGreaterThan(0);
    expect(res.some((e) => e.kecamatan === "Bandung Wetan" && e.kotaKab === "Kota Bandung" && e.kelurahan === "Citarum")).toBe(true);
    // Every hit has both words somewhere in kelurahan / kecamatan / kota-kab.
    for (const e of res) {
      const text = `${e.kelurahan} ${e.kecamatan} ${e.kotaKab}`.toLowerCase();
      expect(text).toContain("bandung");
      expect(text).toContain("wetan");
    }
    expect(searchWilayah("bandung", 200).map((e) => e.kotaKab)).toEqual(
      expect.arrayContaining(["Kota Bandung", "Kabupaten Bandung"]),
    );
  });

  it("ranks an exact kelurahan name first, then kelurahan-name words, then kecamatan", () => {
    const res = searchWilayah("citarum", 200);
    const exact = res.filter((e) => e.kelurahan.toLowerCase() === "citarum").length;
    expect(exact).toBeGreaterThan(0);
    expect(res.slice(0, exact).every((e) => e.kelurahan.toLowerCase() === "citarum")).toBe(true);
    // A kecamatan-only match (Bandung Wetan's kelurahan are not named "Bandung ...") never beats a kelurahan match.
    const bw = searchWilayah("wetan", 200);
    const firstKecOnly = bw.findIndex((e) => !/\bwetan/i.test(e.kelurahan));
    const lastKelMatch = bw.map((e) => /\bwetan/i.test(e.kelurahan)).lastIndexOf(true);
    if (firstKecOnly >= 0 && lastKelMatch >= 0) expect(lastKelMatch).toBeLessThan(firstKecOnly);
  });

  it("returns [] for fewer than 3 characters", () => {
    expect(searchWilayah("ci")).toEqual([]);
    expect(searchWilayah("")).toEqual([]);
    expect(searchWilayah(" a b ")).toEqual([]);
    expect(searchWilayah("..c.")).toEqual([]);
  });

  it("returns [] for a nonsense or over-long query", () => {
    expect(searchWilayah("zzzzqqqq")).toEqual([]);
    expect(searchWilayah("a".repeat(500))).toEqual([]);
  });

  it("respects the limit (default 20)", () => {
    expect(searchWilayah("bandung", 5)).toHaveLength(5);
    expect(searchWilayah("bandung")).toHaveLength(20);
    expect(searchWilayah("bandung", 0)).toEqual([]);
    expect(searchWilayah("bandung", Number.NaN)).toEqual([]);
  });

  it("is deterministic", () => {
    expect(searchWilayah("sukamaju", 30)).toEqual(searchWilayah("sukamaju", 30));
  });
});
