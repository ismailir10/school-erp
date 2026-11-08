import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { AttendanceTodayStrip } from "../attendance-today-strip";

describe("AttendanceTodayStrip", () => {
  it("renders a single-line summary with a link to the full attendance page", () => {
    render(<AttendanceTodayStrip data={{ status: "ready", total: 22, present: 18, late: 2, absent: 2 }} />);
    expect(screen.getByText("18/22")).toBeVisible();
    expect(screen.getByText(/terlambat/)).toBeVisible();
    expect(screen.getByText(/tidak hadir/)).toBeVisible();
    expect(screen.getByRole("link", { name: /Lihat kehadiran/ })).toHaveAttribute("href", "/admin/employee-attendance");
  });

  it("links pending geofence check-ins to the approval tab only when there are some", () => {
    const { rerender } = render(<AttendanceTodayStrip data={{ status: "ready", total: 22, present: 18, late: 2, absent: 2, pending: 3 }} />);
    expect(screen.getByTestId("dashboard-attendance-pending")).toHaveAttribute("href", "/admin/employee-attendance?tab=pending");
    expect(screen.getByTestId("dashboard-attendance-pending")).toHaveTextContent("3 absensi perlu persetujuan");
    rerender(<AttendanceTodayStrip data={{ status: "ready", total: 22, present: 18, late: 2, absent: 2, pending: 0 }} />);
    expect(screen.queryByTestId("dashboard-attendance-pending")).not.toBeInTheDocument();
  });

  it("shows retry instead of a false summary when the source is unavailable", () => {
    render(<AttendanceTodayStrip data={{ status: "unavailable" }} />);
    expect(screen.getByText("Ringkasan kehadiran belum dapat dimuat.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeVisible();
    expect(screen.queryByText(/hadir ·/)).not.toBeInTheDocument();
  });
});
