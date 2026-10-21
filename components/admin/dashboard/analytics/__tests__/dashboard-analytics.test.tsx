import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const loaders = vi.hoisted(() => ({
  loadAttendanceAnalytics: vi.fn(),
  loadJournalAnalytics: vi.fn(),
  loadFinanceAnalytics: vi.fn(),
}));
vi.mock("@/lib/dashboard/analytics", () => loaders);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { DashboardAnalytics } from "../dashboard-analytics";
import { AnalyticsSkeleton } from "../analytics-skeleton";
import { attendanceFixture, financeFixture, journalFixture } from "./fixtures";

const props = { tenantId: "t1", today: "2026-10-21", canSeeFinance: true };

describe("DashboardAnalytics", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    loaders.loadAttendanceAnalytics.mockResolvedValue(attendanceFixture());
    loaders.loadJournalAnalytics.mockResolvedValue(journalFixture());
    loaders.loadFinanceAnalytics.mockResolvedValue(financeFixture());
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.clearAllMocks());

  it("renders the heading, the headline band and all four cards for a full-permission admin", async () => {
    render(await DashboardAnalytics(props));
    const section = screen.getByTestId("dashboard-analytics");
    expect(within(section).getByRole("heading", { level: 2, name: "Analitik" })).toBeVisible();
    for (const id of ["analytics-headline", "analytics-attendance", "analytics-journal", "analytics-finance-trend", "analytics-aging"]) {
      expect(within(section).getByTestId(id)).toBeInTheDocument();
    }
    expect(loaders.loadAttendanceAnalytics).toHaveBeenCalledWith("t1", "2026-10-21");
    expect(loaders.loadFinanceAnalytics).toHaveBeenCalledWith("t1", "2026-10-21");
  });

  it("never loads or renders finance without invoices.view", async () => {
    render(await DashboardAnalytics({ ...props, canSeeFinance: false }));
    expect(loaders.loadFinanceAnalytics).not.toHaveBeenCalled();
    expect(screen.queryByTestId("analytics-finance-trend")).not.toBeInTheDocument();
    expect(screen.queryByTestId("analytics-aging")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("analytics-headline")).getAllByRole("link")).toHaveLength(2);
    expect(screen.getByTestId("analytics-attendance")).toBeInTheDocument();
  });

  it("isolates a failing source to its own card and logs it", async () => {
    const error = new Error("db down");
    loaders.loadJournalAnalytics.mockRejectedValue(error);
    render(await DashboardAnalytics(props));
    expect(errorSpy).toHaveBeenCalledWith("[dashboard] source unavailable", { key: "analytics-journal", error });
    const journal = screen.getByTestId("analytics-journal");
    expect(within(journal).getByText("Data buku penghubung belum dapat dimuat.")).toBeVisible();
    expect(within(journal).getByRole("button", { name: "Coba lagi" })).toBeVisible();
    // siblings are unaffected
    expect(screen.getByTestId("analytics-attendance").querySelector('[data-slot="chart"]')).not.toBeNull();
    expect(screen.getByTestId("analytics-finance-trend").querySelector('[data-slot="chart"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: /^Kehadiran siswa 93 persen/ })).toBeVisible();
    expect(screen.getByRole("link", { name: "Buku penghubung belum dapat dimuat" })).toHaveTextContent("—");
  });
});

describe("AnalyticsSkeleton", () => {
  it("keeps the heading and omits the finance row when finance is not permitted", () => {
    const { rerender } = render(<AnalyticsSkeleton />);
    expect(screen.getByRole("heading", { name: "Analitik" })).toBeVisible();
    expect(screen.getByTestId("dashboard-analytics-skeleton").querySelectorAll('[data-slot="skeleton"]')).toHaveLength(5);
    rerender(<AnalyticsSkeleton showFinance={false} />);
    expect(screen.getByTestId("dashboard-analytics-skeleton").querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
  });
});
