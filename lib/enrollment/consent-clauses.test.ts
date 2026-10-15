import { describe, it, expect } from "vitest";
import {
  CONSENT_CLAUSES,
  CONSENT_CLAUSE_COUNT,
  CONSENT_VERSION,
} from "./consent-clauses";

describe("consent clauses (R2-P-15 proofreading)", () => {
  const text = CONSENT_CLAUSES.join("\n");

  it("keeps all 17 clauses", () => {
    expect(CONSENT_CLAUSE_COUNT).toBe(17);
    expect(CONSENT_CLAUSES).toHaveLength(17);
  });

  it("no longer carries the garbled Home Visit and report-card wording", () => {
    expect(text).not.toContain("ibu atau bapak & ayah");
    expect(text).not.toContain("hak ibu dan orang tua");
    expect(text).not.toContain("Anak / tidak diwakilkan");
    expect(text).toContain("diterima oleh ayah atau ibu");
    expect(text).toContain("Home Visit adalah hak orang tua");
    expect(text).toContain("Mengambil Buku Laporan Perkembangan Anak sendiri (tidak diwakilkan)");
  });
});

describe("photo/video clause (v2)", () => {
  it("is the last (17th) clause with the agreed wording", () => {
    expect(CONSENT_CLAUSES[16]).toBe(
      "Dengan mendaftar, kami mengizinkan sekolah menggunakan foto dan video ananda dari kegiatan sekolah untuk dokumentasi dan media sosial sekolah. Jika ingin membatasi, kami dapat menyampaikannya kepada Wali Kelas kapan saja.",
    );
  });

  it("is the only clause about photos", () => {
    const hits = CONSENT_CLAUSES.map((c, i) => (/foto|video/i.test(c) ? i : -1)).filter((i) => i >= 0);
    expect(hits).toEqual([16]);
  });

  it("bumped the version because the letter's meaning changed", () => {
    expect(CONSENT_VERSION).toBe("annisaa-2026-v2");
  });
});
