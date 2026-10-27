/**
 * /admin/student-journal/classes/[id] — the admin can mark a class-day "hari
 * tanpa buku penghubung" (and correct a past one) beside the weekly roll-up.
 */
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("weekStart=2026-10-26"),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/attendance/timezone", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/attendance/timezone")>()),
  getTodayInTimezone: () => "2026-10-28", // Wednesday: Thu + Fri are still in the future
}));
vi.mock("@/components/ui/data-table", () => ({ DataTable: () => <div data-testid="table" /> }));
vi.mock("@/components/student-journal/day-mark-dialog", () => ({
  DayMarkDialog: ({ open, date, initialReason, onSaved }: { open: boolean; date: string; initialReason?: string | null; onSaved: (r: string | null) => void }) =>
    open ? (
      <div role="dialog">
        Dialog {date} {initialReason ?? "baru"}
        <button onClick={() => onSaved("Renang")}>Simpan tanda</button>
      </div>
    ) : null,
}));

import ClassWeekPage from "../page";

const DATES = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
let marks: Record<string, string>;

beforeEach(() => {
  marks = { "2026-10-27": "Libur" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).includes("class-roll-up")
          ? { data: { weekStart: "2026-10-26", dates: DATES, dayMarks: marks, students: [] } }
          : { data: [{ classSectionId: "c1", className: "TK A", programName: "TK" }] },
    })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// React's `use()` reads `status`/`value` off an already-settled thenable instead of suspending.
const settledParams = Object.assign(Promise.resolve({ id: "c1" }), { status: "fulfilled", value: { id: "c1" } });
const renderPage = () =>
  render(
    <Suspense fallback={null}>
      <ClassWeekPage params={settledParams} />
    </Suspense>,
  );

describe("ClassWeekPage — hari tanpa buku penghubung", () => {
  it("lists the school days with their keterangan and Tandai / Ubah buttons up to today", async () => {
    renderPage();
    expect(await screen.findByTestId("day-mark-2026-10-27")).toHaveTextContent("Libur");
    expect(screen.getByTestId("day-mark-button-2026-10-27")).toHaveTextContent("Ubah");
    expect(screen.getByTestId("day-mark-button-2026-10-26")).toHaveTextContent("Tandai");
    expect(screen.getByTestId("day-mark-button-2026-10-28")).toBeInTheDocument();
    // Thursday and Friday have not happened yet.
    expect(screen.queryByTestId("day-mark-button-2026-10-29")).toBeNull();
    expect(screen.queryByTestId("day-mark-button-2026-10-30")).toBeNull();
  });

  it("opens the dialog for the tapped day with its current keterangan, then reloads the roll-up", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("day-mark-button-2026-10-27"));
    expect(screen.getByRole("dialog")).toHaveTextContent("Dialog 2026-10-27 Libur");
    const rollUpCalls = () => (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) => String(u).includes("class-roll-up")).length;
    const before = rollUpCalls();
    marks = { "2026-10-27": "Renang" };
    fireEvent.click(screen.getByRole("button", { name: "Simpan tanda" }));
    await waitFor(() => expect(rollUpCalls()).toBe(before + 1));
    expect(await screen.findByTestId("day-mark-2026-10-27")).toHaveTextContent("Renang");
  });

  it("opens an empty dialog for an unmarked day", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("day-mark-button-2026-10-26"));
    expect(screen.getByRole("dialog")).toHaveTextContent("Dialog 2026-10-26 baru");
  });
});
