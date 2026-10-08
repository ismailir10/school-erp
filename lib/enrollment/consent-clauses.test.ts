import { describe, it, expect } from "vitest";
import { CONSENT_CLAUSES, CONSENT_CLAUSE_COUNT } from "./consent-clauses";

describe("consent clauses (R2-P-15 proofreading)", () => {
  const text = CONSENT_CLAUSES.join("\n");

  it("keeps all 16 clauses", () => {
    expect(CONSENT_CLAUSE_COUNT).toBe(16);
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
