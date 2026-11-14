import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

import { ReportCardsList } from "../report-cards-list";
import type { ParentReportCard } from "@/lib/parent-helpers";

function card(over: Partial<ParentReportCard> = {}): ParentReportCard {
  return {
    termId: "t1",
    period: "Triwulan 1 · Semester 1 · 2026/2027",
    publishedAt: "2026-10-06T22:30:00.000Z",
    sections: [],
    attendance: { sick: 0, permitted: 0, unexcused: 0, total: 0 },
    hafalan: null,
    height: null,
    weight: null,
    ...over,
  };
}

const latest = () => card({ termId: "t2", period: "Triwulan 2 · Semester 1 · 2026/2027", publishedAt: "2026-12-20T03:00:00.000Z" });

// "Diterbitkan …" only renders on the history rows (the newest rapor gets the
// celebration card), so each case puts the timestamp under test on an older term.
describe("ReportCardsList — 'Diterbitkan' on the Asia/Jakarta day", () => {
  it("a raport published at 22:30Z on the 6th reads 7 Oktober", () => {
    render(<ReportCardsList data={[latest(), card()]} studentId="s1" />);
    expect(screen.getByText("Diterbitkan 7 Oktober 2026")).toBeInTheDocument();
    expect(screen.queryByText(/6 Oktober 2026/)).not.toBeInTheDocument();
  });

  it("a UTC-midnight timestamp does not shift", () => {
    render(<ReportCardsList data={[latest(), card({ publishedAt: "2026-02-05T00:00:00.000Z" })]} studentId="s1" />);
    expect(screen.getByText("Diterbitkan 5 Februari 2026")).toBeInTheDocument();
  });

  it("falls back to 'Sudah terbit' without a publish date", () => {
    render(<ReportCardsList data={[latest(), card({ publishedAt: null })]} studentId="s1" />);
    expect(screen.getByText("Sudah terbit")).toBeInTheDocument();
  });
});


describe("ReportCardsList reader", () => {
  it("starts with child and period focused, keeps PDF available, and reopens at the beginning", async () => {
    const openPdf = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<ReportCardsList data={[card({ sections: [{ label: "Perkembangan", narrative: "Narasi panjang. ".repeat(1000), level: null }] })]} studentId="s1" childName="Aisyah" />);
    fireEvent.click(screen.getByRole("button", { name: "Buka rapor" }));
    const title = await screen.findByRole("heading", { name: "Rapor — Aisyah" });
    await waitFor(() => expect(title).toHaveFocus());
    const viewport = document.querySelector('[data-slot="scroll-area-viewport"]')!;
    viewport.scrollTop = 2000;
    fireEvent.click(screen.getByRole("button", { name: "Unduh PDF" }));
    expect(openPdf).toHaveBeenCalledWith("/api/guardian/report-cards/s1/t1/pdf", "_blank");
    fireEvent.click(screen.getByRole("button", { name: "Tutup" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Buka rapor" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Rapor — Aisyah" })).toHaveFocus());
    expect(document.querySelector('[data-slot="scroll-area-viewport"]')?.scrollTop).toBe(0);
    openPdf.mockRestore();
  });
});
