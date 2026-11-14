import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SentraClient } from "@/app/admin/sentra/client";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/admin/sentra",
}));

const replace = vi.fn();
const json = (body: unknown) => Promise.resolve({ ok: true, json: async () => body } as Response);

function stubFetch(campuses = [{ id: "cp1", name: "Metland" }]) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/config/campuses")) return json(campuses);
    if (url.includes("/api/admin/sentra/options")) {
      return json({ employees: [{ id: "e1", name: "Bu Ayu" }], classes: [], academicYears: [] });
    }
    if (url.includes("/api/admin/sentra?")) {
      return json({
        sentra: [
          { id: "s1", name: "Balok", status: "ACTIVE", sortOrder: 0, legacyCenter: null, teachers: [{ employeeId: "e1", name: "Bu Ayu" }] },
        ],
        rotations: [
          {
            id: "r1",
            name: "Putaran TK",
            startDate: "2026-11-09T00:00:00.000Z",
            cycleDays: 10,
            status: "ACTIVE",
            academicYear: { id: "y1", name: "2026/2027", status: "ACTIVE" },
            classes: [{ classSectionId: "c1", name: "TK A 3" }],
          },
        ],
      });
    }
    return json({});
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("SentraClient", () => {
  it("lists sentra with their guru and putaran linking to the detail page", async () => {
    vi.stubGlobal("fetch", stubFetch());
    render(<SentraClient canWrite />);
    expect(await screen.findByText("Sentra Balok")).toBeTruthy();
    expect(screen.getByText("Bu Ayu")).toBeTruthy();
    const link = await screen.findByRole("link", { name: "Putaran TK" });
    expect(link.getAttribute("href")).toBe("/admin/sentra/rotations/r1");
    expect(screen.getByRole("button", { name: "Tambah sentra" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Buat putaran" })).toBeTruthy();
  });

  it("hides write actions without academic.edit", async () => {
    vi.stubGlobal("fetch", stubFetch());
    render(<SentraClient canWrite={false} />);
    await screen.findByText("Sentra Balok");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Tambah sentra" })).toBeNull());
    expect(screen.queryByRole("button", { name: /^Ubah/ })).toBeNull();
  });

  it("hides the campus control when there is one campus", async () => {
    vi.stubGlobal("fetch", stubFetch());
    render(<SentraClient canWrite />);
    await screen.findByText("Sentra Balok");
    expect(screen.queryByRole("group", { name: "Kampus" })).toBeNull();
  });

  it("switches campus with short labels and updates the URL", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch([
        { id: "cp1", name: "An Nisaa' Sekolahku Metland" },
        { id: "cp2", name: "An Nisaa' Sekolahku Aster" },
      ]),
    );
    render(<SentraClient canWrite initialCampusId="cp2" />);
    const group = await screen.findByRole("group", { name: "Kampus" });
    expect(group.textContent).toBe("MetlandAster");
    expect(screen.getByRole("button", { name: "Aster" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Metland" }));
    expect(replace).toHaveBeenCalledWith("/admin/sentra?campusId=cp1");
  });
});
