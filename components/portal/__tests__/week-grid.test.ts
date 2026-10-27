// Routed to the `jsdom` project by name in vitest.config.ts — `*.test.ts`
// otherwise runs under `node`, and this suite renders WeekGrid rather than
// only exercising the `isWeekGridDateEditable` predicate.
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { isWeekGridDateEditable, WeekGrid } from "../week-grid";

// WeekGrid reads "today" via getTodayInTimezone("Asia/Jakarta") internally
// (for the today-column highlight and the editable-cell predicate). Pin it
// so the component tests below are deterministic regardless of wall-clock
// time — matches the `today` constant used throughout this file.
vi.mock("@/lib/attendance/timezone", () => ({
  getTodayInTimezone: () => "2026-07-30",
}));

describe("isWeekGridDateEditable", () => {
  const today = "2026-07-30";

  it("lets admin correction mode edit past dates but not future dates", () => {
    expect(isWeekGridDateEditable("2026-07-29", today, false)).toBe(true);
    expect(isWeekGridDateEditable(today, today, false)).toBe(true);
    expect(isWeekGridDateEditable("2026-07-31", today, false)).toBe(false);
  });

  it("keeps parent anti-backfill mode limited to today", () => {
    expect(isWeekGridDateEditable("2026-07-29", today, true)).toBe(false);
    expect(isWeekGridDateEditable(today, today, true)).toBe(true);
  });

  describe("windowed backfill mode (4th arg — parent Di Rumah)", () => {
    // today = 2026-07-30 (Thursday); floor = Monday of the previous week,
    // matching `homeEntryEditFloor` semantics from lib/student-journal/backfill.ts.
    const floor = "2026-07-20";

    it("allows a date inside the window", () => {
      expect(isWeekGridDateEditable("2026-07-23", today, true, floor)).toBe(true);
    });

    it("allows the date exactly on the floor", () => {
      expect(isWeekGridDateEditable(floor, today, true, floor)).toBe(true);
    });

    it("rejects the date one day before the floor", () => {
      expect(isWeekGridDateEditable("2026-07-19", today, true, floor)).toBe(false);
    });

    it("rejects a future date even inside disablePastDays + a floor", () => {
      expect(isWeekGridDateEditable("2026-07-31", today, true, floor)).toBe(false);
    });

    it("allows today regardless of the floor", () => {
      expect(isWeekGridDateEditable(today, today, true, floor)).toBe(true);
    });
  });

  it("uses explicit non-editable history glyphs in readonly mode", () => {
    render(createElement(WeekGrid, {
      categories: [{ id: "cat", name: "Kemandirian", scope: "SCHOOL", indicators: [{ id: "ind", label: "Merapi", order: 1 }] }],
      entries: [{ indicatorId: "ind", date: "2026-07-29", checked: true }],
      dates: ["2026-07-29", "2026-07-30"],
    }));

    // The glyphs are drawn, not typed: "✓"/"—" as text rendered a filled week
    // and an empty one at the same weight and colour (cycle C, T5). The
    // accessible names carry the meaning either way, and neither cell is a
    // control in readonly mode.
    const filled = screen.getByRole("img", { name: "Merapi 2026-07-29 — diisi (hanya bisa dilihat)" });
    const empty = screen.getByRole("img", { name: "Merapi 2026-07-30 — belum diisi (hanya bisa dilihat)" });
    expect(filled.querySelector("svg")).not.toBeNull();
    expect(empty.querySelector("svg")).toBeNull();
    expect(screen.queryByRole("button", { name: /Merapi/ })).toBeNull();
  });

  it("renders the shared EmptyState (not a bare paragraph) when there are no categories", () => {
    render(createElement(WeekGrid, {
      categories: [],
      entries: [],
      dates: ["2026-07-29", "2026-07-30"],
    }));

    // Title + description come from EmptyState, not a hand-rolled <p>.
    expect(screen.getByText("Belum ada indikator")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Indikator pemantauan belum dikonfigurasi untuk kelas ini. Hubungi admin sekolah untuk mengatur Buku Penghubung.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders a previous-week day as tappable for the parent Di Rumah grid but locked for the teacher today-only grid", () => {
    // today (mocked) = 2026-07-30; previousWeekDay = 2026-07-23, inside the
    // parent's window (floor 2026-07-20) but outside teacher today-only mode.
    const previousWeekDay = "2026-07-23";
    const category = {
      id: "cat",
      name: "Ibadah",
      scope: "HOME",
      indicators: [{ id: "ind", label: "Sholat", order: 1 }],
    };

    const { unmount } = render(createElement(WeekGrid, {
      categories: [category],
      entries: [],
      dates: [previousWeekDay, today],
      editable: true,
      onToggle: () => {},
      disablePastDays: true,
      earliestEditableDate: "2026-07-20",
    }));
    expect(
      screen.getByRole("button", { name: `Sholat ${previousWeekDay} — belum diisi` }),
    ).not.toBeDisabled();
    unmount();

    render(createElement(WeekGrid, {
      categories: [category],
      entries: [],
      dates: [previousWeekDay, today],
      editable: true,
      onToggle: () => {},
      // disablePastDays defaults to true, no earliestEditableDate — teacher today-only.
    }));
    expect(
      screen.getByRole("button", {
        name: `Sholat ${previousWeekDay} — belum diisi — hanya hari ini bisa diubah`,
      }),
    ).toBeDisabled();
  });

  it("names the feature the way the reader's portal names it", () => {
    // Staff call this Buku Penghubung; parents only ever see "Jurnal". The
    // default must stay the staff term so admin/teacher call sites that pass
    // nothing are unaffected.
    render(createElement(WeekGrid, {
      categories: [],
      entries: [],
      dates: ["2026-07-29"],
      featureLabel: "Jurnal",
    }));

    expect(
      screen.getByText(
        "Indikator pemantauan belum dikonfigurasi untuk kelas ini. Hubungi admin sekolah untuk mengatur Jurnal.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Buku Penghubung/)).toBeNull();
  });
});

describe("WeekGrid — hari tanpa buku penghubung", () => {
  const categories = [{ id: "cat", name: "Kemandirian", scope: "SCHOOL", indicators: [{ id: "ind", label: "Merapi", order: 1 }] }];
  const dates = ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"];

  it("names the day and its keterangan above the grid, and flags the column header", () => {
    render(createElement(WeekGrid, { categories, entries: [], dates, dayMarks: { "2026-07-28": "Renang" } }));
    expect(screen.getByTestId("day-mark-notes")).toHaveTextContent("Sel 28/07 · Tanpa buku penghubung: Renang");
    expect(screen.getByRole("img", { name: "Tanpa buku penghubung: Renang" })).toBeInTheDocument();
  });

  it("explains an unfilled cell on a marked day instead of calling it belum diisi", () => {
    render(createElement(WeekGrid, { categories, entries: [], dates, dayMarks: { "2026-07-28": "Renang" } }));
    expect(screen.getByRole("img", { name: "Merapi 2026-07-28 — tanpa buku penghubung (Renang) (hanya bisa dilihat)" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Merapi 2026-07-29 — belum diisi (hanya bisa dilihat)" })).toBeInTheDocument();
  });

  it("keeps a tick that exists on a marked day", () => {
    render(createElement(WeekGrid, {
      categories, dates, dayMarks: { "2026-07-28": "Renang" },
      entries: [{ indicatorId: "ind", date: "2026-07-28", checked: true }],
    }));
    expect(screen.getByRole("img", { name: "Merapi 2026-07-28 — diisi (hanya bisa dilihat)" })).toBeInTheDocument();
  });

  it("shows no mark list for a week without marks, and still shows the empty-week note", () => {
    render(createElement(WeekGrid, { categories, entries: [], dates, emptyWeekMessage: "Belum diisi." }));
    expect(screen.queryByTestId("day-mark-notes")).toBeNull();
    expect(screen.getByTestId("empty-week-note")).toBeInTheDocument();
  });

  it("drops the 'belum diisi' empty-week note when the week holds a marked day", () => {
    render(createElement(WeekGrid, { categories, entries: [], dates, dayMarks: { "2026-07-28": "Libur" }, emptyWeekMessage: "Belum diisi." }));
    expect(screen.queryByTestId("empty-week-note")).toBeNull();
  });
});
