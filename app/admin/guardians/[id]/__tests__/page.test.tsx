/**
 * Wali detail page, answer-first behaviour: the "Perlu perhatian" strip,
 * contact in the header, "Belum diisi", collapsed-section summaries, child rows,
 * the three load-failure states and the capped invoice list footer.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import GuardianDetailPage from "../page";
import { CLEAN_SUMMARY, fulfilledParams, makeParent, okJson, stubFetchWith } from "./parent-fixture";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

async function renderWith(parent: unknown) {
  stubFetchWith(parent);
  const user = userEvent.setup();
  render(<GuardianDetailPage params={fulfilledParams({ id: "p1" })} />);
  await screen.findByRole("heading", { level: 1 });
  return user;
}

const strip = () => screen.queryByRole("region", { name: "Perlu perhatian" });
const trigger = (sectionId: string) =>
  document.getElementById(sectionId)!.querySelector('[data-slot="collapsible-trigger"]') as HTMLElement;

/** Nothing owed, both documents on file, one placed child: the healthy wali. */
const HEALTHY = {
  hasKtp: true,
  hasKk: true,
  invoiceSummary: CLEAN_SUMMARY,
  invoices: [],
  unpaidInvoices: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("guardian page — Perlu perhatian", () => {
  it("lists the amount owed, the unpaid count and how many are overdue, and jumps to Tagihan", async () => {
    const user = await renderWith(makeParent());

    const region = strip()!;
    expect(region).toBeInTheDocument();
    expect(within(region).getByText("Rp 400.000").tagName).toBe("STRONG");
    expect(region.textContent).toContain("belum dibayar · 1 tagihan, 1 lewat tempo");

    // Invoices start open, so collapse them first to prove the button re-opens them.
    await user.click(trigger("invoices"));
    expect(screen.queryByText("INV-2026-0001")).not.toBeInTheDocument();
    Element.prototype.scrollIntoView = vi.fn();
    await user.click(within(region).getByRole("button", { name: "Lihat tagihan" }));
    expect(await screen.findByText("INV-2026-0001")).toBeInTheDocument();
  });

  it("leaves out the overdue clause when nothing is overdue", async () => {
    await renderWith(
      makeParent({
        invoiceSummary: { ...makeParent().invoiceSummary, unpaidCount: 2, overdueCount: 0 },
      }),
    );
    expect(strip()!.textContent).toContain("belum dibayar · 2 tagihan");
    expect(strip()!.textContent).not.toContain("lewat tempo");
  });

  it("names the missing document and offers Unggah to an editor", async () => {
    const user = await renderWith(makeParent({ ...HEALTHY, hasKtp: true, hasKk: false }));
    const region = strip()!;
    expect(within(region).getByText("KK belum diunggah")).toBeInTheDocument();
    expect(within(region).queryByText(/belum dibayar/)).not.toBeInTheDocument();

    Element.prototype.scrollIntoView = vi.fn();
    await user.click(within(region).getByRole("button", { name: "Unggah" }));
    expect(await screen.findByText(/Unggah KK/)).toBeInTheDocument();
  });

  it("says KTP dan KK when both are missing, with no Unggah for a read-only viewer", async () => {
    await renderWith(makeParent({ ...HEALTHY, hasKtp: false, hasKk: false, canEdit: false }));
    const region = strip()!;
    expect(within(region).getByText("KTP dan KK belum diunggah")).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: "Unggah" })).not.toBeInTheDocument();
  });

  it("flags a wali with no linked student", async () => {
    await renderWith(makeParent({ ...HEALTHY, guardians: [] }));
    expect(within(strip()!).getByText("Belum tertaut ke siswa")).toBeInTheDocument();
  });

  it("renders no strip at all when nothing needs attention", async () => {
    await renderWith(makeParent(HEALTHY));
    expect(strip()).not.toBeInTheDocument();
    expect(screen.queryByText("Perlu perhatian")).not.toBeInTheDocument();
  });
});

