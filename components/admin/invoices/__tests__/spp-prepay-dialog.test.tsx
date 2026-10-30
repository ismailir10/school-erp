/**
 * `SppPrepayDialog` ("Catat pembayaran di muka"): cycle 2026-10-27-paid-invoice-spp-prepay (SPP months)
 * extended by 2026-10-30-prepay-other-fees (one-time fees, "Tanpa SPP", T4).
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

const COMPONENTS = [
  { id: "fc-pangkal", label: "Uang Pangkal", sortOrder: 1, prefillAmount: 5000000 },
  { id: "fc-sarana", label: "Sarana", sortOrder: 2, prefillAmount: 1500000 },
  { id: "fc-seragam", label: "Seragam", sortOrder: 3, prefillAmount: null },
];
const LABEL = "Biaya Sekolah Tahap 1 TA 2027/2028";
const NO_PROGRAM_MESSAGE =
  "Siswa belum punya kelas di tahun ajaran ini, jadi SPP belum bisa dihitung. Daftarkan ke kelas lebih dulu.";

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

/** A preview of the whole academic year for a student with a program (SPP part chosen). */
function previewBody(over: Record<string, unknown> = {}) {
  return {
    student: { id: STUDENT.id, name: STUDENT.name },
    academicYear: { id: "ay-1", name: "2026/2027", from: "2026-07", to: "2027-06" },
    range: { from: "2026-07", to: "2027-06" },
    program: "KB",
    spp: { available: true, reason: null, defaultRange: { from: "2026-07", to: "2027-06" } },
    oneTimeComponents: COMPONENTS,
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
    sppTotal: 2800000,
    otherFees: null,
    total: 2800000,
    issues: [],
    blocked: false,
    fingerprint: "fp-1",
    ...over,
  };
}

/** A preview for a student without a program: SPP cannot be chosen, nothing is planned. */
function noProgramBody(over: Record<string, unknown> = {}) {
  return previewBody({
    range: null,
    program: null,
    spp: {
      available: false,
      reason: { code: "NO_PROGRAM", message: NO_PROGRAM_MESSAGE },
      defaultRange: { from: "2026-07", to: "2027-06" },
    },
    rows: [],
    sppTotal: 0,
    total: 0,
    ...over,
  });
}

type Reply = { status?: number; body: unknown };
type RequestBody = {
  studentId: string;
  from?: string;
  to?: string;
  otherFees?: { label: string; lines: { feeComponentId: string; amount: number }[] };
};

/** Answers a preview the way the route would: SPP rows only when `from`/`to` are sent, plus the one-time invoice. */
function plan(base: ReturnType<typeof previewBody>) {
  return (req: RequestBody): Reply => {
    const sppOn = !!req.from && !!req.to;
    const other = req.otherFees
      ? {
          label: req.otherFees.label,
          lines: req.otherFees.lines.map((l) => ({
            ...l,
            label: COMPONENTS.find((c) => c.id === l.feeComponentId)!.label,
          })),
          total: req.otherFees.lines.reduce((sum, l) => sum + l.amount, 0),
        }
      : null;
    const sppTotal = sppOn ? (base.sppTotal as number) : 0;
    return {
      body: {
        ...base,
        range: sppOn ? { from: req.from, to: req.to } : null,
        rows: sppOn ? base.rows : [],
        sppTotal,
        otherFees: other,
        total: sppTotal + (other?.total ?? 0),
      },
    };
  };
}

