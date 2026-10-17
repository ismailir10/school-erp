/**
 * Cycle 3 T7/T8 — regression test for the "Alpa" bug: a weekend `today`
 * with no attendance records used to render every employee as "Alpa" (the
 * page's module-level `TODAY_ISO` meant the past/today distinction in
 * `computeAbsentCount` never applied to a live weekend view). The date is
 * now non-working-day-aware regardless of past/today/future, and rows with
 * no record on such a day render "Libur" instead of the "—" Alpa badge.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import AttendancePage from "../page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Freezes "today" to a known Saturday (2026-05-02 — same fixture date used
// by absent-stat.test.ts) so this test doesn't depend on the real clock.
vi.mock("@/lib/attendance/timezone", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/attendance/timezone")>();
  return { ...actual, getTodayInTimezone: () => "2026-05-02" };
});

const EMPLOYEES = [
  {
    employee: { id: "e1", kode: "EMP-1", nama: "Budi Santoso", jabatan: "Guru", campusName: "Kampus A" },
    attendance: null,
  },
  {
    employee: { id: "e2", kode: "EMP-2", nama: "Sari Wulandari", jabatan: "Guru", campusName: "Kampus A" },
    attendance: null,
  },
];

function stubFetch(orgConfig: unknown = null) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/config/org")) {
      return Promise.resolve({ ok: true, json: async () => orgConfig } as Response);
    }
    if (url.includes("/api/attendance/today")) {
      return Promise.resolve({ ok: true, json: async () => EMPLOYEES } as Response);
    }
    if (url.includes("/api/config/campuses")) {
      return Promise.resolve({ ok: true, json: async () => [] } as Response);
    }
    if (url.includes("/api/config/holidays")) {
      return Promise.resolve({ ok: true, json: async () => [] } as Response);
    }
    if (url.includes("/api/attendance/trend")) {
      return Promise.resolve({ ok: true, json: async () => [] } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

describe("AttendancePage — weekend view (Alpa fix)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", stubFetch());
  });

  it("shows Alpa = 0 and 'Libur' rows on a weekend with no records, instead of counting everyone absent", async () => {
    render(<AttendancePage />);

    await screen.findByText("Budi Santoso");

    const alpaLabel = screen.getByText("Alpa");
    expect(alpaLabel.nextElementSibling?.textContent).toBe("0");

    const liburBadges = screen.getAllByText("Libur");
    // Two employees, each badged twice: in the Status column (md+) and in the
    // phone-only meta line under the name (DataTableMobileMeta).
    expect(liburBadges).toHaveLength(4);
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });
});

describe("AttendancePage — tenant that works on Saturday", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      stubFetch({ workingDays: JSON.stringify(["MON", "TUE", "WED", "THU", "FRI", "SAT"]) }),
    );
  });

  it("counts Saturday no-shows as Alpa and shows no Libur rows", async () => {
    render(<AttendancePage />);

    await screen.findByText("Budi Santoso");

    const alpaLabel = screen.getByText("Alpa");
    await vi.waitFor(() => expect(alpaLabel.nextElementSibling?.textContent).toBe("2"));
    expect(screen.queryByText("Libur")).not.toBeInTheDocument();
  });
});

