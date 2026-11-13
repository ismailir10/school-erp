import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import OrgConfigPage from "../page";

function fixture(overrides: { put?: unknown; putOk?: boolean } = {}) {
  const { put = {}, putOk = true } = overrides;
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/config/org" && (!init || init.method === undefined)) {
      return { ok: true, json: async () => null };
    }
    if (input === "/api/config/org" && init?.method === "PUT") {
      return { ok: putOk, status: putOk ? 200 : 400, json: async () => put };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("OrgConfigPage (work hours)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("keeps the page header visible while loading and after a load failure", async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((r) => { resolve = r; })));
    render(<OrgConfigPage />);

    expect(screen.getByRole("heading", { name: "Jam Kerja" })).toBeInTheDocument();
    expect(screen.queryByText("Hari Kerja")).not.toBeInTheDocument();

    resolve({ ok: false, status: 500, json: async () => ({}) });
    expect(await screen.findByRole("alert")).toHaveTextContent("Konfigurasi belum bisa dimuat");
    expect(screen.getByRole("heading", { name: "Jam Kerja" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeInTheDocument();
  });

  it("renders the form once loaded", async () => {
    fixture();
    render(<OrgConfigPage />);

    expect(await screen.findByText("Hari Kerja")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(7);
    expect(screen.getByLabelText("Jam Mulai", { exact: false })).toHaveValue("07:00");
    expect(screen.getByRole("button", { name: "Simpan Konfigurasi" })).toBeInTheDocument();
  });

  it("blocks submit with a negative grace period, showing an inline error and firing no PUT", async () => {
    // A number input sanitizes non-numeric text to "" at the DOM level (jsdom
    // included), so a genuinely out-of-range *numeric* value is what exercises
    // the schema's min(0) check end-to-end.
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<OrgConfigPage />);

    const grace = await screen.findByLabelText("Toleransi Keterlambatan", { exact: false });
    fireEvent.change(grace, { target: { value: "-5" } });

    await user.click(screen.getByRole("button", { name: "Simpan Konfigurasi" }));

    expect(
      await screen.findByText("Toleransi keterlambatan tidak boleh negatif"),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT"),
    ).toBe(false);
  });

  it("submits the form as PUT /api/config/org with the expected body and clears the dirty state", async () => {
    const fetchMock = fixture({ put: { id: "org-1" } });
    const user = userEvent.setup();
    render(<OrgConfigPage />);

    const startTime = await screen.findByLabelText("Jam Mulai", { exact: false });
    fireEvent.change(startTime, { target: { value: "08:00" } });

    await user.click(screen.getByRole("button", { name: "Simpan Konfigurasi" }));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/config/org" && (init as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeTruthy();
    });

    const [, putInit] = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/config/org" && (init as RequestInit | undefined)?.method === "PUT",
    )!;
    const body = JSON.parse((putInit as RequestInit).body as string);
    expect(body).toEqual({
      workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
      workStartTime: "08:00",
      workEndTime: "16:00",
      gracePeriodMinutes: 15,
      timezone: "Asia/Jakarta",
      payrollPeriodStartDay: 21,
      payrollPeriodEndDay: 20,
    });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Konfigurasi disimpan"));
    // form.reset(values) after a successful save clears the dirty state — the
    // button stays "Simpan Konfigurasi", not stuck on "Menyimpan...".
    expect(screen.getByRole("button", { name: "Simpan Konfigurasi" })).toBeEnabled();
  });
});
