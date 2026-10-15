import { describe, it, expect } from "vitest";
import { canRemindInvoice, guardianChatNumber, invoiceReminderText, invoiceReminderWaUrl } from "./invoice-reminder";

describe("guardianChatNumber", () => {
  it("prefers the WhatsApp number, then the phone", () => {
    expect(guardianChatNumber({ whatsapp: "0812-1111-2222", phone: "0813333444" })).toBe("0812-1111-2222");
    expect(guardianChatNumber({ whatsapp: null, phone: "0813333444" })).toBe("0813333444");
  });
  it("skips a value WhatsApp cannot open and uses the next good one", () => {
    expect(guardianChatNumber({ whatsapp: "-", phone: "0813333444" })).toBe("0813333444");
  });
  it("is null with nothing usable", () => {
    expect(guardianChatNumber(null)).toBeNull();
    expect(guardianChatNumber({ whatsapp: "", phone: "123" })).toBeNull();
  });
});

describe("canRemindInvoice", () => {
  it.each(["SENT", "PARTIALLY_PAID", "OVERDUE"])("%s with money left can be chased", (status) => {
    expect(canRemindInvoice({ status, remaining: 100_000 })).toBe(true);
  });
  it.each(["DRAFT", "PENDING_PAYMENT_LINK", "PAID", "CANCELLED"])("%s cannot", (status) => {
    expect(canRemindInvoice({ status, remaining: 100_000 })).toBe(false);
  });
  it("nothing left means nothing to chase", () => {
    expect(canRemindInvoice({ status: "OVERDUE", remaining: 0 })).toBe(false);
  });
});

describe("invoiceReminderText", () => {
  const base = {
    guardianName: "Siti",
    studentName: "Aisyah",
    invoiceNumber: "INV-2026-0001",
    periodLabel: "SPP Oktober 2026",
    remaining: 450_000,
    payUrl: "https://doku.example/pay/1",
  };
  it("names the guardian, child, invoice and what is left, with the link and an easy out", () => {
    const t = invoiceReminderText(base);
    expect(t).toContain("Assalamu'alaikum Bapak/Ibu Siti");
    expect(t).toContain("ananda Aisyah");
    expect(t).toContain("INV-2026-0001");
    expect(t).toContain("SPP Oktober 2026");
    expect(t).toContain("450.000");
    expect(t).toContain("https://doku.example/pay/1");
    expect(t).toContain("mohon abaikan pesan ini");
  });
  it("still greets politely without a name", () => {
    expect(invoiceReminderText({ ...base, guardianName: " " })).toContain("Assalamu'alaikum Bapak/Ibu.");
  });
});

describe("invoiceReminderWaUrl", () => {
  const src = {
    guardian: { name: "Siti", whatsapp: "0812-3456-7890", phone: null },
    studentName: "Aisyah",
    invoiceNumber: "INV-1",
    periodLabel: "SPP Oktober 2026",
    remaining: 450_000,
    payUrl: "https://talib.example/parent/invoices",
  };
  it("opens WhatsApp on the normalised number with the message encoded", () => {
    const url = invoiceReminderWaUrl(src)!;
    expect(url.startsWith("https://wa.me/6281234567890?text=")).toBe(true);
    expect(decodeURIComponent(url.split("?text=")[1])).toContain("https://talib.example/parent/invoices");
  });
  it("is null with no number to message", () => {
    expect(invoiceReminderWaUrl({ ...src, guardian: { name: "Siti", whatsapp: null, phone: null } })).toBeNull();
  });
});
