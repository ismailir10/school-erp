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
    missingDocLabels: [],
    raportDraft: 0,
    onJump,
    onEnroll,
    ...over,
  });
  return { items, onJump, onEnroll };
}

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
      missingDocLabels: ["KK keluarga"],
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

  it("shows the no-class row only for an ACTIVE, unplaced child the viewer can edit", () => {
    expect(ids(build({ isPlaced: false }).items)).toContain("no-class");
    expect(ids(build({ isPlaced: false, isActive: false }).items)).not.toContain("no-class");
    expect(ids(build({ isPlaced: false, canEdit: false }).items)).not.toContain("no-class");
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
    const { items } = build({ missingDocLabels: ["KK keluarga", "KTP Ibu Fatimah"] });
    render(<AttentionStrip items={items} />);
    expect(screen.getByText("Berkas belum ada: KK keluarga, KTP Ibu Fatimah")).toBeInTheDocument();
  });

  it("shows raport only when a draft exists and is known", () => {
    expect(ids(build({ raportDraft: null }).items)).not.toContain("raport");
    expect(ids(build({ raportDraft: 0 }).items)).not.toContain("raport");
    const { items } = build({ raportDraft: 2 });
    render(<AttentionStrip items={items} />);
    expect(screen.getByText("Raport: 2 masih draf")).toBeInTheDocument();
  });

  it("gives each row one distinct, descriptive button that does the thing", async () => {
    const user = userEvent.setup();
    const { items, onJump, onEnroll } = build({
      invoices: { loading: false, error: false, summary: OWED },
      isPlaced: false,
      hasPrimaryGuardian: false,
      missingDocLabels: ["KK keluarga"],
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
      "Buka raport",
    ]);
    expect(new Set(names).size).toBe(names.length);

    for (const name of names) await user.click(within(region).getByRole("button", { name }));
    expect(onJump.mock.calls.map((c) => c[0])).toEqual(["keuangan", "keluarga", "dokumen", "akademik"]);
    expect(onEnroll).toHaveBeenCalledTimes(1);
  });

  it("keeps the message but drops the fix-it button for staff who cannot edit", () => {
    const { items } = build({ canEdit: false, hasPrimaryGuardian: false, missingDocLabels: ["KK keluarga"] });
    render(<AttentionStrip items={items} />);
    expect(screen.getByText("Belum ada wali utama")).toBeInTheDocument();
    expect(screen.getByText("Berkas belum ada: KK keluarga")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Atur wali" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lengkapi berkas" })).not.toBeInTheDocument();
  });
});
