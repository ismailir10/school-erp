import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AttentionStrip } from "@/components/admin/attention-strip";
import { EMPTY_INVOICE_SUMMARY, type StudentInvoiceSummary } from "@/lib/finance/student-invoice-summary";
import { buildStudentAttentionItems } from "../attention-items";

const OWED: StudentInvoiceSummary = {
  ...EMPTY_INVOICE_SUMMARY,
  invoiceCount: 3,
  outstanding: 1250000,
  unpaidCount: 2,
  overdueCount: 1,
};

type Input = Parameters<typeof buildStudentAttentionItems>[0];

function build(over: Partial<Input> = {}) {
  const onJump = vi.fn();
  const onEnroll = vi.fn();
  const items = buildStudentAttentionItems({
    studentName: "Aisyah Putri",
    canEdit: true,
    isActive: true,
    isPlaced: true,
    invoices: { loading: false, error: false, summary: EMPTY_INVOICE_SUMMARY },
    activeGuardianCount: 2,
    hasPrimaryGuardian: true,
    missingDocs: [],
    raportDraft: 0,
    onJump,
    onEnroll,
    ...over,
  });
  return { items, onJump, onEnroll };
}

const KK = { label: "KK keluarga", section: "dokumen" };
const KTP = { label: "KTP Ibu Fatimah", href: "/admin/guardians/p-1#documents" };