describe("guardian page — header", () => {
  it("puts the phone and the WhatsApp / Telepon buttons in the header", async () => {
    await renderWith(makeParent());
    expect(screen.getByText("1 siswa · 081234567890")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/6281234567890");
    expect(screen.getByRole("link", { name: "Telepon" })).toHaveAttribute("href", "tel:081234567890");
    // The old rail card is gone.
    expect(screen.queryByText("Kontak Cepat")).not.toBeInTheDocument();
  });

  it("shows no contact buttons and no phone for a wali without a number", async () => {
    await renderWith(makeParent({ phone: null, whatsapp: null }));
    expect(screen.getByText("1 siswa")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "WhatsApp" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Telepon" })).not.toBeInTheDocument();
  });

  it("labels the edit action Edit, and hides it without canEdit", async () => {
    await renderWith(makeParent());
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ubah" })).not.toBeInTheDocument();
  });

  it("hides Edit for a viewer who cannot edit", async () => {
    await renderWith(makeParent({ canEdit: false }));
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("Edit opens the form in Data Wali, even when that section was collapsed", async () => {
    const user = await renderWith(makeParent());
    Element.prototype.scrollIntoView = vi.fn();
    await user.click(trigger("profile"));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("button", { name: "Simpan Perubahan" })).toBeInTheDocument();
  });
});

describe("guardian page — Data Wali", () => {
  it("renders an empty field as 'Belum diisi' instead of hiding it", async () => {
    await renderWith(makeParent({ email: null, incomeRange: null }));
    const profile = document.getElementById("profile")!;
    const email = within(profile).getByText("Email").closest("div")!;
    expect(within(email).getByText("Belum diisi")).toBeInTheDocument();
    const income = within(profile).getByText("Penghasilan").closest("div")!;
    expect(within(income).getByText("Belum diisi")).toBeInTheDocument();
    // Filled fields still read normally, grouped under their headings.
    expect(within(profile).getByText("Kontak")).toBeInTheDocument();
    expect(within(profile).getByText("Identitas")).toBeInTheDocument();
    expect(within(profile).getByText("Pekerjaan", { selector: "h3" })).toBeInTheDocument();
    expect(within(profile).getByText("S1")).toBeInTheDocument();
  });

  it("keeps the NIK masked until revealed", async () => {
    await renderWith(makeParent());
    const profile = document.getElementById("profile")!;
    expect(within(profile).queryByText("3201010101010001")).not.toBeInTheDocument();
    expect(within(profile).getByRole("button", { name: "Tampilkan NIK wali" })).toBeInTheDocument();
  });

  it("shows the office address and city only when present", async () => {
    await renderWith(makeParent({ employerAddress: null, employerCity: "Bandung" }));
    const profile = document.getElementById("profile")!;
    expect(within(profile).queryByText("Alamat Kantor")).not.toBeInTheDocument();
    expect(within(profile).getByText("Kota/Kab")).toBeInTheDocument();
  });
});

describe("guardian page — collapsed summaries", () => {
  it("summarises children and invoices once they are collapsed", async () => {
    const user = await renderWith(
      makeParent({
        guardians: [
          { id: "g1", relationship: "IBU", isPrimary: true, status: "ACTIVE", outstanding: 0, student: { id: "s1", name: "Bilal", status: "ACTIVE", gender: "L", className: "KB A" } },
          { id: "g2", relationship: "IBU", isPrimary: true, status: "ACTIVE", outstanding: 0, student: { id: "s2", name: "Aisyah", status: "ACTIVE", gender: "P", className: "KB B" } },
          { id: "g3", relationship: "IBU", isPrimary: false, status: "ACTIVE", outstanding: 0, student: { id: "s3", name: "Umar", status: "ACTIVE", gender: "L", className: "KB A" } },
          { id: "g4", relationship: "WALI", isPrimary: false, status: "ACTIVE", outstanding: 0, student: { id: "s4", name: "Zaid", status: "ACTIVE", gender: "L", className: null } },
        ],
      }),
    );

    // Open: the summary is not repeated.
    expect(screen.queryByText("4 anak · KB A, KB B")).not.toBeInTheDocument();
    await user.click(trigger("children"));
    expect(screen.getByText("4 anak · KB A, KB B")).toBeInTheDocument();

    await user.click(trigger("invoices"));
    expect(screen.getByText("Rp 400.000 belum dibayar · 1 dari 1 tagihan")).toBeInTheDocument();
  });

  it("says Tidak ada tunggakan, or Belum ada tagihan, when nothing is owed", async () => {
    const user = await renderWith(
      makeParent({ ...HEALTHY, invoiceSummary: { ...CLEAN_SUMMARY, invoiceCount: 3 } }),
    );
    await user.click(trigger("invoices"));
    expect(screen.getByText("Tidak ada tunggakan", { selector: '[data-slot="dossier-summary"]' })).toBeInTheDocument();
  });

  it("names the empty key fields of Data Wali, or says Lengkap", async () => {
    const user = await renderWith(makeParent({ email: null, address: null }));
    await user.click(trigger("profile"));
    expect(screen.getByText("Email belum diisi · Alamat belum diisi")).toBeInTheDocument();
  });

  it("says Lengkap when the key fields are all filled", async () => {
    const user = await renderWith(makeParent());
    await user.click(trigger("profile"));
    expect(screen.getByText("Lengkap", { selector: '[data-slot="dossier-summary"]' })).toBeInTheDocument();
  });
});

describe("guardian page — Anak Terdaftar", () => {
  it("shows class, gender, relationship, the amount owed and links to the student", async () => {
    await renderWith(makeParent());
    const children = document.getElementById("children")!;
    const link = within(children).getByRole("link", { name: /Ahmad Fajar/ });
    expect(link).toHaveAttribute("href", "/admin/students/s1");
    expect(within(link).getByText("Ibu")).toBeInTheDocument();
    expect(within(link).getByText("Utama")).toBeInTheDocument();
    expect(within(link).getByText("KB A · Laki-laki")).toBeInTheDocument();
    expect(within(link).getByText("Rp 400.000")).toBeInTheDocument();
  });

  it("says a child without a class is not placed, and shows no amount when nothing is owed", async () => {
    await renderWith(
      makeParent({
        guardians: [
          { id: "g1", relationship: "AYAH", isPrimary: false, status: "ACTIVE", outstanding: 0, student: { id: "s1", name: "Bilal", status: "ACTIVE", gender: null, className: null } },
        ],
      }),
    );
    const link = within(document.getElementById("children")!).getByRole("link", { name: /Bilal/ });
    expect(within(link).getByText("Belum terdaftar di kelas")).toBeInTheDocument();
    expect(within(link).queryByText(/^Rp/)).not.toBeInTheDocument();
  });

  it("keeps the empty state when no child is linked", async () => {
    await renderWith(makeParent({ ...HEALTHY, guardians: [] }));
    expect(screen.getByText("Belum ada anak terdaftar", { selector: "p, h2, h3, div" })).toBeInTheDocument();
  });
});

describe("guardian page — Tagihan", () => {
  it("leads with the total owed over every invoice and lists the rows with the child's name", async () => {
    await renderWith(makeParent());
    const invoices = document.getElementById("invoices")!;
    expect(within(invoices).getByText("Belum dibayar")).toBeInTheDocument();
    expect(within(invoices).getByText("1 dari 1 tagihan belum lunas")).toBeInTheDocument();
    expect(within(invoices).getByText(/Ahmad Fajar · 2026-01 · Rp 500\.000/)).toBeInTheDocument();
    expect(within(invoices).queryByText(/Menampilkan/)).not.toBeInTheDocument();
  });

  it("says how many rows are shown of how many, and links each child's full billing", async () => {
    const invoices = Array.from({ length: 10 }, (_, i) => ({
      id: `inv-${i}`,
      invoiceNumber: `INV-${i}`,
      periodLabel: "2026-01",
      totalDue: 100000,
      totalPaid: 0,
      status: "UNPAID",
      dueDate: null,
      studentId: "s1",
      studentName: "Ahmad Fajar",
    }));
    await renderWith(
      makeParent({
        invoices,
        invoiceSummary: { ...makeParent().invoiceSummary, invoiceCount: 25, unpaidCount: 25, outstanding: 2500000 },
      }),
    );
    const section = document.getElementById("invoices")!;
    expect(within(section).getByText("Menampilkan 10 dari 25 tagihan")).toBeInTheDocument();
    expect(within(section).getByText("Rp 2.500.000")).toBeInTheDocument();
    expect(within(section).getByText("25 dari 25 tagihan belum lunas")).toBeInTheDocument();
    const all = within(section).getByRole("link", { name: "Semua tagihan Ahmad →" });
    expect(all).toHaveAttribute("href", "/admin/students/s1#keuangan");
  });

  it("shows Belum ada tagihan when the wali has never been billed", async () => {
    await renderWith(makeParent(HEALTHY));
    expect(within(document.getElementById("invoices")!).getByText("Belum ada tagihan")).toBeInTheDocument();
  });
});

describe("guardian page — rail", () => {
  it("shows Piutang, Anak Terdaftar and Berkas tiles from the server summary", async () => {
    await renderWith(makeParent());
    const rail = screen.getByRole("complementary", { name: "Ringkasan" });
    expect(within(rail).getByText("Piutang")).toBeInTheDocument();
    expect(within(rail).getByText("Rp 400.000")).toBeInTheDocument();
    expect(within(rail).getByText("1 dari 1 tagihan belum lunas")).toBeInTheDocument();
    expect(within(rail).getByText("Anak Terdaftar")).toBeInTheDocument();
    expect(within(rail).getByText("KB A")).toBeInTheDocument();
    expect(within(rail).getByText("1/2")).toBeInTheDocument();
    expect(within(rail).getByText("KK belum diunggah")).toBeInTheDocument();
  });
});

describe("guardian page — load failures", () => {
  function stubStatus(status: number) {
    vi.stubGlobal("fetch", vi.fn(() => okJson({ error: "x" }, status)));
    render(<GuardianDetailPage params={fulfilledParams({ id: "p1" })} />);
  }

  it("404 reads as not found, with a way back to the list", async () => {
    stubStatus(404);
    expect(await screen.findByText("Wali tidak ditemukan")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Kembali ke Daftar Wali" })).toHaveAttribute("href", "/admin/guardians");
  });

  it.each([401, 403])("%i reads as no access", async (status) => {
    stubStatus(status);
    expect(await screen.findByText("Data wali tidak bisa diakses")).toBeInTheDocument();
    expect(screen.queryByText("Wali tidak ditemukan")).not.toBeInTheDocument();
  });

  it("a server error offers Coba Lagi, which refetches and shows the page", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => okJson({ error: "boom" }, 500))
      .mockImplementation(() => okJson(makeParent()));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<GuardianDetailPage params={fulfilledParams({ id: "p1" })} />);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Data wali belum bisa dimuat")).toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Coba Lagi" }));

    expect(await screen.findByRole("heading", { name: "Ibu Siti Aminah" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a network error also reads as a retryable failure", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    render(<GuardianDetailPage params={fulfilledParams({ id: "p1" })} />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: "Coba Lagi" })).toBeInTheDocument();
  });
});
