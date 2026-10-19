import { describe, it, expect } from "vitest";
import { familyReminderText, familyReminderWaUrl } from "../invoice-reminder";

const ITEMS = [
  { studentName: "Bilal", invoiceNumber: "INV-2026-0312", periodLabel: "Oktober 2026", remaining: 750_000 },
  { studentName: "Aisyah", invoiceNumber: "INV-2026-0330", periodLabel: "Oktober 2026", remaining: 600_000 },
];
const PAY_URL = "https://talib.example/parent/invoices";

describe("familyReminderText", () => {
  const text = familyReminderText({ guardianName: "Fatimah Rahman", items: ITEMS, total: 1_350_000, payUrl: PAY_URL });

  it("greets the wali by name and closes courteously", () => {
    expect(text.startsWith("Assalamu'alaikum Bapak/Ibu Fatimah Rahman.")).toBe(true);
    expect(text.endsWith("Jika sudah membayar, mohon abaikan pesan ini. Jazakumullah khairan.")).toBe(true);
  });

  it("lists one line per invoice with the child, period, number and amount left", () => {
    expect(text).toContain("- Oktober 2026 untuk ananda Bilal (INV-2026-0312): Rp 750.000");
    expect(text).toContain("- Oktober 2026 untuk ananda Aisyah (INV-2026-0330): Rp 600.000");
    expect(text.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(2);
  });

  it("states the total and the portal link", () => {
    expect(text).toContain("Total: Rp 1.350.000");
    expect(text).toContain(`lewat tautan berikut: ${PAY_URL}`);
  });

  it("names the invoices beyond the listed ones instead of under-stating the debt", () => {
    const t = familyReminderText({ guardianName: "Fatimah", items: ITEMS, total: 9_000_000, moreCount: 3, payUrl: PAY_URL });
    expect(t).toContain("- dan 3 tagihan lainnya");
    expect(t).toContain("Total: Rp 9.000.000");
    expect(familyReminderText({ guardianName: "Fatimah", items: ITEMS, total: 1, moreCount: 0, payUrl: PAY_URL })).not.toContain("lainnya");
  });

  it("falls back to a bare greeting when the name is blank", () => {
    const t = familyReminderText({ guardianName: "  ", items: ITEMS, total: 1, payUrl: PAY_URL });
    expect(t.startsWith("Assalamu'alaikum Bapak/Ibu.")).toBe(true);
  });
});

describe("familyReminderWaUrl", () => {
  const base = { items: ITEMS, total: 1_350_000, payUrl: PAY_URL };

  it("opens the wali's WhatsApp number with the message prefilled", () => {
    const url = familyReminderWaUrl({ ...base, guardian: { name: "Fatimah", whatsapp: "0812-5550-1234", phone: null } })!;
    expect(url.startsWith("https://wa.me/6281255501234?text=")).toBe(true);
    const decoded = decodeURIComponent(url.split("?text=")[1]);
    expect(decoded).toBe(familyReminderText({ guardianName: "Fatimah", ...base }));
  });

  it("falls back to the phone when there is no WhatsApp number", () => {
    const url = familyReminderWaUrl({ ...base, guardian: { name: "Fatimah", whatsapp: null, phone: "0813 3334 4455" } });
    expect(url).toContain("https://wa.me/6281333344455?text=");
  });

  it("is null without a number WhatsApp can open", () => {
    expect(familyReminderWaUrl({ ...base, guardian: { name: "Fatimah", whatsapp: "-", phone: "123" } })).toBeNull();
    expect(familyReminderWaUrl({ ...base, guardian: null })).toBeNull();
  });

  it("is null when there is nothing to chase", () => {
    expect(
      familyReminderWaUrl({ ...base, items: [], guardian: { name: "Fatimah", whatsapp: "0812-5550-1234", phone: null } }),
    ).toBeNull();
  });
});