const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe("buildStudentAttentionItems", () => {
  it("is empty when nothing needs attention", () => {
    expect(build().items).toEqual([]);
  });

  it("lists money, class, wali, berkas and raport in that order", () => {
    const { items } = build({
      invoices: { loading: false, error: false, summary: OWED },
      isPlaced: false,
      activeGuardianCount: 0,
      hasPrimaryGuardian: false,
      missingDocs: [KK],
      raportDraft: 2,
    });
    expect(ids(items)).toEqual(["owed", "no-class", "no-guardian", "documents", "raport"]);
  });

  it("states what is owed, how many tagihan and how many are overdue", () => {
    const { items } = build({ invoices: { loading: false, error: false, summary: OWED } });
    render(<AttentionStrip items={items} />);
    expect(screen.getByText(/belum dibayar/)).toHaveTextContent("Rp 1.250.000 belum dibayar · 2 tagihan, 1 lewat tempo");
    expect(screen.getByText("Rp 1.250.000").className).toContain("font-currency");
  });

  it("leaves out the overdue clause when none is overdue", () => {
    const { items } = build({
      invoices: { loading: false, error: false, summary: { ...OWED, overdueCount: 0 } },
    });
    render(<AttentionStrip items={items} />);
    expect(screen.getByText(/belum dibayar/)).toHaveTextContent("Rp 1.250.000 belum dibayar · 2 tagihan");
    expect(screen.getByText(/belum dibayar/)).not.toHaveTextContent("lewat tempo");
  });

  it.each([
    ["loading", { loading: true, error: false }],
    ["errored", { loading: false, error: true }],
  ])("shows no money row while invoices are %s", (_name, state) => {
    expect(ids(build({ invoices: { ...state, summary: OWED } }).items)).not.toContain("owed");
  });

  it("shows the no-class row only for an ACTIVE, unplaced child", () => {
    expect(ids(build({ isPlaced: false }).items)).toContain("no-class");
    expect(ids(build({ isPlaced: false, isActive: false }).items)).not.toContain("no-class");
    expect(ids(build({ isPlaced: false, canEdit: false }).items)).toContain("no-class");
    expect(ids(build({ isPlaced: true }).items)).not.toContain("no-class");
  });

  it("separates 'no wali utama' from 'no wali'", () => {
    const some = build({ hasPrimaryGuardian: false });
    const none = build({ activeGuardianCount: 0, hasPrimaryGuardian: false });
    render(<AttentionStrip items={[...some.items, ...none.items.map((i) => ({ ...i, id: "x" }))]} />);
    expect(screen.getByText("Belum ada wali utama")).toBeInTheDocument();
    expect(screen.getByText("Belum ada wali")).toBeInTheDocument();
  });

  it("names every missing berkas", () => {
    const { items } = build({ missingDocs: [KK, KTP] });
    render(<AttentionStrip items={items} />);
    expect(screen.getByText("Berkas belum ada: KK keluarga, KTP Ibu Fatimah")).toBeInTheDocument();
  });

  it("shows raport only when a draft exists and is known", () => {
    expect(ids(build({ raportDraft: null }).items)).not.toContain("raport");
    expect(ids(build({ raportDraft: 0 }).items)).not.toContain("raport");
    const { items } = build({ raportDraft: 2 });
    render(<AttentionStrip items={items} />);
    expect(screen.getByText("Rapor: 2 masih draf")).toBeInTheDocument();
  });

  it("gives each row one distinct, descriptive button that does the thing", async () => {
    const user = userEvent.setup();
    const { items, onJump, onEnroll } = build({
      invoices: { loading: false, error: false, summary: OWED },
      isPlaced: false,
      hasPrimaryGuardian: false,
      missingDocs: [KK],
      raportDraft: 1,
    });
    render(<AttentionStrip items={items} />);
    const region = screen.getByRole("region", { name: "Perlu perhatian" });
    const names = within(region).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names).toEqual([
      "Lihat tagihan",
      "Daftarkan ke Kelas untuk Aisyah Putri",
      "Atur wali",
      "Lengkapi berkas",
      "Buka rapor",
    ]);
    expect(new Set(names).size).toBe(names.length);

    for (const name of names) await user.click(within(region).getByRole("button", { name }));
    expect(onJump.mock.calls.map((c) => c[0])).toEqual(["keuangan", "keluarga", "dokumen", "akademik"]);
    expect(onEnroll).toHaveBeenCalledTimes(1);
  });

  it("keeps the message but drops the fix-it button for staff who cannot edit", () => {
    const { items } = build({ canEdit: false, hasPrimaryGuardian: false, missingDocs: [KK] });
    render(<AttentionStrip items={items} />);
    expect(screen.getByText("Belum ada wali utama")).toBeInTheDocument();
    expect(screen.getByText("Berkas belum ada: KK keluarga")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Atur wali" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lengkapi berkas" })).not.toBeInTheDocument();
  });

  describe("Lengkapi berkas lands where the first missing item can be fixed", () => {
    const FOTO = { label: "Foto siswa", section: "data-anak" };
    const SURAT = { label: "Surat persetujuan", section: "pendaftaran" };
    const FORM = { label: "Berkas pendaftaran (1 / 3)", section: "pendaftaran" };

    async function press(missingDocs: Input["missingDocs"]) {
      const user = userEvent.setup();
      const { items, onJump } = build({ missingDocs });
      render(<AttentionStrip items={items} />);
      const control = screen.getByTestId("attention-documents");
      await user.click(control);
      return { control, onJump };
    }

    it("Foto siswa jumps to Data Anak", async () => {
      const { onJump } = await press([FOTO, KK, KTP]);
      expect(onJump).toHaveBeenCalledExactlyOnceWith("data-anak");
    });

    it("KK keluarga jumps to Dokumen", async () => {
      const { onJump } = await press([KK, KTP]);
      expect(onJump).toHaveBeenCalledExactlyOnceWith("dokumen");
    });

    it("KTP wali is a link to that wali's documents, not a jump", async () => {
      const { control, onJump } = await press([KTP, SURAT]);
      expect(control).toHaveAttribute("href", "/admin/guardians/p-1#documents");
      expect(onJump).not.toHaveBeenCalled();
    });

    it("Surat persetujuan jumps to Pendaftaran", async () => {
      expect((await press([SURAT, FORM])).onJump).toHaveBeenCalledExactlyOnceWith("pendaftaran");
    });

    it("the paper-form checklist jumps to Pendaftaran", async () => {
      expect((await press([FORM])).onJump).toHaveBeenCalledExactlyOnceWith("pendaftaran");
    });

    it("keeps the label and lists every missing item whichever is first", () => {
      const { items } = build({ missingDocs: [FOTO, KK, KTP, SURAT] });
      render(<AttentionStrip items={items} />);
      expect(
        screen.getByText("Berkas belum ada: Foto siswa, KK keluarga, KTP Ibu Fatimah, Surat persetujuan"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("attention-documents")).toHaveTextContent("Lengkapi berkas");
    });
  });

  describe("no class", () => {
    it("shows the row with its button for staff who can edit", () => {
      const { items } = build({ isPlaced: false });
      render(<AttentionStrip items={items} />);
      expect(screen.getByText("Belum terdaftar di kelas")).toBeInTheDocument();
      expect(screen.getByTestId("attention-enroll")).toBeInTheDocument();
    });

    it("shows the fact without a button to a read-only viewer", () => {
      const { items } = build({ isPlaced: false, canEdit: false });
      render(<AttentionStrip items={items} />);
      expect(screen.getByText("Belum terdaftar di kelas")).toBeInTheDocument();
      expect(screen.queryByTestId("attention-enroll")).not.toBeInTheDocument();
    });

    it("stays absent for a student who is not active", () => {
      expect(ids(build({ isPlaced: false, isActive: false }).items)).not.toContain("no-class");
    });
  });
});
