import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import MonthlyAttendancePage from "./page";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/admin/employee-attendance/monthly",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const CAMPUSES = [{ id: "cp1", name: "An Nisaa' Metland" }, { id: "cp2", name: "An Nisaa' Aster" }];

beforeEach(() => {
  replace.mockClear();
  search = "campusId=cp2";
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/api/config/campuses") ? CAMPUSES : [];
      return Promise.resolve({ ok: true, json: async () => body } as Response);
    }),
  );
});

describe("MonthlyAttendancePage campus", () => {
  it("applies ?campusId to the query and the back link", async () => {
    render(<MonthlyAttendancePage />);
    await vi.waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes("/api/attendance/monthly") && String(u).includes("campusId=cp2")),
      ).toBe(true),
    );
    expect(screen.getByRole("link", { name: /Kembali ke Harian/ }).getAttribute("href")).toBe(
      "/admin/employee-attendance?campusId=cp2",
    );
  });
});
