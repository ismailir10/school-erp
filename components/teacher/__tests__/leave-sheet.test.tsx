import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { LeaveSheet, type LeaveBalance, type LeaveRequest } from "../leave-sheet";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const balance: LeaveBalance = {
  annual: { total: 12, used: 2, remaining: 10 },
  sick: { total: 12, used: 0, remaining: 12 },
};

const requests: LeaveRequest[] = [
  {
    id: "leave-1",
    leaveType: "ANNUAL",
    startDate: "2026-06-15",
    endDate: "2026-06-16",
    days: 2,
    reason: "Urusan keluarga",
    status: "APPROVED",
    reviewNote: null,
    createdAt: "2026-06-01",
  },
];

function Harness({ list = requests }: { list?: LeaveRequest[] }) {
  const [open, setOpen] = useState(true);
  return (
    <LeaveSheet
      open={open}
      onOpenChange={setOpen}
      prefetchedBalance={balance}
      prefetchedRequests={list}
      prefetchState="ready"
    />
  );
}

describe("LeaveSheet", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 375,
    });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("hands off from sheet to request dialog without stacking overlays", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<Harness />);

    try {
      expect(window.matchMedia).toHaveBeenCalled();
      expect(screen.getByText("Cuti dan izin")).toBeInTheDocument();
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: "Ajukan cuti" }));

      // Base UI completes the close after an animation frame and the resolved
      // getAnimations() promises. Advance only that frame, leaving the 240ms
      // handoff timer pending so the gap is deterministic under runner load.
      await act(async () => {
        vi.advanceTimersToNextFrame();
      });
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(240);
      });
      expect(screen.getByText("Pengajuan akan dikirim ke admin untuk persetujuan")).toBeInTheDocument();
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it("associates every leave-request control with its visible label", async () => {
    const user = userEvent.setup();

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Ajukan cuti" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Jenis cuti")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Tanggal mulai")).toBeInTheDocument();
    expect(screen.getByLabelText("Tanggal selesai")).toBeInTheDocument();
    expect(screen.getByLabelText("Alasan")).toBeInTheDocument();
  });

  it("blocks past start dates for annual leave and izin but allows them for sick leave", async () => {
    const user = userEvent.setup();
    const today = getTodayInTimezone("Asia/Jakarta");

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Ajukan cuti" }));
    const start = await screen.findByLabelText("Tanggal mulai");

    // Default type is annual leave: date inputs are bounded to today.
    expect(start).toHaveAttribute("min", today);
    expect(screen.getByLabelText("Tanggal selesai")).toHaveAttribute("min", today);

    fireEvent.change(start, { target: { value: "2020-01-06" } });
    expect(screen.getByText("Tanggal mulai tidak boleh sebelum hari ini.")).toBeInTheDocument();

    // Sick leave may be filed retroactively: no min, no message.
    await user.click(screen.getByRole("combobox", { name: "Jenis cuti" }));
    await user.click(await screen.findByRole("option", { name: /Cuti sakit/ }));
    expect(screen.getByLabelText("Tanggal mulai")).not.toHaveAttribute("min");
    expect(screen.queryByText("Tanggal mulai tidak boleh sebelum hari ini.")).toBeNull();
  });

  it("shows a retryable error instead of an empty state when leave prefetch fails", async () => {
    const onRefetch = vi.fn();
    const user = userEvent.setup();

    render(
      <LeaveSheet
        open
        onOpenChange={() => {}}
        prefetchedBalance={null}
        prefetchedRequests={null}
        prefetchState="error"
        onRefetch={onRefetch}
      />,
    );

    expect(screen.getByText("Data cuti tidak bisa dimuat")).toBeInTheDocument();
    expect(screen.queryByText("Belum ada pengajuan cuti")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  describe("network failure (TCHX-2)", () => {
    beforeEach(() => {
      vi.mocked(toast.error).mockClear();
      vi.unstubAllGlobals();
    });

    it("re-enables both buttons, toasts, and keeps the form when submit cannot reach the server", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      vi.stubGlobal("fetch", fetchMock);

      render(<Harness />);
      await user.click(screen.getByRole("button", { name: "Ajukan cuti" }));
      const start = await screen.findByLabelText("Tanggal mulai");
      fireEvent.change(start, { target: { value: "2099-10-12" } });
      fireEvent.change(screen.getByLabelText("Tanggal selesai"), { target: { value: "2099-10-13" } });
      fireEvent.change(screen.getByLabelText("Alasan"), { target: { value: "Urusan keluarga" } });

      await user.click(screen.getByRole("button", { name: "Ajukan" }));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Koneksi terputus. Pengajuan belum terkirim — coba lagi."),
      );
      expect(screen.getByRole("button", { name: "Ajukan" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Batal" })).toBeEnabled();
      expect(screen.queryByText("Mengirim…")).toBeNull();
      expect(screen.getByLabelText("Alasan")).toHaveValue("Urusan keluarga");
      expect(screen.getByLabelText("Tanggal mulai")).toHaveValue("2099-10-12");
    });

    it("re-enables the confirm dialog and toasts when cancel cannot reach the server", async () => {
      const user = userEvent.setup();
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
      const pending: LeaveRequest = { ...requests[0]!, id: "leave-2", status: "PENDING" };

      render(<Harness list={[pending]} />);
      await user.click(screen.getByRole("button", { name: "Batalkan" }));
      const confirm = await screen.findByRole("button", { name: "Batalkan pengajuan" });
      await user.click(confirm);

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Koneksi terputus. Pembatalan belum terkirim — coba lagi."),
      );
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Batalkan pengajuan" })).toBeEnabled(),
      );
      expect(screen.getByRole("button", { name: "Batal" })).toBeEnabled();
    });
  });
});
