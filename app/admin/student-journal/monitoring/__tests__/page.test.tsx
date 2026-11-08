/**
 * /admin/student-journal/monitoring — ACAD-8: the "Kelas sudah isi" card must
 * agree with the "Terakhir diisi" column. A class with a few checked entries in
 * a big roster rounds to 0% but still has a last-filled date, so it counts as
 * filled; the card used to test the rounded percentage.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// One "label: value" line per card so each can be read exactly.
vi.mock("@/components/ui/stat-tile", () => ({
  StatTile: ({ label, value }: { label: string; value: string | number }) => (
    <p data-testid={`stat-${label}`}>{label}: {value}</p>
  ),
}));

import MonitoringPage from "../page";

const ROWS = [
  // 4 checked entries in a large roster: 0% after rounding, but filled on 29 Sep.
  { classSectionId: "kb", className: "KB", programName: "KB", studentCount: 40, checkedCount: 4, completionPct: 0, lastFilledAt: "2026-09-29T03:00:00.000Z" },
  { classSectionId: "tka", className: "TK A", programName: "TK", studentCount: 10, checkedCount: 30, completionPct: 60, lastFilledAt: "2026-09-28T03:00:00.000Z" },
  { classSectionId: "tkb", className: "TK B", programName: "TK", studentCount: 10, checkedCount: 0, completionPct: 0, lastFilledAt: null },
];

describe("MonitoringPage KPI definition (ACAD-8)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("counts a class with any checked entry as filled, matching its 'Terakhir diisi' date", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: ROWS, summary: { activeStudentCount: 60 } }),
      })),
    );

    render(<MonitoringPage />);

    await waitFor(() =>
      expect(screen.getByTestId("stat-Kelas sudah isi")).toHaveTextContent("Kelas sudah isi: 2 / 3"),
    );
    expect(screen.getByTestId("stat-Kelas belum isi")).toHaveTextContent("Kelas belum isi: 1");
    // The two rows with a fill date are exactly the two "filled" classes.
    expect(ROWS.filter((r) => r.lastFilledAt).length).toBe(2);
  });
});
