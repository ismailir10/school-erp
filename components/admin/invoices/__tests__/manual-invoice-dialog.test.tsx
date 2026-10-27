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
import { getTodayInTimezone } from "@/lib/attendance/timezone";
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

  describe("Sudah dibayar", () => {
    const today = () => getTodayInTimezone("Asia/Jakarta");
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

    const failure = (status: number, body: unknown): PostResponse => ({
      ok: false,
      status,
      json: async () => body,
    });

    it("shows no Sudah dibayar control and posts no payment without canRecordPayment", async () => {
      const fetchMock = fixture();
      const user = userEvent.setup();
      render(<ManualInvoiceDialog open onOpenChange={vi.fn()} />);
      await fillValidInvoice(user);

      expect(screen.queryByRole("checkbox", { name: /Sudah dibayar/ })).not.toBeInTheDocument();
      expect(screen.queryByText("Tanggal bayar")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Buat Tagihan" }));
      await waitFor(() => expect(invoicePosts(fetchMock)).toHaveLength(1));
      const body = postBody(invoicePosts(fetchMock)[0]!);
      expect(body).not.toHaveProperty("payment");
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

    it("reveals Metode, Tanggal bayar, Referensi, Catatan and flips the button label when ticked", async () => {
      fixture();
      const user = userEvent.setup();
      render(<ManualInvoiceDialog open onOpenChange={vi.fn()} canRecordPayment />);

      const box = await screen.findByRole("checkbox", { name: /Sudah dibayar/ });
      expect(
        screen.getByText("Tagihan langsung Lunas. Tidak ada link pembayaran dan tidak ada email ke wali."),
      ).toBeInTheDocument();
      expect(screen.queryByText("Tanggal bayar")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Buat Tagihan" })).toBeInTheDocument();

      await user.click(box);

      expect(screen.getByText(/^Metode/)).toBeInTheDocument();
      expect(screen.getByText(/^Tanggal bayar/)).toBeInTheDocument();
      expect(screen.getByLabelText("Referensi")).toBeInTheDocument();
      expect(screen.getByLabelText("Catatan")).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: /Metode/ })).toHaveTextContent("Tunai");
      expect(screen.getByText(/sama dengan total tagihan/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Simpan sebagai lunas" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Buat Tagihan" })).not.toBeInTheDocument();

      await user.click(box);
      expect(screen.queryByText(/^Tanggal bayar/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Buat Tagihan" })).toBeInTheDocument();
    });

    it("shows the amount that will be recorded as the invoice total", async () => {
      fixture();
      const user = userEvent.setup();
      render(<ManualInvoiceDialog open onOpenChange={vi.fn()} canRecordPayment />);
      await waitFor(() => expect(screen.getAllByRole("combobox")[1]).toHaveTextContent(FEE_COMPONENT.label));

      await user.type(screen.getByLabelText(/^Jumlah 1/), "1500000");
      await user.click(await screen.findByRole("checkbox", { name: /Sudah dibayar/ }));

      expect(screen.getByText(/Jumlah dibayar:/).parentElement ?? document.body).toHaveTextContent(
        "Jumlah dibayar: Rp 1.500.000, sama dengan total tagihan.",
      );
    });

    it("sends payment with a uuid key, CASH, today's date and the lines, then toasts paid and navigates", async () => {
      const fetchMock = fixture();
      const onCreated = vi.fn();
      const onOpenChange = vi.fn();
      const user = userEvent.setup();
      render(<ManualInvoiceDialog open onOpenChange={onOpenChange} onCreated={onCreated} canRecordPayment />);
      await fillValidInvoice(user);

      await user.click(screen.getByRole("checkbox", { name: /Sudah dibayar/ }));
      await user.type(screen.getByLabelText("Referensi"), "  KWT-001 ");
      await user.click(screen.getByRole("button", { name: "Simpan sebagai lunas" }));

      await waitFor(() => expect(invoicePosts(fetchMock)).toHaveLength(1));
      const body = postBody(invoicePosts(fetchMock)[0]!);
      expect(body.lines).toEqual([{ feeComponentId: FEE_COMPONENT.id, amount: 100000 }]);
      expect(body.payment).toEqual({
        idempotencyKey: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
        method: "CASH",
        paidAt: today(),
        reference: "KWT-001",
        notes: null,
      });
      // The amount is never sent: the server pays the total it derives.
      expect(body.payment).not.toHaveProperty("amount");

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin/invoices/inv-1"));
      expect(toast.success).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.success).mock.calls[0]).toEqual(["Tagihan dibuat dan dicatat lunas"]);
      expect(toast.warning).not.toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onCreated).toHaveBeenCalledTimes(1);
    });

    it("does not send the paid fields after the box is unticked again", async () => {
      const fetchMock = fixture();
      const user = userEvent.setup();
      render(<ManualInvoiceDialog open onOpenChange={vi.fn()} canRecordPayment />);
      await fillValidInvoice(user);

      const box = screen.getByRole("checkbox", { name: /Sudah dibayar/ });
      await user.click(box);
      await user.type(screen.getByLabelText("Referensi"), "KWT-001");
      await user.click(box);
      await user.click(screen.getByRole("button", { name: "Buat Tagihan" }));

      await waitFor(() => expect(invoicePosts(fetchMock)).toHaveLength(1));
      expect(postBody(invoicePosts(fetchMock)[0]!)).not.toHaveProperty("payment");
    });

    it("reuses the same idempotency key when the first attempt fails and the admin retries", async () => {
      const fetchMock = fixture({
        invoicePosts: [failure(500, { error: "Internal Server Error" })],
      });
      const user = userEvent.setup();
      render(<ManualInvoiceDialog open onOpenChange={vi.fn()} canRecordPayment />);
      await fillValidInvoice(user);
      await user.click(screen.getByRole("checkbox", { name: /Sudah dibayar/ }));

      await user.click(screen.getByRole("button", { name: "Simpan sebagai lunas" }));
      await waitFor(() => expect(invoicePosts(fetchMock)).toHaveLength(1));
      // Failed attempt: dialog stays, root error shown.
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole("button", { name: "Simpan sebagai lunas" })).toBeEnabled());

      await user.click(screen.getByRole("button", { name: "Simpan sebagai lunas" }));
      await waitFor(() => expect(invoicePosts(fetchMock)).toHaveLength(2));

      const [first, second] = invoicePosts(fetchMock).map(postBody);
      expect(first.payment.idempotencyKey).toBe(second.payment.idempotencyKey);
    });

    it("generates a fresh key after the dialog is closed and reopened", async () => {
      const fetchMock = fixture({
        invoicePosts: [failure(500, { error: "Internal Server Error" })],
      });
      const user = userEvent.setup();
      const { rerender } = render(<ManualInvoiceDialog open onOpenChange={vi.fn()} canRecordPayment />);
      await fillValidInvoice(user);
      await user.click(screen.getByRole("checkbox", { name: /Sudah dibayar/ }));
      await user.click(screen.getByRole("button", { name: "Simpan sebagai lunas" }));
      await waitFor(() => expect(invoicePosts(fetchMock)).toHaveLength(1));

      rerender(<ManualInvoiceDialog open={false} onOpenChange={vi.fn()} canRecordPayment />);
      rerender(<ManualInvoiceDialog open onOpenChange={vi.fn()} canRecordPayment />);
      await fillValidInvoice(user);
      await user.click(screen.getByRole("checkbox", { name: /Sudah dibayar/ }));
      await user.click(screen.getByRole("button", { name: "Simpan sebagai lunas" }));
      await waitFor(() => expect(invoicePosts(fetchMock)).toHaveLength(2));

      const [first, second] = invoicePosts(fetchMock).map(postBody);
      expect(first.payment.idempotencyKey).not.toBe(second.payment.idempotencyKey);
    });

    it("lands a server payment.paidAt error on the Tanggal bayar field", async () => {
      fixture({
        invoicePosts: [
          failure(400, {
            error: "Validasi gagal",
            errors: [{ field: "payment.paidAt", message: "Tanggal bayar tidak boleh di masa depan." }],
          }),
        ],
      });
      const user = userEvent.setup();
      render(<ManualInvoiceDialog open onOpenChange={vi.fn()} canRecordPayment />);
      await fillValidInvoice(user);
      await user.click(screen.getByRole("checkbox", { name: /Sudah dibayar/ }));
      await user.click(screen.getByRole("button", { name: "Simpan sebagai lunas" }));

      const message = await screen.findByText("Tanggal bayar tidak boleh di masa depan.");
      expect(message).toHaveAttribute("id", "manual-invoice-paid-at-error");
      expect(pushMock).not.toHaveBeenCalled();
    });

    it("shows a clear Indonesian root error when the server refuses payments.record", async () => {
      fixture({
        invoicePosts: [failure(403, { error: "forbidden", missing: "payments.record" })],
      });
      const user = userEvent.setup();
      render(<ManualInvoiceDialog open onOpenChange={vi.fn()} canRecordPayment />);
      await fillValidInvoice(user);
      await user.click(screen.getByRole("checkbox", { name: /Sudah dibayar/ }));
      await user.click(screen.getByRole("button", { name: "Simpan sebagai lunas" }));

      expect(await screen.findByText(/Anda belum punya izin mencatat pembayaran/)).toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
    });

    it("defaults Tanggal bayar to today and requires it", async () => {
      fixture();
      const user = userEvent.setup();
      render(<ManualInvoiceDialog open onOpenChange={vi.fn()} canRecordPayment />);
      await user.click(await screen.findByRole("checkbox", { name: /Sudah dibayar/ }));

      const trigger = document.getElementById("manual-invoice-paid-at")!;
      expect(trigger).toHaveAttribute("aria-required", "true");
      expect(trigger).not.toHaveTextContent("Pilih tanggal");
    });

    it("keeps the unpaid success path: link toast with a Salin Link action", async () => {
      const fetchMock = fixture({
        invoicePosts: [
          { ok: true, status: 201, json: async () => ({ id: "inv-9", xenditPaymentUrl: "https://pay.example/9" }) },
        ],
      });
      const user = userEvent.setup();
      render(<ManualInvoiceDialog open onOpenChange={vi.fn()} canRecordPayment />);
      await fillValidInvoice(user);
      await user.click(screen.getByRole("button", { name: "Buat Tagihan" }));

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin/invoices/inv-9"));
      expect(postBody(invoicePosts(fetchMock)[0]!)).not.toHaveProperty("payment");
      expect(toast.success).toHaveBeenCalledWith(
        "Tagihan dibuat",
        expect.objectContaining({ action: expect.objectContaining({ label: "Salin Link" }) }),
      );
    });
  });
});
