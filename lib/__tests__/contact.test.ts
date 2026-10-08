import { describe, it, expect } from "vitest";
import { telHref, whatsappHref, whatsappHrefWithText, schoolContactPhone, SCHOOL_CONTACT_FALLBACK_TEXT } from "@/lib/contact";

describe("telHref", () => {
  it("strips formatting", () => {
    expect(telHref("0812-8877-4402")).toBe("tel:081288774402");
    expect(telHref("(021) 8877 402")).toBe("tel:0218877402");
  });

  it("keeps a leading plus", () => {
    expect(telHref("+62 812 8877 4402")).toBe("tel:+6281288774402");
  });

  it("returns null for nothing dialable", () => {
    expect(telHref(null)).toBeNull();
    expect(telHref("")).toBeNull();
    expect(telHref("-")).toBeNull();
    expect(telHref("12345")).toBeNull();
  });
});

describe("whatsappHref", () => {
  it("swaps the Indonesian trunk 0 for the country code", () => {
    expect(whatsappHref("0812-8877-4402")).toBe("https://wa.me/6281288774402");
  });

  it("passes an already-international number through", () => {
    expect(whatsappHref("+62 812 8877 4402")).toBe("https://wa.me/6281288774402");
    expect(whatsappHref("6281288774402")).toBe("https://wa.me/6281288774402");
  });

  it("returns null for nothing usable", () => {
    expect(whatsappHref(null)).toBeNull();
    expect(whatsappHref("n/a")).toBeNull();
    expect(whatsappHref("0812")).toBeNull();
  });
});

describe("whatsappHrefWithText / schoolContactPhone", () => {
  it("prefills an encoded message on the normalised wa.me link", () => {
    expect(whatsappHrefWithText("0812-8877-4402", "Tagihan INV-1 & lainnya")).toBe(
      "https://wa.me/6281288774402?text=Tagihan%20INV-1%20%26%20lainnya",
    );
    expect(whatsappHrefWithText("-", "x")).toBeNull();
  });

  it("reads SCHOOL_CONTACT_PHONE, trimmed; unset or blank is null", () => {
    const prev = process.env.SCHOOL_CONTACT_PHONE;
    try {
      delete process.env.SCHOOL_CONTACT_PHONE;
      expect(schoolContactPhone()).toBeNull();
      process.env.SCHOOL_CONTACT_PHONE = "   ";
      expect(schoolContactPhone()).toBeNull();
      process.env.SCHOOL_CONTACT_PHONE = " 0812-8877-4402 ";
      expect(schoolContactPhone()).toBe("0812-8877-4402");
    } finally {
      if (prev === undefined) delete process.env.SCHOOL_CONTACT_PHONE;
      else process.env.SCHOOL_CONTACT_PHONE = prev;
    }
  });
});

describe("SCHOOL_CONTACT_FALLBACK_TEXT", () => {
  it("names a concrete office instead of a dead 'hubungi admin'", () => {
    expect(SCHOOL_CONTACT_FALLBACK_TEXT).toBe("Silakan hubungi bagian tata usaha sekolah.");
  });
});
