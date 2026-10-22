import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { AgingCard } from "../aging-card";
import { FinanceTrendCard } from "../finance-trend-card";
import { JournalCard } from "../journal-card";
import { StudentAttendanceCard } from "../student-attendance-card";
import { attendanceFixture, financeFixture, hidden, journalFixture, ready, unavailable } from "./fixtures";

describe("StudentAttendanceCard", () => {
  it("renders the chart, the window and the lowest classes", () => {
    render(<StudentAttendanceCard source={ready(attendanceFixture())} />);
    const card = screen.getByTestId("analytics-attendance");
    expect(within(card).getByText("Kehadiran siswa")).toBeVisible();
    expect(within(card).getByText("30 hari terakhir")).toBeVisible();
    expect(card.querySelector('[data-slot="chart"]')).not.toBeNull();
    expect(within(card).getByRole("link", { name: "Lihat kehadiran" })).toHaveAttribute("href", "/admin/student-attendance");
    expect(within(card).getByText("Kelas perlu perhatian")).toBeVisible();
    const row = within(card).getByRole("link", { name: /Kelas 2A/ });
    expect(row).toHaveAttribute("href", "/admin/student-attendance");
    expect(row).toHaveTextContent("82%");
    expect(row).toHaveTextContent("40 catatan");
    expect(within(card).getByRole("progressbar", { name: "Kelas 2A 82 persen" })).toBeInTheDocument();
  });

  it("describes the chart in one sentence for screen readers", () => {
    render(<StudentAttendanceCard source={ready(attendanceFixture())} />);
    expect(screen.getByText("Rata-rata kehadiran 93 persen dalam 30 hari terakhir, dari 132 catatan.")).toHaveClass("sr-only");
  });

  it("shows an empty state, not a flat chart, when no day has records", () => {
    render(<StudentAttendanceCard source={ready(attendanceFixture({ days: [], rate: null, previousRate: null, totalRecords: 0, lowestClasses: [] }))} />);
    const card = screen.getByTestId("analytics-attendance");
    expect(within(card).getByText("Belum ada data kehadiran siswa")).toBeVisible();
    expect(within(card).getByText("Grafik muncul setelah guru mencatat kehadiran.")).toBeVisible();
    expect(card.querySelector('[data-slot="chart"]')).toBeNull();
  });

  it("shows a retry state when the source failed", () => {
    render(<StudentAttendanceCard source={unavailable} />);
    const card = screen.getByTestId("analytics-attendance");
    expect(within(card).getByText("Data kehadiran siswa belum dapat dimuat.")).toBeVisible();
    expect(within(card).getByRole("button", { name: "Coba lagi" })).toBeVisible();
  });

  it("renders nothing when hidden", () => {
    const { container } = render(<StudentAttendanceCard source={hidden} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("JournalCard", () => {
  it("renders the chart, the note totals and the least complete classes", () => {
    render(<JournalCard source={ready(journalFixture())} />);
    const card = screen.getByTestId("analytics-journal");
    expect(within(card).getByText("Buku penghubung")).toBeVisible();
    expect(within(card).getByText("Kelengkapan 8 minggu terakhir")).toBeVisible();
    expect(card.querySelector('[data-slot="chart"]')).not.toBeNull();
    expect(within(card).getByRole("link", { name: "Lihat monitoring" })).toHaveAttribute("href", "/admin/student-journal/monitoring");
    expect(within(card).getByText("Catatan guru").parentElement).toHaveTextContent("28");
    expect(within(card).getByText("Catatan wali").parentElement).toHaveTextContent("8");
    const row = within(card).getByRole("link", { name: /Kelas 1C/ });
    expect(row).toHaveAttribute("href", "/admin/student-journal/classes/cs-9?weekStart=2026-10-19");
    expect(row).toHaveTextContent("52%");
  });

  it("shows an empty state when there are no entries and no notes", () => {
    const weeks = journalFixture().weeks.map((week) => ({ ...week, completionPct: null, checked: 0, possible: 0, teacherNotes: 0, guardianNotes: 0 }));
    render(<JournalCard source={ready(journalFixture({ weeks, thisWeekPct: null, teacherNotes: 0, guardianNotes: 0, leastCompleteClasses: [] }))} />);
    const card = screen.getByTestId("analytics-journal");
    expect(within(card).getByText("Belum ada data buku penghubung")).toBeVisible();
    expect(card.querySelector('[data-slot="chart"]')).toBeNull();
  });

  it("shows a retry state when the source failed", () => {
    render(<JournalCard source={unavailable} />);
    const card = screen.getByTestId("analytics-journal");
    expect(within(card).getByText("Data buku penghubung belum dapat dimuat.")).toBeVisible();
    expect(within(card).getByRole("button", { name: "Coba lagi" })).toBeVisible();
  });
});

describe("FinanceTrendCard", () => {
  it("renders the billed vs collected chart and six-month totals", () => {
    render(<FinanceTrendCard source={ready(financeFixture())} />);
    const card = screen.getByTestId("analytics-finance-trend");
    expect(within(card).getByText("Tagihan vs terkumpul")).toBeVisible();
    expect(within(card).getByText("6 bulan terakhir")).toBeVisible();
    expect(within(card).getByText("Ditagihkan", { selector: "p" }).parentElement).toHaveTextContent("Rp 75.000.000");
    expect(within(card).getByText("Terkumpul", { selector: "p" }).parentElement).toHaveTextContent("Rp 63.000.000");
    expect(card.querySelector('[data-slot="chart"]')).not.toBeNull();
    expect(within(card).getByRole("link", { name: "Lihat tagihan" })).toHaveAttribute("href", "/admin/invoices");
  });

  it("shows an empty state when nothing was billed or collected", () => {
    const months = financeFixture().months.map((month) => ({ ...month, billed: 0, collected: 0 }));
    render(<FinanceTrendCard source={ready(financeFixture({ months }))} />);
    const card = screen.getByTestId("analytics-finance-trend");
    expect(within(card).getByText("Belum ada tagihan")).toBeVisible();
    expect(card.querySelector('[data-slot="chart"]')).toBeNull();
  });

  it("shows a retry state when the source failed", () => {
    render(<FinanceTrendCard source={unavailable} />);
    const card = screen.getByTestId("analytics-finance-trend");
    expect(within(card).getByText("Data keuangan belum dapat dimuat.")).toBeVisible();
    expect(within(card).getByRole("button", { name: "Coba lagi" })).toBeVisible();
  });

  it("renders nothing when hidden", () => {
    const { container } = render(<FinanceTrendCard source={hidden} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AgingCard", () => {
  it("lists the five buckets with counts and full rupiah amounts", () => {
    render(<AgingCard source={ready(financeFixture())} />);
    const card = screen.getByTestId("analytics-aging");
    expect(within(card).getByText("Umur piutang")).toBeVisible();
    expect(within(card).getByText("Total Rp 11.500.000")).toBeVisible();
    expect(within(card).getByRole("link", { name: "Lihat lewat tempo" })).toHaveAttribute("href", "/admin/invoices?status=OVERDUE");
    const rows = card.querySelectorAll("[data-bucket-row]");
    expect(rows).toHaveLength(5);
    const expected: [string, string, string][] = [
      ["Belum jatuh tempo", "4 tagihan", "Rp 5.000.000"],
      ["1–30 hari", "3 tagihan", "Rp 3.000.000"],
      ["31–60 hari", "2 tagihan", "Rp 2.000.000"],
      ["61–90 hari", "1 tagihan", "Rp 1.000.000"],
      ["> 90 hari", "1 tagihan", "Rp 500.000"],
    ];
    expected.forEach(([label, count, amount], index) => {
      expect(rows[index]).toHaveTextContent(label);
      expect(rows[index]).toHaveTextContent(count);
      expect(rows[index]).toHaveTextContent(amount);
    });
  });

  it("sizes the bar segments by share of the outstanding amount", () => {
    render(<AgingCard source={ready(financeFixture())} />);
    const segments = screen.getByTestId("analytics-aging").querySelectorAll<HTMLElement>("[data-bucket]");
    expect(segments).toHaveLength(5);
    expect(segments[0]!.style.flexGrow).toBe("5000000");
    expect(segments[0]).toHaveClass("bg-status-leave");
    expect(segments[4]).toHaveClass("bg-status-absent");
  });

  it("leaves empty buckets out of the bar but keeps their rows", () => {
    const aging = financeFixture().aging.map((bucket) => (bucket.key === "d61_90" ? { ...bucket, amount: 0, count: 0 } : bucket));
    render(<AgingCard source={ready(financeFixture({ aging }))} />);
    const card = screen.getByTestId("analytics-aging");
    expect(card.querySelectorAll("[data-bucket]")).toHaveLength(4);
    expect(card.querySelectorAll("[data-bucket-row]")).toHaveLength(5);
  });

  it("celebrates when nothing is outstanding", () => {
    const aging = financeFixture().aging.map((bucket) => ({ ...bucket, amount: 0, count: 0 }));
    render(<AgingCard source={ready(financeFixture({ aging, outstandingTotal: 0 }))} />);
    const card = screen.getByTestId("analytics-aging");
    expect(within(card).getByText("Tidak ada piutang", { selector: "p.font-semibold" })).toBeVisible();
    expect(within(card).getByTestId("empty-state-icon-celebration")).toBeInTheDocument();
    expect(card.querySelectorAll("[data-bucket-row]")).toHaveLength(0);
  });

  it("shows a retry state when the source failed", () => {
    render(<AgingCard source={unavailable} />);
    const card = screen.getByTestId("analytics-aging");
    expect(within(card).getByText("Data piutang belum dapat dimuat.")).toBeVisible();
    expect(within(card).getByRole("button", { name: "Coba lagi" })).toBeVisible();
  });
});
