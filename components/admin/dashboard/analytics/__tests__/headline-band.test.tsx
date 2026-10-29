import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { HeadlineBand } from "../headline-band";
import { attendanceFixture, financeFixture, hidden, journalFixture, ready, unavailable } from "./fixtures";

const band = () => screen.getByTestId("analytics-headline");

describe("HeadlineBand", () => {
  it("renders three linked tiles when every source is ready", () => {
    render(<HeadlineBand attendance={ready(attendanceFixture())} finance={ready(financeFixture())} journal={ready(journalFixture())} />);
    const links = within(band()).getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(screen.getByRole("link", { name: /^Kehadiran siswa 93 persen, 30 hari terakhir/ })).toHaveAttribute("href", "/admin/student-attendance");
    expect(screen.getByRole("link", { name: /^Penagihan bulan ini 78 persen/ })).toHaveAttribute("href", "/admin/invoices");
    expect(screen.getByRole("link", { name: "Buku penghubung 89 persen, kelengkapan minggu ini" })).toHaveAttribute("href", "/admin/student-journal/monitoring");
    expect(band()).toHaveTextContent("93%");
    expect(band()).toHaveTextContent("78%");
    expect(band()).toHaveTextContent("89%");
  });

  it("states the collected and billed amounts under the collection rate", () => {
    render(<HeadlineBand attendance={ready(attendanceFixture())} finance={ready(financeFixture())} journal={ready(journalFixture())} />);
    expect(screen.getByText("Rp 12,4 jt dari Rp 16 jt")).toBeVisible();
  });

  it("drops the finance tile and keeps two columns when finance is hidden", () => {
    render(<HeadlineBand attendance={ready(attendanceFixture())} finance={hidden} journal={ready(journalFixture())} />);
    expect(within(band()).getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByText("Penagihan bulan ini")).not.toBeInTheDocument();
    expect(band().querySelector(".md\\:grid-cols-2")).not.toBeNull();
  });

  it("shows a dash, not a zero, when a source failed", () => {
    render(<HeadlineBand attendance={unavailable} finance={ready(financeFixture())} journal={unavailable} />);
    const attendance = screen.getByRole("link", { name: "Kehadiran siswa belum dapat dimuat" });
    expect(attendance).toHaveTextContent("—");
    expect(attendance).toHaveTextContent("Data belum dapat dimuat");
    expect(attendance).not.toHaveTextContent("0%");
    expect(screen.getByRole("link", { name: "Buku penghubung belum dapat dimuat" })).toHaveTextContent("—");
  });

  it("shows a dash when a ready source has no number yet", () => {
    render(
      <HeadlineBand
        attendance={ready(attendanceFixture({ rate: null, previousRate: null, days: [] }))}
        finance={ready(financeFixture({ thisMonth: { billed: 0, paid: 0, rate: null } }))}
        journal={ready(journalFixture({ thisWeekPct: null }))}
      />,
    );
    for (const name of ["Kehadiran siswa belum ada data", "Penagihan bulan ini belum ada data", "Buku penghubung belum ada data"]) {
      const tile = screen.getByRole("link", { name });
      expect(tile).toHaveTextContent("—");
      expect(tile).toHaveTextContent("Belum ada data");
    }
  });

  describe("attendance delta chip", () => {
    const renderWith = (rate: number, previousRate: number | null) =>
      render(<HeadlineBand attendance={ready(attendanceFixture({ rate, previousRate }))} finance={hidden} journal={unavailable} />);

    it("shows points gained in the positive tone", () => {
      renderWith(93, 91);
      const chip = screen.getByText("+2 poin");
      expect(chip).toHaveClass("text-success-text");
      expect(screen.getByRole("link", { name: /naik 2 poin/ })).toBeVisible();
    });

    it("shows points lost in the critical tone, with a real minus sign", () => {
      renderWith(88, 91);
      const chip = screen.getByText("−3 poin");
      expect(chip).toHaveClass("text-destructive-text");
      expect(screen.getByRole("link", { name: /turun 3 poin/ })).toBeVisible();
    });

    it("shows Stabil when nothing changed", () => {
      renderWith(91, 91);
      expect(screen.getByText("Stabil")).toHaveClass("text-muted-foreground");
    });

    it("omits the chip when there is no previous window", () => {
      renderWith(91, null);
      expect(screen.queryByText(/poin/)).not.toBeInTheDocument();
      expect(screen.queryByText("Stabil")).not.toBeInTheDocument();
    });
  });
});
