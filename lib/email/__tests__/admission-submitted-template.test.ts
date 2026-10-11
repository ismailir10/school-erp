import { describe, expect, it } from "vitest";
import { admissionSubmittedEmailHtml } from "../templates/admission-submitted";

const base = { parentName: "Ibu Fatimah", appUrl: "https://talib.test" };

describe("admissionSubmittedEmailHtml — child name is optional", () => {
  it("names the child when the family gave one", () => {
    const html = admissionSubmittedEmailHtml({ ...base, childName: "Aisyah Putri" });
    expect(html).toContain("mendaftarkan ananda <strong>Aisyah Putri</strong>");
  });

  it("thanks the parent without an empty ananda slot when no child was named", () => {
    const html = admissionSubmittedEmailHtml({ ...base, childName: "  " });
    expect(html).toContain("terima kasih telah menghubungi Talib");
    expect(html).not.toContain("ananda <strong></strong>");
    expect(html).not.toContain("mendaftarkan ananda");
  });
});
