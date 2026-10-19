import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { RailStatTiles } from "@/components/admin/detail-rail";
import { EMPTY_INVOICE_SUMMARY, type StudentInvoiceSummary } from "@/lib/finance/student-invoice-summary";
import { StudentRail } from "../rail-content";
import { buildRailTiles } from "../rail-tiles";

const settled = { loading: false, error: false, summary: EMPTY_INVOICE_SUMMARY };
const counts = { present: 18, absent: 0, sick: 1, permission: 1, total: 20 };
const raport = { published: 0, draft: 1, total: 2, current: null };

function tiles(over: Partial<Parameters<typeof buildRailTiles>[0]> = {}) {
  return buildRailTiles({ invoices: settled, overviewError: false, attendanceCounts: counts, raportTally: raport, ...over });
}
function show(t: ReturnType<typeof tiles>) {
  return render(<RailStatTiles tiles={t} />);
}

describe("buildRailTiles", () => {
  it("has exactly Tunggakan (wide), Hadir bulan ini and Raport", () => {
    const t = tiles();
    expect(t.map((x) => x.label)).toEqual(["Tunggakan", "Hadir bulan ini", "Raport"]);
    expect(t[0].wide).toBe(true);
  });

  it("shows what is owed in the critical tone, with count and nearest due date", () => {
    const summary: StudentInvoiceSummary = { ...EMPTY_INVOICE_SUMMARY, outstanding: 1250000, unpaidCount: 2, nearestDue: "2026-10-10" };
    const t = tiles({ invoices: { loading: false, error: false, summary } });
    expect(t[0].tone).toBe("critical");
    expect(t[0].hint).toBe("2 tagihan belum lunas · 10 Okt 2026");
    show(t);
    expect(screen.getByText("Rp 1.250.000").className).toContain("font-currency");
  });

  it("says Lunas semua in the positive tone when nothing is owed", () => {
    const t = tiles();
    expect(t[0].tone).toBe("positive");
    expect(t[0].hint).toBe("Lunas semua");
  });

  it("shows Memuat… while invoices load and a dash on error, never Rp 0", () => {
    show(tiles({ invoices: { loading: true, error: false, summary: EMPTY_INVOICE_SUMMARY } }));
    expect(screen.getByText("Memuat…")).toBeInTheDocument();
    expect(screen.queryByText("Rp 0")).not.toBeInTheDocument();
  });

  it("shows a dash when the invoices fail", () => {
    show(tiles({ invoices: { loading: false, error: true, summary: EMPTY_INVOICE_SUMMARY }, attendanceCounts: counts, raportTally: raport }));
    expect(screen.queryByText("Rp 0")).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(1);
  });

  it("reads attendance and raport from the overview", () => {
    show(tiles());
    expect(screen.getByText("18/20")).toBeInTheDocument();
    expect(screen.getByText("1 sakit · 1 izin")).toBeInTheDocument();
    expect(screen.getByText("0/2")).toBeInTheDocument();
    expect(screen.getByText("1 draf")).toBeInTheDocument();
  });

  it("shows Memuat… for both overview tiles until it lands and dashes when it fails", () => {
    const { unmount } = show(tiles({ attendanceCounts: null, raportTally: null }));
    expect(screen.getAllByText("Memuat…")).toHaveLength(2);
    unmount();
    show(tiles({ overviewError: true, attendanceCounts: null, raportTally: null }));
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("dashes a month with no attendance and a calendar with no terms", () => {
    show(tiles({ attendanceCounts: { ...counts, total: 0, present: 0 }, raportTally: { ...raport, total: 0, draft: 0 } }));
    expect(screen.getByText("Belum ada absensi bulan ini")).toBeInTheDocument();
    expect(screen.getByText("Triwulan belum dibuat")).toBeInTheDocument();
  });
});

describe("StudentRail", () => {
  it("is desktop only and holds the tiles plus Jejak, nothing else", () => {
    render(<StudentRail tiles={tiles()} createdAt="2026-07-01T00:00:00.000Z" fromEnrollmentApplication={null} />);
    const aside = screen.getByLabelText("Ringkasan", { selector: "aside" });
    expect(aside.className).toContain("hidden");
    expect(aside.className).toContain("lg:flex");
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Jejak"]);
    for (const gone of ["Usia", "Kelas Aktif", "Wali Aktif", "Berkas", "Ringkasan", "Kontak Cepat", "Kelengkapan Berkas"]) {
      expect(screen.queryByText(gone, { selector: "h3, p, span, div" })).not.toBeInTheDocument();
    }
    expect(screen.getByText("Input manual")).toBeInTheDocument();
    expect(screen.getByText("1 Jul 2026")).toBeInTheDocument();
  });

  it("links to the formulir for a converted student", () => {
    render(<StudentRail tiles={[]} createdAt={null} fromEnrollmentApplication="app1" />);
    expect(screen.getByRole("link", { name: "Formulir pendaftaran →" })).toHaveAttribute("href", "/admin/enrollments/app1");
  });
});
