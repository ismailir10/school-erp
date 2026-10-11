import { describe, it, expect } from "vitest";
import {
  canRemind,
  feeReminderText,
  feeReminderWaUrl,
  inviteText,
  inviteWaUrl,
  parentFormUrl,
  resolveFollowUpPhone,
} from "./follow-up";

describe("resolveFollowUpPhone", () => {
  it("prefers the inquiry's WhatsApp number", () => {
    expect(
      resolveFollowUpPhone({
        admission: { parentWhatsapp: "0812-1111-2222", parentPhone: "0813333444" },
        ibuData: { phone: "0814444555" },
      }),
    ).toBe("0812-1111-2222");
  });

  it("falls back inquiry phone → Ibu → Ayah", () => {
    expect(resolveFollowUpPhone({ admission: { parentWhatsapp: null, parentPhone: "0813333444" } })).toBe("0813333444");
    expect(resolveFollowUpPhone({ admission: {}, ibuData: { phone: "0814444555" }, ayahData: { phone: "0815555666" } })).toBe("0814444555");
    expect(resolveFollowUpPhone({ admission: {}, ibuData: {}, ayahData: { phone: " 0815555666 " } })).toBe("0815555666");
  });

  it("skips a value WhatsApp cannot open and uses the next good one", () => {
    expect(
      resolveFollowUpPhone({ admission: { parentWhatsapp: "-", parentPhone: "123" }, ibuData: { phone: "0814444555" } }),
    ).toBe("0814444555");
  });

  it("is null when there is no usable number anywhere", () => {
    expect(resolveFollowUpPhone({})).toBeNull();
    expect(resolveFollowUpPhone({ admission: { parentWhatsapp: "", parentPhone: null }, ibuData: null, ayahData: "x" })).toBeNull();
    expect(resolveFollowUpPhone({ ibuData: { phone: 12345678901 }, ayahData: [] })).toBeNull();
  });
});

describe("canRemind", () => {
  it("is true when any source has a number WhatsApp can open", () => {
    expect(canRemind({ admission: { parentWhatsapp: "0812-3456-7890" } })).toBe(true);
    expect(canRemind({ ayahData: { phone: "0815555666" } })).toBe(true);
  });
  it("is false for nothing, junk, or too-short numbers", () => {
    expect(canRemind({})).toBe(false);
    expect(canRemind({ admission: { parentWhatsapp: "-", parentPhone: "123" } })).toBe(false);
  });
});

describe("feeReminderText", () => {
  const base = { parentName: "Siti", childName: "Aisyah", amount: 300_000, formUrl: "https://talib.example/pendaftaran/tok" };

  it("greets, names the child and amount, carries the link, and is easy to ignore when already paid", () => {
    const t = feeReminderText(base);
    expect(t).toContain("Assalamu'alaikum Bapak/Ibu Siti");
    expect(t).toContain("ananda Aisyah");
    expect(t).toContain("Rp 300.000");
    expect(t).toContain("https://talib.example/pendaftaran/tok");
    expect(t).toContain("mohon abaikan pesan ini");
  });

  it("states the discounted amount it is given, not a base fee", () => {
    expect(feeReminderText({ ...base, amount: 240_000 })).toContain("Rp 240.000");
  });

  it("names the school it is given, and introduces nobody when there is none", () => {
    expect(feeReminderText({ ...base, schoolName: "Taman Aster" })).toContain("Kami dari Taman Aster.");
    expect(feeReminderText(base)).not.toContain("Kami dari");
  });

  it("pay-first: speaks of 'ananda' in general when the child is not named yet", () => {
    const t = feeReminderText({ ...base, childName: "  " });
    expect(t).toContain("Biaya pendaftaran ananda sebesar Rp 300.000 belum kami terima.");
    expect(t).not.toMatch(/ananda\s{2,}/);
  });

  it("still greets politely without a parent name", () => {
    expect(feeReminderText({ ...base, parentName: null })).toContain("Assalamu'alaikum Bapak/Ibu.");
    expect(feeReminderText({ ...base, parentName: "  " })).toContain("Assalamu'alaikum Bapak/Ibu.");
  });
});

