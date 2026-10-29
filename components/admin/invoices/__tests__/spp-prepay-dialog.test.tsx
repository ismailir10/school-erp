/**
 * `SppPrepayDialog` ("Catat SPP di muka", cycle 2026-10-27-paid-invoice-spp-prepay, T6).
 * Student pick -> preview -> confirm. The backend contract (preview + confirm
 * routes) is stubbed with `fetch`; the picker is driven through its real UI like
 * the manual-invoice dialog test does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { toast } from "sonner";
import { SppPrepayDialog } from "../spp-prepay-dialog";

const STUDENT = { id: "stu-1", name: "Ahmad Fauzi", nickname: null, nis: "12345" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = {
  year: number;
  month: number;
  periodLabel: string;
  dueDate: string;
  action: "CREATE" | "SETTLE" | "SKIP_PAID";
  amount: number;
  invoiceIds: string[];
  hadLink: boolean;
  linkExpiresAt: string | null;
  beforeFirstBilling: boolean;
};

function row(over: Partial<Row> & Pick<Row, "month" | "periodLabel" | "action" | "amount">): Row {
  return {
    year: 2026,
    dueDate: "2026-12-31",
    invoiceIds: [],
    hadLink: false,
    linkExpiresAt: null,
    beforeFirstBilling: false,
    ...over,
  };
}

function previewBody(over: Record<string, unknown> = {}) {
  return {
    student: { id: STUDENT.id, name: STUDENT.name },
    academicYear: { id: "ay-1", name: "2026/2027", from: "2026-07", to: "2027-06" },
    range: { from: "2026-07", to: "2027-06" },
    program: "KB",
    rows: [
      row({ month: 7, periodLabel: "Juli 2026", action: "CREATE", amount: 1000000, beforeFirstBilling: true }),
      row({ month: 10, periodLabel: "Oktober 2026", action: "SKIP_PAID", amount: 0, invoiceIds: ["i-oct"] }),
      row({
        month: 11,
        periodLabel: "November 2026",
        action: "SETTLE",
        amount: 800000,
        invoiceIds: ["i-nov"],
        hadLink: true,
        linkExpiresAt: "2026-11-05T10:00:00.000Z",
      }),
      row({ month: 12, periodLabel: "Desember 2026", action: "CREATE", amount: 1000000 }),
    ],
    total: 2800000,
    issues: [],
    blocked: false,
    fingerprint: "fp-1",
    ...over,
  };
}

type Reply = { status?: number; body: unknown };

function fixture({
  previews = [{ body: previewBody() }],
  confirms = [{ status: 201, body: { replayed: false, created: 2, settled: 1, skipped: 1, total: 2800000, reference: "r", invoiceIds: [] } }],
}: { previews?: Reply[]; confirms?: Reply[] } = {}) {
  let p = 0;
  let c = 0;
  const reply = (r: Reply) => {
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body };
  };
  const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/students")) {
      return { ok: true, json: async () => ({ data: [STUDENT], pagination: { total: 1 } }) };
    }
    if (url === "/api/invoices/spp-prepay/preview") {
      return reply(previews[Math.min(p++, previews.length - 1)]!);
    }
    if (url === "/api/invoices/spp-prepay") {
      return reply(confirms[Math.min(c++, confirms.length - 1)]!);
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const calls = (f: ReturnType<typeof fixture>, url: string) => f.mock.calls.filter(([u]) => String(u) === url);
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

async function pickStudent(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getAllByRole("combobox")[0]!;
  await user.click(trigger);
  await user.type(await screen.findByPlaceholderText("Cari nama siswa..."), "Ahmad");
  await user.click(await screen.findByRole("option", { name: new RegExp(STUDENT.name) }));
  await expect.poll(() => trigger.textContent).toContain(STUDENT.name);
}

describe("SppPrepayDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("previews on student pick: default range, three action labels, notes and the total", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);

    // Nothing to confirm yet.
    expect(screen.getByRole("button", { name: "Catat lunas" })).toBeDisabled();

    await pickStudent(user);

    const table = await screen.findByRole("table", { name: /Rincian SPP Ahmad Fauzi/ });
    // First look asks for the academic-year default: no from/to in the body.
    expect(bodyOf(calls(f, "/api/invoices/spp-prepay/preview")[0]!)).toEqual({ studentId: STUDENT.id });

    expect(within(table).getAllByText("Buat & lunasi")).toHaveLength(2);
    expect(within(table).getByText("Lunasi tagihan yang ada")).toBeInTheDocument();
    expect(within(table).getByText("Sudah lunas, dilewati")).toBeInTheDocument();
    expect(within(table).getByText("Belum pernah ditagih di sistem ini")).toBeInTheDocument();
    expect(within(table).getByText("Rp 800.000")).toBeInTheDocument();
    expect(within(table).getByText("Rp 2.800.000")).toBeInTheDocument();

    // The selects defaulted to the whole academic year.
    const [, from, to] = screen.getAllByRole("combobox");
    expect(from).toHaveTextContent("Juli 2026");
    expect(to).toHaveTextContent("Juni 2027");

    expect(await screen.findByRole("button", { name: "Catat Rp 2.800.000 lunas" })).toBeEnabled();
  });

  it("re-runs the preview with the chosen range", async () => {
    const f = fixture({
      previews: [
        { body: previewBody() },
        { body: previewBody({ range: { from: "2026-07", to: "2026-12" }, total: 1000000, rows: [] }) },
      ],
    });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);
    await screen.findByRole("table");

    await user.click(screen.getAllByRole("combobox")[2]!);
    await user.click(await screen.findByRole("option", { name: "Desember 2026" }));

    await waitFor(() => expect(calls(f, "/api/invoices/spp-prepay/preview")).toHaveLength(2));
    expect(bodyOf(calls(f, "/api/invoices/spp-prepay/preview")[1]!)).toEqual({
      studentId: STUDENT.id,
      from: "2026-07",
      to: "2026-12",
    });
  });

  it("blocks a student without a program: says where to fix it and offers no confirm", async () => {
    fixture({
      previews: [
        {
          body: previewBody({
            rows: [],
            total: 0,
            program: null,
            blocked: true,
            issues: [
              {
                code: "NO_PROGRAM",
                blocking: true,
                message:
                  "Siswa belum punya kelas di tahun ajaran ini, jadi SPP belum bisa dihitung. Daftarkan ke kelas lebih dulu.",
              },
            ],
          }),
        },
      ],
    });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);

    expect(await screen.findByText(/Siswa belum punya kelas di tahun ajaran ini/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "halaman Siswa" })).toHaveAttribute("href", "/admin/students");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Catat lunas" })).toBeDisabled();
  });

  it("disables the confirm and shows a destructive alert for any blocking issue", async () => {
    fixture({
      previews: [
        {
          body: previewBody({
            blocked: true,
            issues: [{ code: "NO_PRICE", blocking: true, message: "Mei 2027 belum punya tarif." }],
          }),
        },
      ],
    });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);

    expect(await screen.findByText("Mei 2027 belum punya tarif.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Catat Rp .* lunas$/ })).toBeDisabled();
  });

  it("lists non-blocking issues in a calm alert without disabling the confirm", async () => {
    fixture({
      previews: [
        {
          body: previewBody({
            issues: [{ code: "UNPARSABLE_LABEL", blocking: false, message: "Label tagihan INV-9 tidak terbaca." }],
          }),
        },
      ],
    });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);

    expect(await screen.findByText("Label tagihan INV-9 tidak terbaca.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Catat Rp 2.800.000 lunas" })).toBeEnabled();
  });

  it("names the invoice under a caution that points at one, with a link that opens it in a new tab", async () => {
    const message =
      'Tagihan lunas dengan label "SPMB Tahap 1" memuat SPP tetapi tidak menyebut satu bulan, jadi bulan-bulannya tidak terbaca. Pastikan SPP bulan-bulan itu belum dibayar sebelum mencatat.';
    fixture({
      previews: [
        {
          body: previewBody({
            issues: [
              {
                code: "UNPARSABLE_LABEL",
                blocking: false,
                message,
                invoiceId: "inv-uuid-1",
                invoice: {
                  id: "inv-uuid-1",
                  invoiceNumber: "INV-2026-0123",
                  periodLabel: "SPMB Tahap 1",
                  status: "PAID",
                  totalDue: 3000000,
                  monthlyAmount: 1650000,
                },
              },
              { code: "MULTIPLE_MONTHLY_INVOICES", blocking: false, message: "Ada 2 tagihan SPP untuk Oktober 2026." },
            ],
          }),
        },
      ],
    });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);

    const warning = (await screen.findByText(/Perlu diperiksa/)).closest("[data-slot=alert]") as HTMLElement;
    const items = within(warning).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // The message reads exactly as before; the details sit beneath it.
    expect(within(items[0]).getByText(message)).toBeInTheDocument();
    expect(items[0]).toHaveTextContent(
      "INV-2026-0123 · SPMB Tahap 1 · Lunas · Rp 3.000.000 (SPP di dalamnya Rp 1.650.000)",
    );
    const link = within(items[0]).getByRole("link", { name: "Buka tagihan INV-2026-0123 di tab baru" });
    expect(link).toHaveAttribute("href", "/admin/invoices/inv-uuid-1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    // A caution without an invoice is just its message.
    expect(items[1]).toHaveTextContent(/^Ada 2 tagihan SPP untuk Oktober 2026\.$/);
    expect(within(items[1]).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Catat Rp 2.800.000 lunas" })).toBeEnabled();
  });

  it("leaves blocking issues as plain messages even when they carry an invoice", async () => {
    fixture({
      previews: [
        {
          body: previewBody({
            blocked: true,
            issues: [
              {
                code: "NO_PRICE",
                blocking: true,
                message: "Mei 2027 belum punya tarif.",
                invoice: {
                  id: "inv-uuid-2",
                  invoiceNumber: "INV-2026-0999",
                  periodLabel: "Mei 2027",
                  status: "SENT",
                  totalDue: 500000,
                  monthlyAmount: 500000,
                },
              },
            ],
          }),
        },
      ],
    });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);

    expect(await screen.findByText("Mei 2027 belum punya tarif.")).toBeInTheDocument();
    expect(screen.queryByText(/INV-2026-0999/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Buka tagihan/ })).not.toBeInTheDocument();
  });

  it("warns that a settled invoice's old payment link stays live until it expires", async () => {
    fixture();
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);

    const warning = await screen.findByText(/Minta wali tidak membayar VA dari email/);
    // 2026-11-05T10:00Z is 17:00 WIB.
    expect(warning).toHaveTextContent(/aktif sampai 5 Nov 2026 · 17\.00 WIB/);
  });

  it("shows no link warning when no settled invoice had a link", async () => {
    fixture({
      previews: [
        {
          body: previewBody({
            rows: [row({ month: 11, periodLabel: "November 2026", action: "SETTLE", amount: 800000, invoiceIds: ["i"] })],
            total: 800000,
          }),
        },
      ],
    });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);
    await screen.findByRole("table");
    expect(screen.queryByText(/Minta wali tidak membayar VA/)).not.toBeInTheDocument();
  });

  it("submits the preview's range and fingerprint with a uuid key, then closes, toasts and reports", async () => {
    const f = fixture();
    const onOpenChange = vi.fn();
    const onRecorded = vi.fn();
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={onOpenChange} onRecorded={onRecorded} />);
    await pickStudent(user);

    await user.click(await screen.findByRole("button", { name: "Catat Rp 2.800.000 lunas" }));

    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    const [call] = calls(f, "/api/invoices/spp-prepay");
    expect((call![1] as RequestInit).method).toBe("POST");
    const body = bodyOf(call!);
    expect(body).toMatchObject({
      studentId: STUDENT.id,
      from: "2026-07",
      to: "2027-06",
      method: "CASH",
      fingerprint: "fp-1",
    });
    expect(body.paidAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.idempotencyKey).toMatch(UUID);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith("SPP di muka tercatat: 2 tagihan dibuat, 1 dilunasi");
  });

  it("reuses the same idempotency key when the same open retries after a failure", async () => {
    const f = fixture({
      confirms: [
        { status: 500, body: { error: "Terjadi kendala di server. Coba lagi sebentar lagi." } },
        { status: 201, body: { replayed: false, created: 2, settled: 1 } },
      ],
    });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);

    const submit = await screen.findByRole("button", { name: "Catat Rp 2.800.000 lunas" });
    await user.click(submit);
    await waitFor(() => expect(calls(f, "/api/invoices/spp-prepay")).toHaveLength(1));
    await screen.findByText("Terjadi kendala di server. Coba lagi sebentar lagi.");

    await user.click(screen.getByRole("button", { name: "Catat Rp 2.800.000 lunas" }));
    await waitFor(() => expect(calls(f, "/api/invoices/spp-prepay")).toHaveLength(2));

    const [first, second] = calls(f, "/api/invoices/spp-prepay").map(bodyOf);
    expect(first.idempotencyKey).toMatch(UUID);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("uses a new idempotency key after the dialog is closed and reopened", async () => {
    const f = fixture({
      confirms: [
        { status: 500, body: { error: "Terjadi kendala di server. Coba lagi sebentar lagi." } },
        { status: 500, body: { error: "Terjadi kendala di server. Coba lagi sebentar lagi." } },
      ],
    });
    const user = userEvent.setup();
    const { rerender } = render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);
    await user.click(await screen.findByRole("button", { name: "Catat Rp 2.800.000 lunas" }));
    await waitFor(() => expect(calls(f, "/api/invoices/spp-prepay")).toHaveLength(1));

    rerender(<SppPrepayDialog open={false} onOpenChange={vi.fn()} />);
    rerender(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);
    await user.click(await screen.findByRole("button", { name: "Catat Rp 2.800.000 lunas" }));
    await waitFor(() => expect(calls(f, "/api/invoices/spp-prepay")).toHaveLength(2));

    const [first, second] = calls(f, "/api/invoices/spp-prepay").map(bodyOf);
    expect(second.idempotencyKey).toMatch(UUID);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("on PREVIEW_STALE shows the server message and refetches the preview for the admin to confirm", async () => {
    const message = "Data tagihan berubah sejak pratinjau. Muat ulang pratinjau lalu coba lagi.";
    const f = fixture({
      previews: [{ body: previewBody() }, { body: previewBody({ total: 1800000, fingerprint: "fp-2" }) }],
      confirms: [{ status: 409, body: { error: message, code: "PREVIEW_STALE" } }],
    });
    const onOpenChange = vi.fn();
    const onRecorded = vi.fn();
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={onOpenChange} onRecorded={onRecorded} />);
    await pickStudent(user);

    await user.click(await screen.findByRole("button", { name: "Catat Rp 2.800.000 lunas" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    await waitFor(() => expect(calls(f, "/api/invoices/spp-prepay/preview")).toHaveLength(2));
    // The fresh numbers are on screen, and nothing was recorded or closed.
    expect(await screen.findByRole("button", { name: "Catat Rp 1.800.000 lunas" })).toBeEnabled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onRecorded).not.toHaveBeenCalled();
    // The refetch kept the admin's range.
    expect(bodyOf(calls(f, "/api/invoices/spp-prepay/preview")[1]!)).toEqual({
      studentId: STUDENT.id,
      from: "2026-07",
      to: "2027-06",
    });
  });

  it("shows the server message on NOTHING_TO_RECORD and stays open", async () => {
    const message = "Semua bulan sudah lunas, tidak ada yang perlu dicatat.";
    fixture({ confirms: [{ status: 409, body: { error: message, code: "NOTHING_TO_RECORD" } }] });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={onOpenChange} />);
    await pickStudent(user);

    await user.click(await screen.findByRole("button", { name: "Catat Rp 2.800.000 lunas" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
