import { describe, it, expect } from "vitest";
import { formatAddress } from "./address";

const full = {
  provinsi: "Jawa Barat",
  kodePos: "40115",
  kotaKab: "Kota Bandung",
  kecamatan: "Bandung Wetan",
  kelurahan: "Citarum",
  rtRw: "01/02",
  blokCluster: "Blok B",
  perumahan: "Jl. Citarum 5",
};

describe("formatAddress", () => {
  it("joins all eight keys in reading order whatever the key order of the blob", () => {
    expect(formatAddress(full)).toBe("Jl. Citarum 5, Blok B, 01/02, Citarum, Bandung Wetan, Kota Bandung, Jawa Barat, 40115");
  });

  it("prints rtRw exactly as stored, with no label added", () => {
    expect(formatAddress({ rtRw: "RT 01 / RW 02" })).toBe("RT 01 / RW 02");
  });

  it("reads an old blob without the region keys exactly as the old join did", () => {
    expect(formatAddress({ perumahan: "Taman Aster", blokCluster: "A3", rtRw: "02/05", kecamatan: "Cikarang", kodePos: "17530" })).toBe(
      "Taman Aster, A3, 02/05, Cikarang, 17530",
    );
  });

  it("skips blank, whitespace and non-string values and trims the rest", () => {
    expect(formatAddress({ perumahan: "  Jl. A  ", blokCluster: "", rtRw: "   ", kelurahan: 5, kecamatan: null, kodePos: "40115" })).toBe("Jl. A, 40115");
  });

  it("returns null for nothing to show", () => {
    for (const v of [null, undefined, "Jl. A", 5, [], {}, { perumahan: " " }, { unknown: "x" }]) expect(formatAddress(v)).toBeNull();
  });

  it("ignores keys outside the eight", () => {
    expect(formatAddress({ ...full, negara: "ID", tenantId: "t" })).toBe(
      "Jl. Citarum 5, Blok B, 01/02, Citarum, Bandung Wetan, Kota Bandung, Jawa Barat, 40115",
    );
  });
});
