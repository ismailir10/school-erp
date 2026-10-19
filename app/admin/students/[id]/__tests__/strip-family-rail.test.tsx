/**
 * The first screen of the student page: "Perlu perhatian", the family contact
 * row and the slim desktop rail — what each shows, what each button does, and
 * that nothing money-shaped appears before the invoices have answered.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StudentDetailPage from "@/app/admin/students/[id]/page";
import {
  INVOICES_OWED,
  OVERVIEW,
  ResizeObserverStub,
  makeGuardian,
  makeStudent,
  stubFetch,
  urlsMatching,
} from "./student-fixture";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "s1" }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/admin/class-section-picker", () => ({
  ClassSectionCombobox: () => <select aria-label="kelas stub" />,
}));

const OVERVIEW_DRAFT = { ...OVERVIEW, raport: { published: 0, draft: 2, total: 2, current: null } };
// A KK on file (via the primary wali) leaves only the photo missing.
const NO_PHOTO = { photoUrl: null };

async function renderLoaded(opts: Parameters<typeof stubFetch>[0] = {}) {
  const { fn, calls } = stubFetch(opts);
  vi.stubGlobal("fetch", fn);
  render(<StudentDetailPage />);
  await screen.findByRole("heading", { level: 1, name: "Aisyah Putri" });
  return { calls };
}

const strip = () => screen.queryByRole("region", { name: "Perlu perhatian" });
const scrolledTo = () =>
  (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts.map((el: Element) => el.id);
const expanded = (id: string) => document.querySelector(`[aria-controls="${id}-content"]`)?.getAttribute("aria-expanded");

describe("student page — Perlu perhatian", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    Element.prototype.scrollIntoView = vi.fn();
    window.location.hash = "";
  });

  it("is absent when nothing needs attention", async () => {
    await renderLoaded({
      overview: { ...OVERVIEW, raport: { published: 2, draft: 0, total: 2, current: null } },
      invoices: [INVOICES_OWED[2]],
    });
    await waitFor(() => expect(screen.getAllByText("18/20").length).toBeGreaterThan(0));
    expect(strip()).toBeNull();
  });

  it("lists the money owed first, with amount, count and overdue count", async () => {
    await renderLoaded({ invoices: INVOICES_OWED });
    const region = await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(within(region).getByText(/belum dibayar/)).toHaveTextContent(
      "Rp 1.250.000 belum dibayar · 2 tagihan, 1 lewat tempo",
    );
  });

  it("shows no money row while the invoices are still loading", async () => {
    await renderLoaded({ invoicesPending: true, student: makeStudent(NO_PHOTO) });
    const region = await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(within(region).queryByText(/belum dibayar/)).not.toBeInTheDocument();
    expect(within(region).getByText(/Berkas belum ada/)).toBeInTheDocument();
  });

  it("shows no money row when the invoices fail", async () => {
    await renderLoaded({ invoiceStatus: 500, student: makeStudent(NO_PHOTO) });
    const region = await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(within(region).queryByText(/belum dibayar/)).not.toBeInTheDocument();
  });

  it("Lihat tagihan scrolls to Keuangan", async () => {
    const user = userEvent.setup();
    await renderLoaded({ invoices: INVOICES_OWED });
    await user.click(await screen.findByRole("button", { name: "Lihat tagihan" }));
    await waitFor(() => expect(scrolledTo()).toContain("keuangan"));
    expect(expanded("group-keuangan")).toBe("true");
  });

  it("names the child with no class and opens the enrol dialog from its own button", async () => {
    const user = userEvent.setup();
    await renderLoaded({ student: makeStudent({ enrollments: [] }) });
    const region = await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(within(region).getByText("Belum terdaftar di kelas")).toBeInTheDocument();
    // The header carries the same words; the strip's button has a longer name, so they are told apart.
    expect(screen.getAllByRole("button", { name: /Daftarkan ke Kelas/ })).toHaveLength(2);
    await user.click(within(region).getByRole("button", { name: "Daftarkan ke Kelas untuk Aisyah Putri" }));
    expect(await screen.findByRole("dialog", { name: "Daftarkan ke Kelas" })).toBeInTheDocument();
  });

  it("does not offer the no-class row for a withdrawn child", async () => {
    await renderLoaded({ student: makeStudent({ status: "WITHDRAWN", enrollments: [] }) });
    expect(strip()?.textContent ?? "").not.toContain("Belum terdaftar di kelas");
  });

  it("says Belum ada wali utama when active wali exist but none is primary, and Atur wali jumps to Keluarga", async () => {
    const user = userEvent.setup();
    await renderLoaded({
      student: makeStudent({
        guardians: [makeGuardian({ id: "p1", name: "Fatimah Rahman", isPrimary: false })],
      }),
    });
    const region = await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(within(region).getByText("Belum ada wali utama")).toBeInTheDocument();
    await user.click(within(region).getByRole("button", { name: "Atur wali" }));
    await waitFor(() => expect(scrolledTo()).toContain("keluarga"));
  });

  it("says Belum ada wali when there is none at all", async () => {
    await renderLoaded({ student: makeStudent({ guardians: [] }) });
    const region = await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(within(region).getByText("Belum ada wali")).toBeInTheDocument();
  });

  it("names the missing berkas and Lengkapi berkas jumps to Dokumen", async () => {
    const user = userEvent.setup();
    await renderLoaded({
      student: makeStudent({
        photoUrl: null,
        guardians: [
          makeGuardian({ id: "p1", name: "Fatimah Rahman", isPrimary: true, hasKk: false, hasKtp: false }),
        ],
      }),
    });
    const region = await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(within(region).getByText("Berkas belum ada: Foto siswa, KK keluarga, KTP Fatimah Rahman")).toBeInTheDocument();
    await user.click(within(region).getByRole("button", { name: "Lengkapi berkas" }));
    await waitFor(() => expect(scrolledTo()).toContain("dokumen"));
  });

  it("lists a draft raport and Buka raport opens Akademik, fetching it once", async () => {
    const user = userEvent.setup();
    const { calls } = await renderLoaded({ overview: OVERVIEW_DRAFT });
    const region = await screen.findByRole("region", { name: "Perlu perhatian" });
    await waitFor(() => expect(within(region).getByText("Raport: 2 masih draf")).toBeInTheDocument());
    expect(urlsMatching(calls, "/academics")).toHaveLength(0);

    await user.click(within(region).getByRole("button", { name: "Buka raport" }));
    await waitFor(() => expect(urlsMatching(calls, "/academics")).toHaveLength(1));
    expect(expanded("group-kelas")).toBe("true");
    expect(expanded("akademik")).toBe("true");
    await waitFor(() => expect(scrolledTo()).toContain("akademik"));
  });

  it("keeps the rows in order: money, class, wali, berkas, raport", async () => {
    await renderLoaded({
      student: makeStudent({ enrollments: [], photoUrl: null, guardians: [] }),
      invoices: INVOICES_OWED,
      overview: OVERVIEW_DRAFT,
    });
    const region = await screen.findByRole("region", { name: "Perlu perhatian" });
    await waitFor(() => expect(within(region).getAllByRole("listitem")).toHaveLength(5));
    expect(within(region).getAllByRole("listitem").map((li) => li.textContent?.split("·")[0].replace(/\s+/g, " ").trim().slice(0, 12))).toEqual([
      "Rp 1.250.000",
      "Belum terdaf",
      "Belum ada wa",
      "Berkas belum",
      "Raport: 2 ma",
    ]);
  });

  it("hides the fix-it buttons from staff who cannot edit but keeps the facts", async () => {
    await renderLoaded({ student: makeStudent({ canEdit: false, enrollments: [], photoUrl: null }) });
    const region = await screen.findByRole("region", { name: "Perlu perhatian" });
    expect(within(region).getByText(/Berkas belum ada/)).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: "Lengkapi berkas" })).not.toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: /Daftarkan ke Kelas/ })).not.toBeInTheDocument();
  });
});

describe("student page — family contact", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("shows the wali utama with relationship, number, WhatsApp and Telepon", async () => {
    await renderLoaded();
    const family = screen.getByRole("region", { name: "Kontak keluarga" });
    expect(family).toHaveTextContent("Fatimah Rahman");
    expect(family).toHaveTextContent("Ibu · Wali utama");
    expect(within(family).getByText("081255501234")).toBeInTheDocument();
    expect(within(family).getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/6281255501234");
    expect(within(family).getByRole("link", { name: "Telepon" })).toHaveAttribute("href", "tel:081255501234");
  });

  it("falls back to the first active wali when none is primary", async () => {
    await renderLoaded({
      student: makeStudent({
        guardians: [
          makeGuardian({ id: "p-off", name: "Wali Nonaktif", status: "INACTIVE", isPrimary: true }),
          makeGuardian({ id: "p-ayah", name: "Hadi Rahman", relationship: "AYAH" }),
        ],
      }),
    });
    const family = screen.getByRole("region", { name: "Kontak keluarga" });
    expect(family).toHaveTextContent("Hadi Rahman");
    expect(family).not.toHaveTextContent("Wali Nonaktif");
    expect(family).toHaveTextContent("1 wali · Lihat semua");
  });

  it("'N wali · Lihat semua' jumps to Keluarga & Wali", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.click(screen.getByRole("button", { name: "2 wali · Lihat semua" }));
    await waitFor(() =>
      expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts.map((e: Element) => e.id)).toContain("keluarga"),
    );
  });

  it("shows no contact buttons when the number is unusable, and no dead link", async () => {
    await renderLoaded({
      student: makeStudent({
        guardians: [makeGuardian({ id: "p1", name: "Fatimah Rahman", isPrimary: true, phone: null, whatsapp: null })],
      }),
    });
    const family = screen.getByRole("region", { name: "Kontak keluarga" });
    expect(within(family).queryByRole("link")).not.toBeInTheDocument();
    expect(within(family).getByRole("button", { name: "1 wali · Lihat semua" })).toBeInTheDocument();
  });

  it("renders nothing for a child without a wali", async () => {
    await renderLoaded({ student: makeStudent({ guardians: [] }) });
    expect(screen.queryByRole("region", { name: "Kontak keluarga" })).not.toBeInTheDocument();
  });

  it("sits directly under the strip, above the section nav", async () => {
    await renderLoaded({ invoices: INVOICES_OWED });
    const stripEl = await screen.findByRole("region", { name: "Perlu perhatian" });
    const family = screen.getByRole("region", { name: "Kontak keluarga" });
    const nav = screen.getByRole("navigation", { name: "Bagian halaman" });
    expect(stripEl.compareDocumentPosition(family) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(family.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("student page — slim rail", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("holds Tunggakan, Hadir bulan ini and Raport tiles plus Jejak, and nothing of the old rail", async () => {
    await renderLoaded({ invoices: INVOICES_OWED });
    const rail = screen.getByLabelText("Ringkasan", { selector: "aside" });
    expect(rail.className).toContain("hidden");
    expect(rail.className).toContain("lg:flex");
    await waitFor(() => expect(within(rail).getByText("18/20")).toBeInTheDocument());
    for (const label of ["Tunggakan", "Hadir bulan ini", "Raport"]) {
      expect(within(rail).getByText(label)).toBeInTheDocument();
    }
    expect(within(rail).getByText("Rp 1.250.000")).toBeInTheDocument();
    expect(within(rail).getByText("Jejak")).toBeInTheDocument();
    for (const gone of ["Usia", "Kelas Aktif", "Wali Aktif", "Berkas", "Ringkasan", "Kontak Cepat", "Kelengkapan Berkas"]) {
      expect(within(rail).queryByText(gone)).not.toBeInTheDocument();
    }
  });

  it("shows Memuat… in the Tunggakan tile while invoices load", async () => {
    await renderLoaded({ invoicesPending: true });
    const rail = screen.getByLabelText("Ringkasan", { selector: "aside" });
    expect(within(rail).getByText("Tunggakan")).toBeInTheDocument();
    expect(within(rail).getAllByText("Memuat…").length).toBeGreaterThan(0);
    expect(within(rail).queryByText("Rp 0")).not.toBeInTheDocument();
  });

  it("is the only place the numbers appear: no tile block above the sections", async () => {
    await renderLoaded({ invoices: INVOICES_OWED });
    // Exactly one "Hadir bulan ini" on the page, and it lives in the rail.
    const labels = screen.getAllByText("Hadir bulan ini");
    expect(labels).toHaveLength(1);
    expect(labels[0].closest("aside")).not.toBeNull();
  });
});
