import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { RailStatTiles } from "@/components/admin/detail-rail";
import { StudentRail } from "../rail-content";
import { buildRailTiles } from "../rail-tiles";

const counts = { present: 18, absent: 0, sick: 1, permission: 1, total: 20 };
const raport = { published: 0, draft: 1, total: 2, current: null };

function tiles(over: Partial<Parameters<typeof buildRailTiles>[0]> = {}) {
  return buildRailTiles({ overviewError: false, attendanceCounts: counts, raportTally: raport, ...over });
}
function show(t: ReturnType<typeof tiles>) {
  return render(<RailStatTiles tiles={t} />);
}

describe("buildRailTiles", () => {
  it("shows attendance and report tiles with the shared icons", () => {
    const summaryTiles = tiles();
    expect(summaryTiles.map((tile) => tile.label)).toEqual(["Hadir bulan ini", "Rapor"]);
    show(summaryTiles);
    expect(screen.getAllByTestId("stat-tile-icon")).toHaveLength(2);
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