describe("feeReminderWaUrl", () => {
  const src = {
    admission: { parentWhatsapp: "0812-3456-7890", parentPhone: null },
    parentName: "Siti",
    childName: "Aisyah",
    amount: 300_000,
    formUrl: "https://talib.example/pendaftaran/tok",
  };

  it("opens WhatsApp on the normalised number with the message URL-encoded", () => {
    const url = feeReminderWaUrl(src)!;
    expect(url.startsWith("https://wa.me/6281234567890?text=")).toBe(true);
    const text = decodeURIComponent(url.split("?text=")[1]);
    expect(text).toContain("Biaya pendaftaran ananda Aisyah");
    expect(text).toContain("https://talib.example/pendaftaran/tok");
  });

  it("is null when there is no number to message", () => {
    expect(feeReminderWaUrl({ ...src, admission: { parentWhatsapp: null, parentPhone: null } })).toBeNull();
  });
});

describe("parentFormUrl", () => {
  it("joins origin and token, tolerating a trailing slash and encoding the token", () => {
    expect(parentFormUrl("https://talib.example/", "abc_DEF-123")).toBe("https://talib.example/pendaftaran/abc_DEF-123");
    expect(parentFormUrl("https://talib.example", "a/b c")).toBe("https://talib.example/pendaftaran/a%2Fb%20c");
  });
});

describe("inviteText", () => {
  const base = { parentName: "Siti", childName: "Aisyah", formUrl: "https://talib.example/pendaftaran/tok" };

  it("greets the parent, names the child and carries the link", () => {
    const t = inviteText(base);
    expect(t).toContain("Assalamu'alaikum Bapak/Ibu Siti");
    expect(t).toContain("formulir pendaftaran ananda Aisyah");
    expect(t).toContain("https://talib.example/pendaftaran/tok");
  });

  it("speaks of the formulir in general when the child is not named yet", () => {
    expect(inviteText({ ...base, childName: "" })).toContain("tautan formulir pendaftaran: https://");
    expect(inviteText({ ...base, childName: undefined })).not.toContain("ananda");
  });

  it("still greets politely without a parent name and names the school only when given", () => {
    expect(inviteText({ ...base, parentName: " " })).toContain("Assalamu'alaikum Bapak/Ibu.");
    expect(inviteText({ ...base, schoolName: "Taman Aster" })).toContain("Kami dari Taman Aster.");
    expect(inviteText(base)).not.toContain("Kami dari");
  });
});

describe("inviteWaUrl", () => {
  const base = { parentName: "Siti", childName: "Aisyah", formUrl: "https://talib.example/pendaftaran/tok" };

  it("opens WhatsApp on the normalised number with the message URL-encoded", () => {
    const url = inviteWaUrl({ ...base, phone: "0812-3456-7890" })!;
    expect(url.startsWith("https://wa.me/6281234567890?text=")).toBe(true);
    const text = decodeURIComponent(url.split("?text=")[1]);
    expect(text).toBe(
      [
        "Assalamu'alaikum Bapak/Ibu Siti.",
        "Berikut tautan formulir pendaftaran ananda Aisyah: https://talib.example/pendaftaran/tok",
        "Mohon dilengkapi dengan teliti. Jika ada yang kurang jelas, silakan balas pesan ini. Jazakumullah khairan.",
      ].join("\n\n"),
    );
    // the link survives encoding intact, so the tap opens the right page
    expect(url).toContain(encodeURIComponent(base.formUrl));
  });

  it("accepts an already international number", () => {
    expect(inviteWaUrl({ ...base, phone: "+62 812 3456 7890" })!.startsWith("https://wa.me/628123456789")).toBe(true);
  });

  it("is null when there is no number WhatsApp can open", () => {
    expect(inviteWaUrl({ ...base, phone: null })).toBeNull();
    expect(inviteWaUrl({ ...base, phone: "" })).toBeNull();
    expect(inviteWaUrl({ ...base, phone: "123" })).toBeNull();
    expect(inviteWaUrl({ ...base, phone: "-" })).toBeNull();
  });
});
