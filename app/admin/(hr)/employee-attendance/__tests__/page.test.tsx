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
import userEvent from "@testing-library/user-event";

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

    // The figure is the row below the label + icon row.
    const alpaLabel = screen.getByText("Alpa");
    expect(alpaLabel.parentElement?.nextElementSibling?.textContent).toBe("0");

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

    // The figure is the row below the label + icon row.
    const alpaLabel = screen.getByText("Alpa");
    await vi.waitFor(() => expect(alpaLabel.parentElement?.nextElementSibling?.textContent).toBe("2"));
    expect(screen.queryByText("Libur")).not.toBeInTheDocument();
  });
});


describe("AttendancePage — Perlu persetujuan tab", () => {
  const PENDING = [
    {
      id: "att-1", date: "2026-05-02", status: "PRESENT", checkInTime: "2026-05-02T00:10:00.000Z",
      distanceMeters: 312, accuracy: 20, note: "Antar murid ke dokter", campusName: "Taman Aster",
      employee: { id: "e1", kode: "EMP-1", nama: "Budi Santoso", jabatan: "Guru" },
    },
  ];

  function fetchWithPending() {
    const base = stubFetch();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      if (url.includes("/api/attendance/pending")) return Promise.resolve({ ok: true, json: async () => PENDING } as Response);
      if (url.includes("/approve")) return Promise.resolve({ ok: true, json: async () => ({ count: 1 }) } as Response);
      return base(input);
    });
    return { fn, calls };
  }

  it("shows the count, the distance and note, and approves with one tap", async () => {
    const { fn, calls } = fetchWithPending();
    vi.stubGlobal("fetch", fn);
    const user = userEvent.setup();
    render(<AttendancePage />);

    expect(await screen.findByTestId("pending-count")).toHaveTextContent("1");
    await user.click(screen.getByRole("tab", { name: /Perlu persetujuan/ }));
    expect(await screen.findByText("± 312 m dari Taman Aster")).toBeInTheDocument();
    expect(screen.getByText(/Antar murid ke dokter/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Setujui$/ }));
    await vi.waitFor(() => expect(calls.some((c) => c.url === "/api/attendance/att-1/approve" && c.init?.method === "POST")).toBe(true));
  });

  it("'Setujui semua' posts the listed ids", async () => {
    const { fn, calls } = fetchWithPending();
    vi.stubGlobal("fetch", fn);
    const user = userEvent.setup();
    render(<AttendancePage />);

    await user.click(await screen.findByRole("tab", { name: /Perlu persetujuan/ }));
    await user.click(await screen.findByRole("button", { name: /Setujui semua/ }));
    await vi.waitFor(() => {
      const call = calls.find((c) => c.url === "/api/attendance/approve-all");
      expect(call && JSON.parse(String(call.init?.body))).toEqual({ ids: ["att-1"] });
    });
  });

  it("'Tolak' asks for an optional note, then rejects", async () => {
    const { fn, calls } = fetchWithPending();
    vi.stubGlobal("fetch", fn);
    const user = userEvent.setup();
    render(<AttendancePage />);

    await user.click(await screen.findByRole("tab", { name: /Perlu persetujuan/ }));
    await user.click(await screen.findByRole("button", { name: "Tolak" }));
    await user.type(await screen.findByLabelText("Catatan (opsional)"), "Tidak sesuai");
    await user.click(screen.getAllByRole("button", { name: "Tolak" }).at(-1)!);
    await vi.waitFor(() => {
      const call = calls.find((c) => c.url === "/api/attendance/att-1/reject");
      expect(call && JSON.parse(String(call.init?.body))).toEqual({ note: "Tidak sesuai" });
    });
  });
});
