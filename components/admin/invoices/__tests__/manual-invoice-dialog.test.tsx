/**
 * `ManualInvoiceDialog` — migrated to react-hook-form + zod (cycle
 * 2026-09-27-admin-forms-rhf, T5). Replaces the old pure-function
 * `validateManualForm` unit tests (removed along with that function) with
 * component-level assertions: an empty/partial submit shows inline field
 * errors and never calls the API, and a filled-in submit posts the exact
 * body the server expects.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { toast } from "sonner";
import { ManualInvoiceDialog } from "../manual-invoice-dialog";

const FEE_COMPONENT = { id: "fc-1", label: "SPP Bulanan", isEnabled: true, status: "ACTIVE" };
const STUDENT = { id: "stu-1", name: "Ahmad Fauzi", nickname: null, nis: "12345" };

const OTHER_COMPONENT = { id: "fc-2", label: "Uang Pangkal", isEnabled: true, status: "ACTIVE" };

type PostResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function fixture({
  withFeeComponent = true,
  withSecondComponent = false,
  invoicePosts = [],
}: {
  withFeeComponent?: boolean;
  withSecondComponent?: boolean;
  /** Responses for successive POST /api/invoices calls; the default 201 follows. */
  invoicePosts?: PostResponse[];
} = {}) {
  const queued = [...invoicePosts];
  const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => {
    if (input.startsWith("/api/fee-components")) {
      const list = withFeeComponent ? [FEE_COMPONENT, ...(withSecondComponent ? [OTHER_COMPONENT] : [])] : [];
      return { ok: true, json: async () => list };
    }
    if (input.startsWith("/api/students")) {
      return { ok: true, json: async () => ({ data: [STUDENT], pagination: { total: 1 } }) };
    }
    if (input.startsWith("/api/invoices")) {
      const next = queued.shift();
      if (next) return next;
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: "inv-1", xenditPaymentUrl: null, xenditError: undefined, lines: [] }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ManualInvoiceDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows inline errors and sends no request on an empty/incomplete submit", async () => {
    // No active fee component in the fixture — the first line's
    // feeComponentId pre-fill effect has nothing to select, so it stays
    // blank and its own required error surfaces too.
    const fetchMock = fixture({ withFeeComponent: false });
    const user = userEvent.setup();
    render(<ManualInvoiceDialog open onOpenChange={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Buat Tagihan" }));

    expect(await screen.findByText("Pilih siswa terlebih dahulu")).toBeInTheDocument();
    expect(screen.getByText("Pilih komponen biaya pada setiap baris")).toBeInTheDocument();
    expect(screen.getByText("Jumlah pada setiap baris harus lebih dari 0")).toBeInTheDocument();

    expect(
      fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/invoices")),
    ).toBe(false);
  });

  it("sends the expected POST method + body on a valid submit", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<ManualInvoiceDialog open onOpenChange={vi.fn()} />);

    // Fee component pre-fills asynchronously once /api/fee-components resolves.
    await waitFor(() => expect(screen.getAllByRole("combobox")[1]).toHaveTextContent(FEE_COMPONENT.label));

    const studentTrigger = screen.getAllByRole("combobox")[0]!;
    await user.click(studentTrigger);
    const search = await screen.findByPlaceholderText("Cari nama siswa...");
    await user.type(search, "Ahmad");
    const option = await screen.findByRole("option", { name: new RegExp(STUDENT.name) });
    await user.click(option);
    await expect.poll(() => studentTrigger.textContent).toContain(STUDENT.name);

    const amountInput = screen.getByLabelText(/^Jumlah 1/);
    await user.type(amountInput, "100000");

    await user.click(screen.getByRole("button", { name: "Buat Tagihan" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/invoices"))).toBe(true);
    });

    const call = fetchMock.mock.calls.find(([url]) => String(url).startsWith("/api/invoices"))!;
    const [, init] = call;
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.studentId).toBe(STUDENT.id);
    expect(body.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.lines).toEqual([{ feeComponentId: FEE_COMPONENT.id, amount: 100000 }]);
  });

  it("keeps the Total row in step with every typed amount (FIN-1)", async () => {
    fixture();
    const user = userEvent.setup();
    render(<ManualInvoiceDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("combobox")[1]).toHaveTextContent(FEE_COMPONENT.label));

    const totalRow = () => screen.getByText("Total").parentElement!;
    expect(totalRow()).toHaveTextContent("Rp 0");

    // No blur / no extra re-render between edits: Total must follow the keystrokes.
    await user.type(screen.getByLabelText(/^Jumlah 1/), "1500000");
    expect(totalRow()).toHaveTextContent("Rp 1.500.000");

    await user.click(screen.getByRole("button", { name: "Tambah Komponen" }));
    await user.type(screen.getByLabelText(/^Jumlah 2/), "250000");
    expect(totalRow()).toHaveTextContent("Rp 1.750.000");

    await user.clear(screen.getByLabelText(/^Jumlah 1/));
    expect(totalRow()).toHaveTextContent("Rp 250.000");
  });

  it("shows an inline duplicate-line error and sends no request when two lines pick the same component", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<ManualInvoiceDialog open onOpenChange={vi.fn()} />);

    // The array-level duplicate check only runs once the rest of the schema
    // (studentId included) has already parsed cleanly — a manualInvoiceFormSchema
    // ZodEffects only invokes its `superRefine` when the object it wraps
    // parsed without issues — so a student must be picked for this to
    // isolate the duplicate-lines error rather than masking it.
    const studentTrigger = screen.getAllByRole("combobox")[0]!;
    await user.click(studentTrigger);
    const search = await screen.findByPlaceholderText("Cari nama siswa...");
    await user.type(search, "Ahmad");
    const option = await screen.findByRole("option", { name: new RegExp(STUDENT.name) });
    await user.click(option);
    await expect.poll(() => studentTrigger.textContent).toContain(STUDENT.name);

    // Line 1 auto-fills to the only active fee component.
    await waitFor(() => expect(screen.getAllByRole("combobox")[1]).toHaveTextContent(FEE_COMPONENT.label));
    await user.type(screen.getByLabelText(/^Jumlah 1/), "100000");

    // Adding a second line defaults its component to the same (only) active
    // one — an instant duplicate, no Select interaction needed to reproduce it.
    await user.click(screen.getByRole("button", { name: "Tambah Komponen" }));
    await waitFor(() => expect(screen.getAllByRole("combobox")[2]).toHaveTextContent(FEE_COMPONENT.label));
    await user.type(screen.getByLabelText(/^Jumlah 2/), "50000");

    await user.click(screen.getByRole("button", { name: "Buat Tagihan" }));

    expect(await screen.findByText("Komponen biaya tidak boleh duplikat")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/invoices")),
    ).toBe(false);
  });

  it("clears the duplicate-line error once a different component is picked (FIN-2)", async () => {
    fixture({ withSecondComponent: true });
    const user = userEvent.setup();
    render(<ManualInvoiceDialog open onOpenChange={vi.fn()} />);

    const studentTrigger = screen.getAllByRole("combobox")[0]!;
    await user.click(studentTrigger);
    await user.type(await screen.findByPlaceholderText("Cari nama siswa..."), "Ahmad");
    await user.click(await screen.findByRole("option", { name: new RegExp(STUDENT.name) }));
    await expect.poll(() => studentTrigger.textContent).toContain(STUDENT.name);

    await waitFor(() => expect(screen.getAllByRole("combobox")[1]).toHaveTextContent(FEE_COMPONENT.label));
    await user.type(screen.getByLabelText(/^Jumlah 1/), "100000");
    await user.click(screen.getByRole("button", { name: "Tambah Komponen" }));
    await waitFor(() => expect(screen.getAllByRole("combobox")[2]).toHaveTextContent(FEE_COMPONENT.label));
    await user.type(screen.getByLabelText(/^Jumlah 2/), "50000");
    await user.click(screen.getByRole("button", { name: "Buat Tagihan" }));
    expect(await screen.findByText("Komponen biaya tidak boleh duplikat")).toBeInTheDocument();

    // Picking a different component for line 2 fixes the duplicate — the stale
    // banner must disappear without another submit.
    await user.click(screen.getAllByRole("combobox")[2]!);
    await user.click(await screen.findByRole("option", { name: OTHER_COMPONENT.label }));
    await waitFor(() =>
      expect(screen.queryByText("Komponen biaya tidak boleh duplikat")).not.toBeInTheDocument(),
    );
  });

  it("adds and removes line rows", async () => {
    fixture({ withFeeComponent: false });
    const user = userEvent.setup();
    render(<ManualInvoiceDialog open onOpenChange={vi.fn()} />);

    expect(await screen.findAllByLabelText(/^Jumlah \d+/)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Hapus baris 1" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Tambah Komponen" }));
    expect(screen.getAllByLabelText(/^Jumlah \d+/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Hapus baris 1" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Hapus baris 2" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Hapus baris 2" }));
    expect(screen.getAllByLabelText(/^Jumlah \d+/)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Hapus baris 1" })).toBeDisabled();
  });

  describe("billing the wali", () => {
    const invoicePosts = (fetchMock: ReturnType<typeof fixture>) =>
      fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/invoices"));
    const postBody = (call: ReturnType<typeof invoicePosts>[number]) => JSON.parse(call[1]?.body as string);

    async function fillValidInvoice(user: ReturnType<typeof userEvent.setup>) {
      await waitFor(() => expect(screen.getAllByRole("combobox")[1]).toHaveTextContent(FEE_COMPONENT.label));
      const studentTrigger = screen.getAllByRole("combobox")[0]!;
      await user.click(studentTrigger);
      await user.type(await screen.findByPlaceholderText("Cari nama siswa..."), "Ahmad");
      await user.click(await screen.findByRole("option", { name: new RegExp(STUDENT.name) }));
      await expect.poll(() => studentTrigger.textContent).toContain(STUDENT.name);
      await user.type(screen.getByLabelText(/^Jumlah 1/), "100000");
    }

    it("has no Sudah dibayar option and none of its payment fields", async () => {
      fixture();
      render(<ManualInvoiceDialog open onOpenChange={vi.fn()} />);
      await screen.findByRole("button", { name: "Buat Tagihan" });

      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.queryByText(/Sudah dibayar/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Tanggal bayar/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Referensi")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Simpan sebagai lunas" })).not.toBeInTheDocument();
    });

    it("posts only studentId, periodLabel, dueDate and lines", async () => {
      const fetchMock = fixture();
      const user = userEvent.setup();
      render(<ManualInvoiceDialog open onOpenChange={vi.fn()} />);
      await fillValidInvoice(user);

      await user.click(screen.getByRole("button", { name: "Buat Tagihan" }));
      await waitFor(() => expect(invoicePosts(fetchMock)).toHaveLength(1));
      const body = postBody(invoicePosts(fetchMock)[0]!);
      expect(Object.keys(body).sort()).toEqual(["dueDate", "lines", "periodLabel", "studentId"]);
    });

    it("steers the Periode label toward a descriptive name", async () => {
      fixture();
      render(<ManualInvoiceDialog open onOpenChange={vi.fn()} />);
      expect(
        await screen.findByText(
          "Contoh: April 2026. Untuk biaya sekali bayar, tulis nama biayanya, mis. Biaya Sekolah Tahap 1 TA 2027/2028.",
        ),
      ).toBeInTheDocument();
    });

    it("toasts the payment link with a Salin Link action and navigates to the invoice", async () => {
      fixture({
        invoicePosts: [
          { ok: true, status: 201, json: async () => ({ id: "inv-9", xenditPaymentUrl: "https://pay.example/9" }) },
        ],
      });
      const onCreated = vi.fn();
      const user = userEvent.setup();
      render(<ManualInvoiceDialog open onOpenChange={vi.fn()} onCreated={onCreated} />);
      await fillValidInvoice(user);
      await user.click(screen.getByRole("button", { name: "Buat Tagihan" }));

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin/invoices/inv-9"));
      expect(toast.success).toHaveBeenCalledWith(
        "Tagihan dibuat",
        expect.objectContaining({ action: expect.objectContaining({ label: "Salin Link" }) }),
      );
      expect(onCreated).toHaveBeenCalledTimes(1);
    });

    it("warns when the invoice was created but the link failed", async () => {
      fixture({
        invoicePosts: [
          { ok: true, status: 201, json: async () => ({ id: "inv-8", xenditError: "unknown: x" }) },
        ],
      });
      const user = userEvent.setup();
      render(<ManualInvoiceDialog open onOpenChange={vi.fn()} />);
      await fillValidInvoice(user);
      await user.click(screen.getByRole("button", { name: "Buat Tagihan" }));

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin/invoices/inv-8"));
      expect(toast.warning).toHaveBeenCalledTimes(1);
    });
  });
});