function fixture({
  previews,
  respond = plan(previewBody()),
  confirms = [{ status: 201, body: { replayed: false, created: 2, settled: 1, skipped: 1, total: 2800000, reference: "r", invoiceIds: [], otherFees: null } }],
}: { previews?: Reply[]; respond?: (req: RequestBody) => Reply; confirms?: Reply[] } = {}) {
  let p = 0;
  let c = 0;
  const reply = (r: Reply) => {
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body };
  };
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/students")) {
      return { ok: true, json: async () => ({ data: [STUDENT], pagination: { total: 1 } }) };
    }
    if (url === "/api/invoices/spp-prepay/preview") {
      if (previews) return reply(previews[Math.min(p++, previews.length - 1)]!);
      return reply(respond(JSON.parse(init?.body as string) as RequestBody));
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
const previewBodies = (f: ReturnType<typeof fixture>) => calls(f, "/api/invoices/spp-prepay/preview").map(bodyOf);

type User = ReturnType<typeof userEvent.setup>;

async function pickStudent(user: User) {
  const trigger = screen.getAllByRole("combobox")[0]!;
  await user.click(trigger);
  await user.type(await screen.findByPlaceholderText("Cari nama siswa..."), "Ahmad");
  await user.click(await screen.findByRole("option", { name: new RegExp(STUDENT.name) }));
  await expect.poll(() => trigger.textContent).toContain(STUDENT.name);
}

/** Add a one-time line: click "Tambah biaya", then pick a component in that line's select. */
async function addLine(user: User, index: number, componentLabel: string) {
  await user.click(await screen.findByRole("button", { name: "Tambah biaya" }));
  await user.click(await waitFor(() => document.getElementById(`spp-prepay-component-${index}`)!));
  await user.click(await screen.findByRole("option", { name: componentLabel }));
}

const amountInput = (index: number) => document.getElementById(`spp-prepay-amount-${index}`) as HTMLInputElement;

async function setAmount(user: User, index: number, digits: string) {
  const input = amountInput(index);
  await user.clear(input);
  await user.type(input, digits);
}

async function setLabel(user: User, value: string) {
  await user.type(await screen.findByLabelText(/^Periode/), value);
}

describe("SppPrepayDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("is titled Catat Pembayaran di Muka and says it records SPP and other school fees", () => {
    fixture();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Catat Pembayaran di Muka" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Catat pembayaran yang sudah diterima: SPP beberapa bulan dan biaya sekolah lainnya. Tagihan langsung Lunas, tanpa link pembayaran dan tanpa email.",
      ),
    ).toBeInTheDocument();
  });

  it("previews on student pick: no-parts look first, then the default range, action labels, notes and the total", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);

    // Nothing to confirm yet.
    expect(screen.getByRole("button", { name: "Catat lunas" })).toBeDisabled();

    await pickStudent(user);

    const table = await screen.findByRole("table", { name: /Rincian pembayaran di muka Ahmad Fauzi/ });
    // First look has no parts (it learns the components and whether SPP is available); then the academic-year default.
    expect(previewBodies(f)).toEqual([
      { studentId: STUDENT.id },
      { studentId: STUDENT.id, from: "2026-07", to: "2027-06" },
    ]);

    expect(within(table).getAllByText("Buat & lunasi")).toHaveLength(2);
    expect(within(table).getByText("Lunasi tagihan yang ada")).toBeInTheDocument();
    expect(within(table).getByText("Sudah lunas, dilewati")).toBeInTheDocument();
    expect(within(table).getByText("Belum pernah ditagih di sistem ini")).toBeInTheDocument();
    expect(within(table).getByText("Rp 800.000")).toBeInTheDocument();
    expect(within(table).getByText("Rp 2.800.000")).toBeInTheDocument();

    // SPP is the chosen part and the selects defaulted to the whole academic year.
    expect(screen.getByRole("radio", { name: "Catat SPP beberapa bulan" })).toBeChecked();
    const [, from, to] = screen.getAllByRole("combobox");
    expect(from).toHaveTextContent("Juli 2026");
    expect(to).toHaveTextContent("Juni 2027");

    expect(await screen.findByRole("button", { name: "Catat Rp 2.800.000 lunas" })).toBeEnabled();
  });

  it("re-runs the preview with the chosen range", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);
    await screen.findByRole("table");

    await user.click(screen.getAllByRole("combobox")[2]!);
    await user.click(await screen.findByRole("option", { name: "Desember 2026" }));

    await waitFor(() => expect(previewBodies(f)).toHaveLength(3));
    expect(previewBodies(f)[2]).toEqual({ studentId: STUDENT.id, from: "2026-07", to: "2026-12" });
  });

  it("never asks for an inverted range: says so on the field and offers no confirm", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);
    await screen.findByRole("table");

    await user.click(screen.getAllByRole("combobox")[1]!);
    await user.click(await screen.findByRole("option", { name: "Desember 2026" }));
    await user.click(screen.getAllByRole("combobox")[2]!);
    await user.click(await screen.findByRole("option", { name: "Oktober 2026" }));

    expect(await screen.findByText("Bulan akhir tidak boleh sebelum bulan awal")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Catat lunas" })).toBeDisabled();
    // Only the two student-pick requests (no-parts look, default range) and nothing for the inverted range.
    await new Promise((r) => setTimeout(r, 500));
    expect(previewBodies(f).every((b) => !b.from || b.from <= (b.to ?? ""))).toBe(true);
  });

  describe("a student without a program", () => {
    it("disables SPP with the reason and a link to Siswa, selects Tanpa SPP and asks only once", async () => {
      const f = fixture({ respond: plan(noProgramBody()) });
      const user = userEvent.setup();
      render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
      await pickStudent(user);

      expect(await screen.findByText(new RegExp(NO_PROGRAM_MESSAGE))).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "halaman Siswa" })).toHaveAttribute("href", "/admin/students");
      expect(screen.getByRole("radio", { name: "Catat SPP beberapa bulan" })).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByRole("radio", { name: "Tanpa SPP" })).toBeChecked();
      // No month range to pick, and no table: only the student-only look.
      expect(screen.getAllByRole("combobox")[1]).toBeDisabled();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(previewBodies(f)).toEqual([{ studentId: STUDENT.id }]);
      expect(screen.getByRole("button", { name: "Catat lunas" })).toBeDisabled();
      expect(screen.getByText("Pilih bulan SPP atau tambahkan biaya lainnya.")).toBeInTheDocument();
    });

    it("records only a one-time fee: prefilled and editable amount, a label, no from/to in the confirm", async () => {
      const f = fixture({
        respond: plan(noProgramBody()),
        confirms: [
          {
            status: 201,
            body: {
              replayed: false,
              created: 0,
              settled: 0,
              skipped: 0,
              total: 4000000,
              invoiceIds: ["inv-1"],
              otherFees: { invoiceId: "inv-1", invoiceNumber: "INV-2027-0001", total: 4000000 },
            },
          },
        ],
      });
      const onOpenChange = vi.fn();
      const onRecorded = vi.fn();
      const user = userEvent.setup();
      render(<SppPrepayDialog open onOpenChange={onOpenChange} onRecorded={onRecorded} />);
      await pickStudent(user);
      await screen.findByText(new RegExp(NO_PROGRAM_MESSAGE));

      await addLine(user, 0, "Uang Pangkal");
      // Prefilled from the program fee table as an ordinary value, and editable.
      await waitFor(() => expect(amountInput(0)).toHaveValue("5.000.000"));
      await setAmount(user, 0, "4000000");
      expect(amountInput(0)).toHaveValue("4.000.000");
      // The Periode field shows once there is a line, steering to a descriptive label.
      expect(screen.getByText(/Beri nama biayanya, mis\. "Biaya Sekolah Tahap 1 TA 2027\/2028"/)).toBeInTheDocument();
      await setLabel(user, LABEL);

      const table = await screen.findByRole("table");
      expect(within(table).getByText(LABEL)).toBeInTheDocument();
      expect(within(table).getByText("Uang Pangkal Rp 4.000.000")).toBeInTheDocument();
      expect(within(table).getByText("Buat & lunasi")).toBeInTheDocument();
      expect(within(table).getAllByText("Rp 4.000.000")).toHaveLength(2);

      await user.click(await screen.findByRole("button", { name: "Catat Rp 4.000.000 lunas" }));
      await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));

      const body = bodyOf(calls(f, "/api/invoices/spp-prepay")[0]!);
      expect(body).toMatchObject({
        studentId: STUDENT.id,
        otherFees: { label: LABEL, lines: [{ feeComponentId: "fc-pangkal", amount: 4000000 }] },
        method: "CASH",
        fingerprint: "fp-1",
      });
      expect(body).not.toHaveProperty("from");
      expect(body).not.toHaveProperty("to");
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(toast.success).toHaveBeenCalledWith(
        "Pembayaran di muka tercatat: biaya lainnya tagihan INV-2027-0001 lunas",
      );
    });

    it("leaves the amount empty for a component with no fee-table price", async () => {
      fixture({ respond: plan(noProgramBody()) });
      const user = userEvent.setup();
      render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
      await pickStudent(user);
      await screen.findByText(new RegExp(NO_PROGRAM_MESSAGE));

      await addLine(user, 0, "Seragam");
      expect(amountInput(0)).toHaveValue("");
    });
  });

  it("records SPP and a one-time fee together: both parts in the body, the grand total on the button", async () => {
    const f = fixture({
      confirms: [
        {
          status: 201,
          body: {
            replayed: false,
            created: 2,
            settled: 1,
            skipped: 1,
            total: 4300000,
            invoiceIds: [],
            otherFees: { invoiceId: "inv-9", invoiceNumber: "INV-2027-0009", total: 1500000 },
          },
        },
      ],
    });
    const onRecorded = vi.fn();
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} onRecorded={onRecorded} />);
    await pickStudent(user);
    await screen.findByRole("table");

    await addLine(user, 0, "Sarana");
    await waitFor(() => expect(amountInput(0)).toHaveValue("1.500.000"));
    await setLabel(user, LABEL);

    // SPP rows + the new invoice, and the grand total sums both.
    const table = await screen.findByRole("table");
    await within(table).findByText(LABEL);
    expect(within(table).getByText("Desember 2026")).toBeInTheDocument();
    expect(within(table).getAllByText("Rp 4.300.000")).toHaveLength(1);
    await user.click(await screen.findByRole("button", { name: "Catat Rp 4.300.000 lunas" }));
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));

    const body = bodyOf(calls(f, "/api/invoices/spp-prepay")[0]!);
    expect(body).toMatchObject({
      studentId: STUDENT.id,
      from: "2026-07",
      to: "2027-06",
      otherFees: { label: LABEL, lines: [{ feeComponentId: "fc-sarana", amount: 1500000 }] },
      fingerprint: "fp-1",
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Pembayaran di muka tercatat: SPP 2 tagihan dibuat, 1 dilunasi; biaya lainnya tagihan INV-2027-0009 lunas",
    );
  });

  it("offers each component once: a line cannot pick what another line holds", async () => {
    fixture();
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);
    await screen.findByRole("table");

    await addLine(user, 0, "Uang Pangkal");
    await user.click(screen.getByRole("button", { name: "Tambah biaya" }));
    await user.click(await waitFor(() => document.getElementById("spp-prepay-component-1")!));
    expect(await screen.findByRole("option", { name: "Sarana" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Seragam" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Uang Pangkal" })).not.toBeInTheDocument();
  });

  it("removes a line, and with it the Periode field", async () => {
    fixture();
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);
    await screen.findByRole("table");

    await addLine(user, 0, "Sarana");
    expect(await screen.findByLabelText(/^Periode/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hapus biaya 1" }));
    expect(screen.queryByLabelText(/^Periode/)).not.toBeInTheDocument();
    expect(screen.getByText("Belum ada biaya lainnya.")).toBeInTheDocument();
  });

  it("stops adding lines when every component is used", async () => {
    fixture({ respond: plan(previewBody({ oneTimeComponents: COMPONENTS.slice(0, 1) })) });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);
    await screen.findByRole("table");

    await addLine(user, 0, "Uang Pangkal");
    expect(screen.getByRole("button", { name: "Tambah biaya" })).toBeDisabled();
  });

  it("with neither part chosen, says what to do and disables the confirm", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);
    await screen.findByRole("table");

    await user.click(screen.getByRole("radio", { name: "Tanpa SPP" }));

    expect(await screen.findByText("Pilih bulan SPP atau tambahkan biaya lainnya.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Catat lunas" })).toBeDisabled();
    // The month selects stop mattering.
    expect(screen.getAllByRole("combobox")[1]).toBeDisabled();
    await waitFor(() => expect(previewBodies(f).at(-1)).toEqual({ studentId: STUDENT.id }));
    expect(screen.getByRole("button", { name: "Catat lunas" })).toBeDisabled();
    expect(calls(f, "/api/invoices/spp-prepay")).toHaveLength(0);
  });

  it("explains an unfinished one-time line instead of leaving the confirm silently disabled", async () => {
    fixture({ respond: plan(noProgramBody()) });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);
    await screen.findByText(new RegExp(NO_PROGRAM_MESSAGE));

    await addLine(user, 0, "Uang Pangkal");

    expect(
      await screen.findByText("Lengkapi komponen, jumlah, dan Periode pada biaya lainnya untuk melihat rincian."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Catat lunas" })).toBeDisabled();
  });

  it("puts a server error about the Periode label on that field and stays open", async () => {
    const message = 'Gunakan label yang menjelaskan biaya, mis. "Biaya Sekolah Tahap 1 TA 2027/2028", bukan nama bulan.';
    fixture({
      respond: plan(noProgramBody()),
      confirms: [
        {
          status: 400,
          body: { error: "Data tidak valid", errors: [{ field: "otherFees.label", message }] },
        },
      ],
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={onOpenChange} />);
    await pickStudent(user);
    await screen.findByText(new RegExp(NO_PROGRAM_MESSAGE));
    await addLine(user, 0, "Uang Pangkal");
    await setLabel(user, "Januari 2027");

    await user.click(await screen.findByRole("button", { name: "Catat Rp 5.000.000 lunas" }));

    const labelField = await screen.findByLabelText(/^Periode/);
    await waitFor(() => expect(labelField).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("puts a server error about a line's amount on that line", async () => {
    const message = "Jumlah pada setiap baris harus lebih dari 0";
    fixture({
      respond: plan(noProgramBody()),
      confirms: [
        {
          status: 400,
          body: { error: "Data tidak valid", errors: [{ field: "otherFees.lines.0.amount", message }] },
        },
      ],
    });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);
    await screen.findByText(new RegExp(NO_PROGRAM_MESSAGE));
    await addLine(user, 0, "Uang Pangkal");
    await setLabel(user, LABEL);

    await user.click(await screen.findByRole("button", { name: "Catat Rp 5.000.000 lunas" }));

    await waitFor(() => expect(amountInput(0)).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("refuses a half-filled line on submit with a message on its amount, and sends nothing", async () => {
    const f = fixture();
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);
    await screen.findByRole("table");

    // SPP is still valid, so the confirm is on; the unfinished line is caught by the form.
    await addLine(user, 0, "Seragam");
    await user.click(await screen.findByRole("button", { name: "Catat Rp 2.800.000 lunas" }));

    expect(await screen.findByText("Jumlah pada setiap baris harus lebih dari 0")).toBeInTheDocument();
    expect(await screen.findByText("Periode wajib diisi")).toBeInTheDocument();
    expect(calls(f, "/api/invoices/spp-prepay")).toHaveLength(0);
  });

  it("names the unpaid invoice that already carries a chosen component, with a link to it in a new tab", async () => {
    const message =
      "Siswa ini sudah punya tagihan belum lunas yang memuat Uang Pangkal. Jika wali membayar tagihan itu, gunakan Catat Pembayaran di tagihan tersebut.";
    fixture({
      respond: (req) => {
        const base = plan(noProgramBody())(req);
        if (!req.otherFees) return base;
        return {
          body: {
            ...(base.body as object),
            issues: [
              {
                code: "UNPAID_SAME_COMPONENT",
                blocking: false,
                message,
                invoiceId: "inv-uuid-7",
                invoice: {
                  id: "inv-uuid-7",
                  invoiceNumber: "INV-2026-0456",
                  periodLabel: "Uang Pangkal TA 2026/2027",
                  status: "SENT",
                  totalDue: 5000000,
                  monthlyAmount: 0,
                },
              },
            ],
          },
        };
      },
    });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);
    await screen.findByText(new RegExp(NO_PROGRAM_MESSAGE));
    await addLine(user, 0, "Uang Pangkal");
    await setLabel(user, LABEL);

    const warning = (await screen.findByText(/Perlu diperiksa/)).closest("[data-slot=alert]") as HTMLElement;
    const [item] = within(warning).getAllByRole("listitem");
    expect(within(item!).getByText(message)).toBeInTheDocument();
    // The one-time invoice carries no SPP, so the SPP figure is left out of the reference.
    expect(item).toHaveTextContent("INV-2026-0456 · Uang Pangkal TA 2026/2027 · Link Dibuat · Rp 5.000.000");
    expect(item).not.toHaveTextContent("SPP di dalamnya");
    const link = within(item!).getByRole("link", { name: "Buka tagihan INV-2026-0456 di tab baru" });
    expect(link).toHaveAttribute("href", "/admin/invoices/inv-uuid-7");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // A caution, not a block.
    expect(screen.getByRole("button", { name: "Catat Rp 5.000.000 lunas" })).toBeEnabled();
  });

  it("shows a destructive alert and disables the confirm for any blocking issue", async () => {
    fixture({
      respond: plan(
        previewBody({
          blocked: true,
          issues: [{ code: "NO_PRICE", blocking: true, message: "Mei 2027 belum punya tarif." }],
        }),
      ),
    });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);

    expect(await screen.findByText("Mei 2027 belum punya tarif.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Catat Rp .* lunas$|^Catat lunas$/ })).toBeDisabled();
  });

  it("lists non-blocking issues in a calm alert without disabling the confirm", async () => {
    fixture({
      respond: plan(
        previewBody({
          issues: [{ code: "UNPARSABLE_LABEL", blocking: false, message: "Label tagihan INV-9 tidak terbaca." }],
        }),
      ),
    });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);

    expect(await screen.findByText("Label tagihan INV-9 tidak terbaca.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Catat Rp 2.800.000 lunas" })).toBeEnabled();
  });

  it("names the invoice under an SPP caution that points at one, with a link that opens it in a new tab", async () => {
    const message =
      'Tagihan lunas dengan label "SPMB Tahap 1" memuat SPP tetapi tidak menyebut satu bulan, jadi bulan-bulannya tidak terbaca. Pastikan SPP bulan-bulan itu belum dibayar sebelum mencatat.';
    fixture({
      respond: plan(
        previewBody({
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
      ),
    });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);

    const warning = (await screen.findByText(/Perlu diperiksa/)).closest("[data-slot=alert]") as HTMLElement;
    const items = within(warning).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // The message reads exactly as before; the details sit beneath it.
    expect(within(items[0]!).getByText(message)).toBeInTheDocument();
    expect(items[0]).toHaveTextContent(
      "INV-2026-0123 · SPMB Tahap 1 · Lunas · Rp 3.000.000 (SPP di dalamnya Rp 1.650.000)",
    );
    const link = within(items[0]!).getByRole("link", { name: "Buka tagihan INV-2026-0123 di tab baru" });
    expect(link).toHaveAttribute("href", "/admin/invoices/inv-uuid-1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    // A caution without an invoice is just its message.
    expect(items[1]).toHaveTextContent(/^Ada 2 tagihan SPP untuk Oktober 2026\.$/);
    expect(within(items[1]!).queryByRole("link")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Catat Rp 2.800.000 lunas" })).toBeEnabled();
  });

  it("leaves blocking issues as plain messages even when they carry an invoice", async () => {
    fixture({
      respond: plan(
        previewBody({
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
      ),
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
      respond: plan(
        previewBody({
          rows: [row({ month: 11, periodLabel: "November 2026", action: "SETTLE", amount: 800000, invoiceIds: ["i"] })],
          sppTotal: 800000,
          total: 800000,
        }),
      ),
    });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);
    await screen.findByRole("table");
    expect(screen.queryByText(/Minta wali tidak membayar VA/)).not.toBeInTheDocument();
  });

  it("says every month is already paid when SPP alone adds up to nothing", async () => {
    fixture({
      respond: plan(
        previewBody({
          rows: [row({ month: 10, periodLabel: "Oktober 2026", action: "SKIP_PAID", amount: 0, invoiceIds: ["i"] })],
          sppTotal: 0,
          total: 0,
        }),
      ),
    });
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} />);
    await pickStudent(user);

    expect(await screen.findByText(/Semua bulan dalam rentang ini sudah lunas/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Catat lunas" })).toBeDisabled();
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
    // SPP only: no one-time part in the body.
    expect(body).not.toHaveProperty("otherFees");
    expect(body.paidAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.idempotencyKey).toMatch(UUID);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith("Pembayaran di muka tercatat: SPP 2 tagihan dibuat, 1 dilunasi");
  });

  it("tells the admin a replayed record was already saved", async () => {
    fixture({ confirms: [{ status: 200, body: { replayed: true } }] });
    const onRecorded = vi.fn();
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={vi.fn()} onRecorded={onRecorded} />);
    await pickStudent(user);

    await user.click(await screen.findByRole("button", { name: "Catat Rp 2.800.000 lunas" }));

    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith("Pembayaran di muka ini sudah tercatat sebelumnya");
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
    // Student-only look, default range, then the refetch after the 409.
    const f = fixture({
      previews: [
        { body: previewBody() },
        { body: previewBody() },
        { body: previewBody({ total: 1800000, sppTotal: 1800000, fingerprint: "fp-2" }) },
      ],
      confirms: [{ status: 409, body: { error: message, code: "PREVIEW_STALE" } }],
    });
    const onOpenChange = vi.fn();
    const onRecorded = vi.fn();
    const user = userEvent.setup();
    render(<SppPrepayDialog open onOpenChange={onOpenChange} onRecorded={onRecorded} />);
    await pickStudent(user);

    await user.click(await screen.findByRole("button", { name: "Catat Rp 2.800.000 lunas" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    await waitFor(() => expect(previewBodies(f)).toHaveLength(3));
    // The fresh numbers are on screen, and nothing was recorded or closed.
    expect(await screen.findByRole("button", { name: "Catat Rp 1.800.000 lunas" })).toBeEnabled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onRecorded).not.toHaveBeenCalled();
    // The refetch kept the admin's range.
    expect(previewBodies(f)[2]).toEqual({ studentId: STUDENT.id, from: "2026-07", to: "2027-06" });
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
