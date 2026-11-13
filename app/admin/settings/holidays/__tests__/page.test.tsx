/**
 * /admin/settings/holidays — the worked example for the useZodForm +
 * FormField + FormDialogFooter + applyServerErrors pattern
 * (lib/forms/use-zod-form.ts, components/ui/form.tsx,
 * lib/forms/server-errors.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Desktop Dialog branch (not the mobile Sheet) — deterministic regardless of
// the coarse-pointer mock below, which is only for DatePicker.
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import HolidaysPage from "../page";

function mockCoarsePointer() {
  return vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("coarse"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

function fixture(overrides: { post?: unknown; postOk?: boolean } = {}) {
  const { post = {}, postOk = true } = overrides;
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/config/holidays" && (!init || init.method === undefined)) {
      return { ok: true, json: async () => [] };
    }
    if (input === "/api/config/holidays" && init?.method === "POST") {
      return { ok: postOk, status: postOk ? 200 : 400, json: async () => post };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("HolidaysPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("opens the Tambah Hari Libur dialog from the page header", async () => {
    mockCoarsePointer();
    fixture();
    const user = userEvent.setup();
    render(<HolidaysPage />);

    await user.click(await screen.findByRole("button", { name: "Tambah Hari Libur" }));

    const dialog = await screen.findByRole("dialog", { name: "Tambah Hari Libur" });
    expect(within(dialog).getByLabelText("Tanggal", { exact: false })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Nama", { exact: false })).toBeInTheDocument();
  });

  it("blocks submit with empty required fields, showing inline errors and firing no POST", async () => {
    mockCoarsePointer();
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<HolidaysPage />);

    await user.click(await screen.findByRole("button", { name: "Tambah Hari Libur" }));
    const dialog = await screen.findByRole("dialog", { name: "Tambah Hari Libur" });

    await user.click(within(dialog).getByRole("button", { name: "Tambah Hari Libur" }));

    expect(await within(dialog).findByText("Tanggal wajib diisi")).toBeInTheDocument();
    expect(within(dialog).getByText("Nama hari libur wajib diisi")).toBeInTheDocument();

    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toBe(false);
  });

  it("submits the filled form as POST /api/config/holidays with the expected body", async () => {
    mockCoarsePointer();
    const fetchMock = fixture({ post: { id: "h-1" } });
    const user = userEvent.setup();
    render(<HolidaysPage />);

    await user.click(await screen.findByRole("button", { name: "Tambah Hari Libur" }));
    const dialog = await screen.findByRole("dialog", { name: "Tambah Hari Libur" });

    fireEvent.change(within(dialog).getByLabelText("Tanggal", { exact: false }), {
      target: { value: "2026-03-01" },
    });
    await user.type(within(dialog).getByLabelText("Nama", { exact: false }), "Hari Raya Idul Fitri");

    await user.click(within(dialog).getByRole("button", { name: "Tambah Hari Libur" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/config/holidays" && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
    });

    const [, postInit] = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/config/holidays" && (init as RequestInit | undefined)?.method === "POST",
    )!;
    expect(JSON.parse((postInit as RequestInit).body as string)).toEqual({
      date: "2026-03-01",
      name: "Hari Raya Idul Fitri",
      type: "NATIONAL",
      isHalfDay: false,
    });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Hari libur ditambahkan"));
  });

  it("shows a server field error under Nama on a 400 response, without closing the dialog", async () => {
    mockCoarsePointer();
    fixture({
      postOk: false,
      post: {
        error: "Validasi gagal",
        errors: [{ field: "name", message: "Nama sudah dipakai" }],
      },
    });
    const user = userEvent.setup();
    render(<HolidaysPage />);

    await user.click(await screen.findByRole("button", { name: "Tambah Hari Libur" }));
    const dialog = await screen.findByRole("dialog", { name: "Tambah Hari Libur" });

    fireEvent.change(within(dialog).getByLabelText("Tanggal", { exact: false }), {
      target: { value: "2026-03-01" },
    });
    await user.type(within(dialog).getByLabelText("Nama", { exact: false }), "Hari Raya Idul Fitri");

    await user.click(within(dialog).getByRole("button", { name: "Tambah Hari Libur" }));

    expect(await within(dialog).findByText("Nama sudah dipakai")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Tambah Hari Libur" })).toBeInTheDocument();
  });
});

describe("HolidaysPage load failure", () => {
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
    render(<HolidaysPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Daftar hari libur belum bisa dimuat");
    expect(screen.queryByText("Belum ada hari libur")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("Belum ada hari libur")).toBeInTheDocument();
  });
});
