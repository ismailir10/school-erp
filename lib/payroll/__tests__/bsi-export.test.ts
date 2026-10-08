import { describe, it, expect } from "vitest";
import { generateBsiCsv, sanitizeFilename } from "../bsi-export";

describe("generateBsiCsv", () => {
  it("emits the bank header, CRLF endings and rounded integer nominal", () => {
    const csv = generateBsiCsv([
      { bankAccountNo: "7012345678", nama: "Siti Aminah", netAmount: 2500000.4, description: "Gaji 2026-10-01 - 2026-10-31" },
    ]);
    expect(csv).toBe(
      "rekening_tujuan,nama_pemilik,nominal,keterangan\r\n" +
        "7012345678,Siti Aminah,2500000,Gaji 2026-10-01 - 2026-10-31\r\n",
    );
  });

  it("quotes names with commas/quotes", () => {
    const csv = generateBsiCsv([{ bankAccountNo: "1", nama: 'Ani "A", S.Pd', netAmount: 1, description: "x" }]);
    expect(csv.split("\r\n")[1]).toBe('1,"Ani ""A"", S.Pd",1,x');
  });

  it("neutralises formula-leading free text but never touches account number or amount", () => {
    const csv = generateBsiCsv([
      { bankAccountNo: "0012345678", nama: '=HYPERLINK("http://evil")', netAmount: 1500000, description: "@cmd" },
      { bankAccountNo: "7099", nama: "+62 Budi", netAmount: 0, description: "-x" },
    ]);
    const [, l1, l2] = csv.split("\r\n");
    expect(l1).toBe(`0012345678,"'=HYPERLINK(""http://evil"")",1500000,'@cmd`);
    expect(l2).toBe("7099,'+62 Budi,0,'-x");
  });
});

describe("sanitizeFilename", () => {
  it("replaces unsafe characters", () => {
    expect(sanitizeFilename("a b/c.csv")).toBe("a_b_c.csv");
  });
});
