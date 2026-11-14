vi.mock("@/hooks/use-permission", () => ({ usePermissions: () => () => true, usePermission: () => true }));
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DailyStaffAttendancePage from "./page";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/admin/employee-attendance/daily",
  useSearchParams: () => new URLSearchParams(search),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const ROWS = [
  {
    employee: { id: "e1", kode: "E1", nama: "Budi Santoso", jabatan: "Satpam", campusId: "c1", campusName: "Kampus A" },
    attendance: null,
  },
  {
    employee: { id: "e2", kode: "E2", nama: "Sari", jabatan: "Guru", campusId: "c1", campusName: "Kampus A" },
    attendance: { id: "a2", status: "PRESENT", checkInTime: null, source: "SELF", approvalStatus: "APPROVED", isLocked: true },
  },
];

beforeEach(() => {
  replace.mockClear();
  search = "";
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/attendance/daily")) {
        return Promise.resolve({ ok: true, json: async () => ({ date: "2026-11-07", today: "2026-11-07", timezone: "Asia/Jakarta", rows: ROWS }) } as Response);
      }
      if (url.includes("/api/config/campuses")) {
        return Promise.resolve({ ok: true, json: async () => [{ id: "cp1", name: "An Nisaa' Metland" }, { id: "cp2", name: "An Nisaa' Aster" }] } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => [] } as Response);
    }),
  );
});

describe("DailyStaffAttendancePage", () => {
  it("lists staff grouped by campus with the bulk action and disables locked rows", async () => {
    render(<DailyStaffAttendancePage />);
    expect(await screen.findByText("Budi Santoso")).toBeTruthy();
    expect(screen.getByText("Kampus A")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Budi Santoso" })).toHaveAttribute("href", "/admin/employees/e1");
    expect(screen.getByRole("button", { name: /Tandai semua hadir \(1\)/ })).toBeTruthy();
    const lockedGroup = screen.getByRole("group", { name: "Status Sari" });
    for (const b of lockedGroup.querySelectorAll("button")) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it("bulk posts for the shown date", async () => {
    const user = userEvent.setup();
    render(<DailyStaffAttendancePage />);
    await user.click(await screen.findByRole("button", { name: /Tandai semua hadir/ }));
    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes("/daily/bulk"));
      expect(calls).toHaveLength(1);
      expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ date: "2026-11-07" });
    });
  });

  it("applies ?campusId, keeps it in the bulk body and in the back link", async () => {
    search = "campusId=cp2";
    const user = userEvent.setup();
    render(<DailyStaffAttendancePage />);
    await user.click(await screen.findByRole("button", { name: /Tandai semua hadir/ }));
    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes("/daily/bulk"));
      expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ date: "2026-11-07", campusId: "cp2" });
    });
    expect(screen.getByRole("link", { name: /Kembali ke Kehadiran/ }).getAttribute("href")).toBe(
      "/admin/employee-attendance?campusId=cp2",
    );
  });

  it("writes the chosen campus back to the URL", async () => {
    const user = userEvent.setup();
    render(<DailyStaffAttendancePage />);
    await screen.findByText("Budi Santoso");
    await vi.waitFor(() => expect(screen.getAllByRole("combobox").some((e) => /Semua Kampus/.test(e.textContent ?? ""))).toBe(true));
    await user.click(screen.getAllByRole("combobox").find((e) => /Semua Kampus/.test(e.textContent ?? ""))!);
    await user.click(await screen.findByRole("option", { name: "Aster" }));
    expect(replace).toHaveBeenCalledWith("/admin/employee-attendance/daily?campusId=cp2", { scroll: false });
  });
});
