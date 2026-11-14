import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CampusesPage from "../page";

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/hooks/use-permission", () => ({ usePermission: () => true }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

describe("CampusesPage mobile form", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps entered values after a save error and allows a retry from the sheet", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Nama sudah dipakai" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);

    render(<CampusesPage />);
    // The empty state (no campuses yet) also renders a "Tambah Kampus" CTA
    // alongside the page header's — the header one is first in the DOM.
    await user.click((await screen.findAllByRole("button", { name: "Tambah Kampus" }))[0]);

    const sheet = screen.getByRole("dialog", { name: "Tambah Kampus" });
    expect(sheet).toHaveAttribute("data-slot", "sheet-content");
    await user.type(within(sheet).getByRole("textbox", { name: /Nama/ }), "Kampus Timur");
    await user.click(within(sheet).getByRole("button", { name: "Tambah Kampus" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Nama sudah dipakai"));
    expect(within(sheet).getByRole("textbox", { name: /Nama/ })).toHaveValue("Kampus Timur");
    await user.click(within(sheet).getByRole("button", { name: "Tambah Kampus" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Kampus ditambahkan"));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/config/campuses", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"name":"Kampus Timur"'),
    }));
  });
});

describe("CampusesPage create dialog validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("blocks submit with an empty Nama, showing an inline error and firing no POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CampusesPage />);

    await user.click((await screen.findAllByRole("button", { name: "Tambah Kampus" }))[0]);
    const sheet = screen.getByRole("dialog", { name: "Tambah Kampus" });

    await user.click(within(sheet).getByRole("button", { name: "Tambah Kampus" }));

    expect(await within(sheet).findByText("Nama wajib diisi")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toBe(false);
  });
});

describe("CampusesPage empty state (Cycle 3 T7 — DataTable emptyAction)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows a 'Tambah Kampus' CTA in the empty state that opens the create dialog", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CampusesPage />);

    await screen.findByText("Belum ada kampus");
    const ctas = await screen.findAllByRole("button", { name: "Tambah Kampus" });
    expect(ctas).toHaveLength(2); // page header + empty-state CTA

    await user.click(ctas[1]);
    expect(screen.getByRole("dialog", { name: "Tambah Kampus" })).toBeInTheDocument();
  });

  it("omits the empty-state CTA on the 'Tidak ada kampus nonaktif' view (nothing to create there)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CampusesPage />);

    await user.click(await screen.findByRole("combobox", { name: "Filter Status" }));
    await user.click(await screen.findByRole("option", { name: "Tidak Aktif" }));

    await screen.findByText("Tidak ada kampus nonaktif");
    expect(screen.getAllByRole("button", { name: "Tambah Kampus" })).toHaveLength(1); // header only
  });
});

describe("CampusesPage list", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders campuses as a DataTable row — plain name, StatusBadge, no Lihat", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "campus-1",
          name: "Taman Aster",
          address: "Jl. Contoh No.1",
          lat: null,
          lng: null,
          status: "ACTIVE",
          _count: { employees: 3 },
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CampusesPage />);

    const name = await screen.findByText("Taman Aster");
    expect(name.closest("a")).toBeNull();
    const row = name.closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Aktif")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Lihat/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Lihat")).not.toBeInTheDocument();
  });

  it("hints to set a campus pin when no active campus has coordinates, and hides it once one does", async () => {
    const row = (lat: number | null, lng: number | null) => ({
      id: "campus-1", name: "Taman Aster", address: null, lat, lng, radiusMeters: 50, status: "ACTIVE", _count: { employees: 0 },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [row(null, null)] }));
    const { unmount } = render(<CampusesPage />);
    expect(await screen.findByTestId("campus-pin-hint")).toHaveTextContent("Atur titik lokasi kampus agar absensi guru dapat memeriksa jarak.");
    unmount();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [row(-6.2, 106.8)] }));
    render(<CampusesPage />);
    await screen.findByText("Taman Aster");
    expect(screen.queryByTestId("campus-pin-hint")).not.toBeInTheDocument();
  });
});

describe("CampusesPage load failure", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows an error state with 'Coba lagi' (not the empty state) and refetches on retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CampusesPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Daftar kampus belum bisa dimuat");
    expect(screen.queryByText("Belum ada kampus")).not.toBeInTheDocument();
    expect(toastError).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("Belum ada kampus")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

it("ignores an older active list after the status filter changes", async () => {
 let resolveOld!: (value: unknown) => void;
 const old = new Promise((resolve) => { resolveOld = resolve; });
 const row = (id: string, name: string, status: string) => ({ id, name, status, address: null, lat: null, lng: null, radiusMeters: 50, _count: { employees: 0 } });
 const fetchMock = vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce({ ok: true, json: async () => [row("inactive", "Kampus Nonaktif", "INACTIVE")] });
 vi.stubGlobal("fetch", fetchMock);
 const user = userEvent.setup();
 render(<CampusesPage />);
 await user.click(await screen.findByRole("combobox", { name: "Filter Status" }));
 await user.click(await screen.findByRole("option", { name: "Tidak Aktif" }));
 await screen.findByText("Kampus Nonaktif");
 await act(async () => { resolveOld({ ok: true, json: async () => [row("active", "Kampus Aktif Lama", "ACTIVE")] }); });
 expect(screen.getByText("Kampus Nonaktif")).toBeInTheDocument();
 expect(screen.queryByText("Kampus Aktif Lama")).not.toBeInTheDocument();
 vi.unstubAllGlobals();
});
