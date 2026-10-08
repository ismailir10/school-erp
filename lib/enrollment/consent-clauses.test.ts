import { describe, it, expect } from "vitest";
import {
  CONSENT_CLAUSES,
  CONSENT_CLAUSE_COUNT,
  CONSENT_VERSION,
  PHOTO_CLAUSE_INDEX,
  PHOTO_CLAUSE_TITLE,
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
  it("is the last clause and PHOTO_CLAUSE_INDEX points at it", () => {
    expect(PHOTO_CLAUSE_INDEX).toBe(16);
    expect(PHOTO_CLAUSE_INDEX).toBe(CONSENT_CLAUSES.length - 1);
    expect(CONSENT_CLAUSES[PHOTO_CLAUSE_INDEX]).toBe(
      "Dengan mendaftar, kami mengizinkan sekolah menggunakan foto dan video ananda dari kegiatan sekolah untuk dokumentasi dan media sosial sekolah. Jika ingin membatasi, kami dapat menyampaikannya kepada Wali Kelas kapan saja.",
    );
    expect(PHOTO_CLAUSE_TITLE).toBe("Foto & video kegiatan");
  });

  it("is the only clause about photos, so the index cannot point at the wrong one", () => {
    const hits = CONSENT_CLAUSES.map((c, i) => (/foto|video/i.test(c) ? i : -1)).filter((i) => i >= 0);
    expect(hits).toEqual([PHOTO_CLAUSE_INDEX]);
  });

  it("bumped the version because the letter's meaning changed", () => {
    expect(CONSENT_VERSION).toBe("annisaa-2026-v2");
  });
});
