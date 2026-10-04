/**
 * OverrideModal — admin attendance correction form.
 *
 * Regression: the CREATE path (recordId === null) used to POST without the
 * check-in time, so a time typed into "Waktu Masuk" was silently dropped.
 * These tests pin the request each path sends. The shell is the shared
 * ResponsiveFormDialog (desktop Dialog branch in jsdom, as in
 * student-export-dialog.test.tsx).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { OverrideModal } from "../override-modal";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const DATE = "2026-10-05";

function renderModal(overrides: Partial<React.ComponentProps<typeof OverrideModal>> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    recordId: null as string | null,
    employeeId: "emp1",
    employeeName: "Ustadzah Aisyah",
    date: DATE,
    currentStatus: null as string | null,
    onSuccess: vi.fn(),
    ...overrides,
  };
  render(<OverrideModal {...props} />);
  return props;
}

async function timeInput(): Promise<HTMLInputElement> {
  await screen.findByRole("dialog");
  const el = document.querySelector<HTMLInputElement>('input[type="time"]');
  if (!el) throw new Error("time input not rendered");
  return el;
}

function lastRequest(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) as Record<string, unknown> };
}

describe("OverrideModal request body", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("create: POSTs the typed check-in time to the employee override endpoint", async () => {
    const user = userEvent.setup();
    const props = renderModal();

    fireEvent.change(await timeInput(), { target: { value: "07:30" } });
    await user.type(screen.getByPlaceholderText(/Sakit, konfirmasi/), "Lupa absen");
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { url, init, body } = lastRequest(fetchMock);
    expect(url).toBe("/api/attendance/emp1/override");
    expect(init.method).toBe("POST");
    expect(body).toEqual({ date: DATE, status: "PRESENT", reason: "Lupa absen", checkInTime: "07:30" });
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalledTimes(1));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("create: omits checkInTime entirely when the time is left blank", async () => {
    const user = userEvent.setup();
    renderModal();

    await timeInput();
    await user.type(screen.getByPlaceholderText(/Sakit, konfirmasi/), "Lupa absen");
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { url, init, body } = lastRequest(fetchMock);
    expect(url).toBe("/api/attendance/emp1/override");
    expect(init.method).toBe("POST");
    expect("checkInTime" in body).toBe(false);
    expect(body).toEqual({ date: DATE, status: "PRESENT", reason: "Lupa absen" });
  });

  it("edit: PUTs the typed check-in time to the record override endpoint", async () => {
    const user = userEvent.setup();
    const props = renderModal({ recordId: "rec1", currentStatus: "LATE" });

    fireEvent.change(await timeInput(), { target: { value: "08:15" } });
    await user.type(screen.getByPlaceholderText(/Sakit, konfirmasi/), "Koreksi jam");
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { url, init, body } = lastRequest(fetchMock);
    expect(url).toBe("/api/attendance/rec1/override");
    expect(init.method).toBe("PUT");
    expect(body).toEqual({ status: "LATE", reason: "Koreksi jam", checkInTime: "08:15" });
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalledTimes(1));
  });

  it("blank reason: shows an error toast and does not call fetch", async () => {
    const user = userEvent.setup();
    const props = renderModal();

    fireEvent.change(await timeInput(), { target: { value: "07:30" } });
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    expect(toast.error).toHaveBeenCalledWith("Alasan wajib diisi");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(props.onSuccess).not.toHaveBeenCalled();
  });
});
