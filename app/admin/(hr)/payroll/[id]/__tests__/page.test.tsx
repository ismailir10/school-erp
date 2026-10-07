/**
 * T6 — Payroll detail's two sub-forms migrated onto useZodForm + FormField +
 * applyServerErrors: Variabel Kehadiran (4 numbers, all optional-default-0,
 * matching the route's own `?? 0`) and Penyesuaian (amount + required
 * reason, live-computed final amount via `watch`). "Setujui Penggajian"
 * (confirm-only) and the summary-card edit toggle are untouched.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "run-1" }), useRouter: () => ({ push }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import PayrollDetailPage from "../page";

const item = {
  id: "item-1",
  grossAmount: 5000000,
  deductions: 100000,
  netAmount: 4900000,
  overtimeHours: 0,
  outdoorDays: 0,
  holidayWorkedDays: 0,
  dcDays: 0,
  employee: { id: "e-1", kode: "E-001", nama: "Budi Santoso", jabatan: "Guru Kelas", bankAccountNo: "1234567890", bankName: "BCA" },
  lines: [
    {
      id: "line-1",
      labelSnapshot: "Gaji Pokok",
      categorySnapshot: "INCOME",
      calculatedAmount: 5000000,
      adjustmentAmount: 0,
      adjustmentNote: null,
      finalAmount: 5000000,
      componentDef: { code: "GAPOK", calcType: "FIXED" },
    },
  ],
};

const payrollRun = {
  id: "run-1",
  periodStart: "2026-08-21",
  periodEnd: "2026-09-20",
  actualWorkDays: 22,
  status: "DRAFT",
  items: [item],
};

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body };
}

function fixture(overrides: { putStatus?: number; putBody?: unknown } = {}) {
  const { putStatus = 200, putBody = { ok: true } } = overrides;
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    // Checked before the plain GET match below — the period-edit card PUTs
    // to this exact same URL (PUT /api/payroll/[id]), so the method has to
    // be checked first or every such PUT would silently read back as the
    // GET fixture instead of the configured `putStatus`/`putBody`.
    if (input === "/api/payroll/run-1" && init?.method === "PUT") {
      return Promise.resolve(jsonResponse(putBody, putStatus < 400, putStatus));
    }
    if (input === "/api/payroll/run-1") return Promise.resolve(jsonResponse(payrollRun));
    if (input.startsWith("/api/payroll/compare")) return Promise.resolve(jsonResponse({}));
    if (init?.method === "PUT") return Promise.resolve(jsonResponse(putBody, putStatus < 400, putStatus));
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("PayrollDetailPage — Variabel Kehadiran dialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("submits the 4 numbers as PUT .../variables, defaulting blank fields to 0", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<PayrollDetailPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Budi Santoso/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Ubah variabel kehadiran" }));

    const dialog = await screen.findByRole("dialog", { name: "Variabel Kehadiran" });
    await user.clear(within(dialog).getByRole("spinbutton", { name: "Jam Lembur" }));
    await user.type(within(dialog).getByRole("spinbutton", { name: "Jam Lembur" }), "2.5");
    await user.clear(within(dialog).getByRole("spinbutton", { name: "Hari Outdoor" }));
    await user.type(within(dialog).getByRole("spinbutton", { name: "Hari Outdoor" }), "1");
    // Hari Libur Kerja / Hari DC left blank.
    await user.clear(within(dialog).getByRole("spinbutton", { name: "Hari Libur Kerja" }));
    await user.clear(within(dialog).getByRole("spinbutton", { name: "Hari DC" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan & Hitung Ulang" }));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === "/api/payroll/run-1/items/item-1/variables" && (init as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeTruthy();
    });
    const [, putInit] = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "/api/payroll/run-1/items/item-1/variables" && (init as RequestInit | undefined)?.method === "PUT",
    )!;
    expect(JSON.parse((putInit as RequestInit).body as string)).toEqual({
      overtimeHours: 2.5,
      outdoorDays: 1,
      holidayWorkedDays: 0,
      dcDays: 0,
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Variabel diperbarui"));
  });

  it("blocks submit on a negative day count, showing an inline error and firing no PUT", async () => {
    const fetchMock = fixture();
    render(<PayrollDetailPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Budi Santoso/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Ubah variabel kehadiran" }));
    const dialog = await screen.findByRole("dialog", { name: "Variabel Kehadiran" });

    const dcInput = within(dialog).getByRole("spinbutton", { name: "Hari DC" });
    fireEvent.change(dcInput, { target: { value: "-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan & Hitung Ulang" }));

    expect(await within(dialog).findByText("Hari DC tidak boleh negatif")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT"),
    ).toBe(false);
  });
});

describe("PayrollDetailPage — Penyesuaian dialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("blocks submit with an empty reason, showing an inline error and firing no PUT", async () => {
    const fetchMock = fixture();
    render(<PayrollDetailPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Budi Santoso/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Ubah penyesuaian Gaji Pokok" }));

    const dialog = await screen.findByRole("dialog", { name: "Penyesuaian" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));

    expect(await within(dialog).findByText("Catatan penyesuaian wajib diisi")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT"),
    ).toBe(false);
  });

  it("live-recomputes the final amount as the adjustment is typed, then submits amount + note", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<PayrollDetailPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Budi Santoso/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Ubah penyesuaian Gaji Pokok" }));
    const dialog = await screen.findByRole("dialog", { name: "Penyesuaian" });

    expect(within(dialog).getByText(/Final:/)).toHaveTextContent("Rp 5.000.000");

    await user.type(within(dialog).getByRole("spinbutton", { name: "Penyesuaian (+ atau -)" }), "100000");
    await waitFor(() => expect(within(dialog).getByText(/Final:/)).toHaveTextContent("Rp 5.100.000"));

    await user.type(within(dialog).getByRole("textbox", { name: "Catatan" }), "Bonus kinerja");
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === "/api/payroll/run-1/items/item-1/lines/line-1" && (init as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeTruthy();
    });
    const [, putInit] = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "/api/payroll/run-1/items/item-1/lines/line-1" && (init as RequestInit | undefined)?.method === "PUT",
    )!;
    expect(JSON.parse((putInit as RequestInit).body as string)).toEqual({
      adjustmentAmount: 100000,
      adjustmentNote: "Bonus kinerja",
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Penyesuaian disimpan"));
  });
});

describe("PayrollDetailPage — period edit card", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("blocks a cleared Hari Kerja Aktual with 'wajib diisi', firing no PUT", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<PayrollDetailPage />);

    fireEvent.click(await screen.findByTestId("payroll-edit-btn"));
    const workDaysInput = await screen.findByRole("spinbutton", { name: "Hari Kerja Aktual" });
    await user.clear(workDaysInput);
    fireEvent.click(screen.getByTestId("payroll-edit-save"));

    expect(await screen.findByText("Hari kerja aktual wajib diisi")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === "/api/payroll/run-1" && (init as RequestInit | undefined)?.method === "PUT",
      ),
    ).toBe(false);
  });

  it("submits the edited period as a PUT to /api/payroll/[id]", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<PayrollDetailPage />);

    fireEvent.click(await screen.findByTestId("payroll-edit-btn"));
    const workDaysInput = await screen.findByRole("spinbutton", { name: "Hari Kerja Aktual" });
    await user.clear(workDaysInput);
    await user.type(workDaysInput, "20");
    fireEvent.click(screen.getByTestId("payroll-edit-save"));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/payroll/run-1" && (init as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeTruthy();
    });
    const [, putInit] = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/payroll/run-1" && (init as RequestInit | undefined)?.method === "PUT",
    )!;
    expect(JSON.parse((putInit as RequestInit).body as string)).toEqual({
      periodStart: "2026-08-21",
      periodEnd: "2026-09-20",
      actualWorkDays: 20,
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Periode diperbarui"));
  });
});

describe("PayrollDetailPage — Batalkan draf (HR-11)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("confirms, POSTs /cancel, toasts and returns to the list", async () => {
    const fetchMock = fixture();
    render(<PayrollDetailPage />);

    fireEvent.click(await screen.findByTestId("payroll-cancel-draft-btn"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Batalkan draf penggajian?")).toBeInTheDocument();
    // Nothing is sent until the admin confirms.
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/cancel"))).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: "Batalkan draf" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === "/api/payroll/run-1/cancel");
      expect((call?.[1] as RequestInit | undefined)?.method).toBe("POST");
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Draf penggajian dibatalkan"));
    expect(push).toHaveBeenCalledWith("/admin/payroll");
  });

  it("keeps the dialog open and shows the API sentence when the cancel fails", async () => {
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (input === "/api/payroll/run-1/cancel") {
        return Promise.resolve(jsonResponse({ error: "Hanya draf yang bisa dibatalkan" }, false, 409));
      }
      if (input === "/api/payroll/run-1" && !init?.method) return Promise.resolve(jsonResponse(payrollRun));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PayrollDetailPage />);

    fireEvent.click(await screen.findByTestId("payroll-cancel-draft-btn"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Batalkan draf" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Hanya draf yang bisa dibatalkan"));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("is not offered on an approved run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) =>
        Promise.resolve(
          input === "/api/payroll/run-1" ? jsonResponse({ ...payrollRun, status: "APPROVED" }) : jsonResponse({}),
        ),
      ),
    );
    render(<PayrollDetailPage />);
    await screen.findByRole("button", { name: /Budi Santoso/ });
    expect(screen.queryByTestId("payroll-cancel-draft-btn")).not.toBeInTheDocument();
  });
});

describe("PayrollDetailPage — HRX-3 / HR-8 / HR-19", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("tells the admin that Hari Kerja Aktual does not recalculate the slips", async () => {
    fixture();
    render(<PayrollDetailPage />);
    const editBtn = await screen.findByTestId("payroll-edit-btn");
    // HR-19: "Ubah", not "Edit"
    expect(editBtn).toHaveTextContent("Ubah");
    fireEvent.click(editBtn);
    expect(
      await screen.findByText("Mengubah hari kerja aktual tidak menghitung ulang slip. Buat ulang penggajian bila perlu."),
    ).toBeInTheDocument();
  });

  it("blocks Hari Kerja Aktual above the days in the period before any PUT", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<PayrollDetailPage />);
    fireEvent.click(await screen.findByTestId("payroll-edit-btn"));
    const input = await screen.findByRole("spinbutton", { name: "Hari Kerja Aktual" });
    await user.clear(input);
    await user.type(input, "999");
    fireEvent.click(screen.getByTestId("payroll-edit-save"));

    // 2026-08-21 .. 2026-09-20 = 31 days
    expect(await screen.findByText("Hari kerja aktual harus antara 1 dan 31 hari.")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT"),
    ).toBe(false);
  });

  it("shows a server field error inline on Hari Kerja Aktual", async () => {
    fixture({
      putStatus: 400,
      putBody: {
        error: "Hari kerja aktual harus antara 1 dan 31 hari.",
        errors: [{ field: "actualWorkDays", message: "Hari kerja aktual harus antara 1 dan 31 hari." }],
      },
    });
    render(<PayrollDetailPage />);
    fireEvent.click(await screen.findByTestId("payroll-edit-btn"));
    fireEvent.click(await screen.findByTestId("payroll-edit-save"));
    expect(await screen.findByText("Hari kerja aktual harus antara 1 dan 31 hari.")).toBeInTheDocument();
  });

  it("gives the item sheet body horizontal padding", async () => {
    fixture();
    render(<PayrollDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Budi Santoso/ }));
    const body = await screen.findByTestId("payroll-item-sheet-body");
    expect(body.className).toContain("px-4");
  });

  it("shows the API sentence, not a bare 'Gagal', when a line adjustment is refused", async () => {
    fixture({
      putStatus: 400,
      putBody: {
        error: "Penyesuaian membuat komponen bernilai negatif.",
        errors: [{ field: "adjustmentAmount", message: "Penyesuaian membuat komponen bernilai negatif." }],
      },
    });
    const user = userEvent.setup();
    render(<PayrollDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Budi Santoso/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Ubah penyesuaian Gaji Pokok" }));
    const dialog = await screen.findByRole("dialog", { name: "Penyesuaian" });
    await user.type(within(dialog).getByRole("spinbutton", { name: "Penyesuaian (+ atau -)" }), "-9000000");
    await user.type(within(dialog).getByRole("textbox", { name: "Catatan" }), "Koreksi");
    fireEvent.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));
    expect(await within(dialog).findByText("Penyesuaian membuat komponen bernilai negatif.")).toBeInTheDocument();
  });

  it("surfaces the approve refusal message from the API", async () => {
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (input === "/api/payroll/run-1/approve") {
        return Promise.resolve(
          jsonResponse({ error: "Periode belum selesai. Penggajian bisa disetujui mulai 21 Oktober 2026." }, false, 409),
        );
      }
      if (input === "/api/payroll/run-1" && !init?.method) return Promise.resolve(jsonResponse(payrollRun));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PayrollDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Setujui" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Setujui" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Periode belum selesai. Penggajian bisa disetujui mulai 21 Oktober 2026."),
    );
  });
});
