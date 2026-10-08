import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import * as React from "react";

import EmployeesPage from "../page";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// The row-action dropdown is Base UI; its open/close timing is not what these
// tests are about (a pointer click right after open is sometimes swallowed, a
// ~1-in-4 flake). Render the actions as plain buttons wired to the same props.
vi.mock("@/components/ui/data-table-row-actions", () => ({
  DataTableRowActions: ({ onDeactivate, onActivate }: { onDeactivate?: () => void; onActivate?: () => void }) => (
    <div>
      {onDeactivate && <button type="button" onClick={onDeactivate}>Nonaktifkan baris</button>}
      {onActivate && <button type="button" onClick={onActivate}>Aktifkan baris</button>}
    </div>
  ),
}));

// Flatten each card to one "label: value" line so a card can be read exactly
// ("Aktif" also appears as a status badge / filter option elsewhere on the page).
vi.mock("@/components/admin/stat-card", () => ({
  StatCard: ({ label, value }: { label: string; value: string | number }) => (
    <p data-testid={`stat-${label}`}>{label}: {value}</p>
  ),
}));

// Desktop Dialog branch — same precedent as the holidays worked example.
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

// Base UI `Select` fights userEvent's open/close/positioning internals for
// no test value here (same precedent as
// app/admin/classes/[id]/__tests__/client.test.tsx) — swap in plain,
// always-rendered elements so these tests drive the real form state
// (useZodForm, FormField, submit) instead.
vi.mock("@/components/ui/select", () => {
  const SelectCtx = React.createContext<{ onValueChange?: (v: string) => void }>({});

  function Select({
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children: React.ReactNode;
  }) {
    return <SelectCtx.Provider value={{ onValueChange }}>{children}</SelectCtx.Provider>;
  }
  function SelectTrigger({ children, ...props }: React.ComponentProps<"button">) {
    return (
      <button type="button" {...props}>
        {children}
      </button>
    );
  }
  function SelectValue({ placeholder }: { placeholder?: string }) {
    return <span>{placeholder ?? null}</span>;
  }
  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }
  function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
    const ctx = React.useContext(SelectCtx);
    return (
      <div role="option" aria-selected={false} onClick={() => ctx.onValueChange?.(value)}>
        {children}
      </div>
    );
  }
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

import { toast } from "sonner";

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body };
}

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
  const { post = { id: "emp-9", kode: "BS1" }, postOk = true } = overrides;
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input.startsWith("/api/config/campuses")) {
      return Promise.resolve(jsonResponse([{ id: "c1", name: "Kampus Utama" }]));
    }
    if (input.startsWith("/api/employees/positions")) {
      return Promise.resolve(jsonResponse(["Guru Kelas"]));
    }
    if (input.startsWith("/api/employees/stats")) {
      return Promise.resolve(jsonResponse({ total: 0, active: 0, inactive: 0 }));
    }
    if (input === "/api/employees" && init?.method === "POST") {
      return Promise.resolve(jsonResponse(post, postOk, postOk ? 201 : 400));
    }
    if (input.startsWith("/api/employees?")) {
      return Promise.resolve(jsonResponse({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }));
    }
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("EmployeesPage list", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("makes the employee name the link into the detail page, with no separate Lihat action", async () => {
    const fetchMock = vi.fn((input: string) => {
      if (input.startsWith("/api/config/campuses")) return Promise.resolve(jsonResponse([]));
      if (input.startsWith("/api/employees/positions")) return Promise.resolve(jsonResponse([]));
      if (input.startsWith("/api/employees/stats")) {
        return Promise.resolve(jsonResponse({ total: 1, active: 1, inactive: 0 }));
      }
      if (input.startsWith("/api/employees?")) {
        return Promise.resolve(
          jsonResponse({
            data: [
              {
                id: "emp-1",
                kode: "K-001",
                nama: "Alya Putri",
                email: "alya@example.com",
                jabatan: "Guru Kelas",
                status: "ACTIVE",
                campusId: "c1",
                bankAccountNo: null,
                bpjsEnrolled: false,
                createdAt: "2026-01-01T00:00:00.000Z",
                campus: { name: "Taman Aster" },
              },
            ],
            pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<EmployeesPage />);

    const link = await screen.findByRole("link", { name: /Alya Putri/ });
    expect(link).toHaveAttribute("href", "/admin/employees/emp-1");
    expect(screen.queryByRole("button", { name: /Lihat/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Lihat")).not.toBeInTheDocument();
  });
});

describe("EmployeesPage stat cards (HR-13)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("refreshes TOTAL / AKTIF / TIDAK AKTIF after a deactivate without a reload", async () => {
    let deactivated = false;
    const employee = {
      id: "emp-1",
      kode: "K-001",
      nama: "Alya Putri",
      email: "alya@example.com",
      jabatan: "Guru Kelas",
      status: "ACTIVE",
      campusId: "c1",
      bankAccountNo: null,
      bpjsEnrolled: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      campus: { name: "Taman Aster" },
    };
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (input.startsWith("/api/config/campuses")) return Promise.resolve(jsonResponse([]));
      if (input.startsWith("/api/employees/positions")) return Promise.resolve(jsonResponse([]));
      if (input.startsWith("/api/employees/stats")) {
        return Promise.resolve(
          jsonResponse(deactivated ? { total: 3, active: 1, inactive: 2 } : { total: 3, active: 2, inactive: 1 }),
        );
      }
      if (input.endsWith("/deactivate") && init?.method === "POST") {
        deactivated = true;
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (input.startsWith("/api/employees?")) {
        return Promise.resolve(
          jsonResponse({
            data: [{ ...employee, status: deactivated ? "INACTIVE" : "ACTIVE" }],
            pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<EmployeesPage />);

    const card = (label: string) => screen.getByTestId(`stat-${label}`);
    await waitFor(() => expect(card("Aktif")).toHaveTextContent("Aktif: 2"));
    expect(card("Tidak Aktif")).toHaveTextContent("Tidak Aktif: 1");

    // The list renders more than once while its fetches settle, so a button
    // found early can be detached by the time it is clicked (the click is then
    // a no-op and the dialog never opens — a ~1-in-3 flake). Re-query and
    // click the live button until the confirm dialog is open.
    await waitFor(() => {
      if (!screen.queryByRole("alertdialog")) {
        fireEvent.click(screen.getByRole("button", { name: "Nonaktifkan baris" }));
      }
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Nonaktifkan" }));

    await waitFor(() => expect(card("Aktif")).toHaveTextContent("Aktif: 1"));
    expect(card("Tidak Aktif")).toHaveTextContent("Tidak Aktif: 2");
  });
});

describe("EmployeesPage — Tambah Karyawan dialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("blocks submit with empty required fields, showing inline errors and firing no POST", async () => {
    mockCoarsePointer();
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<EmployeesPage />);

    await user.click(await screen.findByRole("button", { name: "Tambah" }));
    const dialog = await screen.findByRole("dialog", { name: "Tambah Karyawan" });

    await user.click(within(dialog).getByRole("button", { name: "Tambah Karyawan" }));

    expect(await within(dialog).findByText("Nama wajib diisi")).toBeInTheDocument();
    expect(within(dialog).getByText("Email wajib diisi")).toBeInTheDocument();
    expect(within(dialog).getByText("Jabatan wajib diisi")).toBeInTheDocument();
    expect(within(dialog).getByText("Kampus wajib dipilih")).toBeInTheDocument();
    expect(within(dialog).getByText("Tanggal masuk wajib diisi")).toBeInTheDocument();

    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toBe(false);
  });

  it("submits the filled form as POST /api/employees with the expected body, then opens the new employee", async () => {
    mockCoarsePointer();
    const fetchMock = fixture({ post: { id: "emp-9", kode: "BS1" } });
    const user = userEvent.setup();
    render(<EmployeesPage />);

    await user.click(await screen.findByRole("button", { name: "Tambah" }));
    const dialog = await screen.findByRole("dialog", { name: "Tambah Karyawan" });

    await user.type(within(dialog).getByRole("textbox", { name: "Nama" }), "Budi Karyawan");
    await user.type(within(dialog).getByRole("textbox", { name: "Email" }), "budi@example.com");
    await user.click(await within(dialog).findByRole("option", { name: "Guru Kelas" }));
    await user.click(within(dialog).getByRole("option", { name: "Kampus Utama" }));
    fireEvent.change(within(dialog).getByLabelText("Tanggal Masuk", { exact: false }), {
      target: { value: "2026-03-01" },
    });
    // Bank defaults to "Bank BSI" (F-10 bank/rekening pair rule), so a
    // rekening is required once the form loads with that default filled.
    await user.type(within(dialog).getByRole("textbox", { name: "No. Rekening" }), "1234567890");

    await user.click(within(dialog).getByRole("button", { name: "Tambah Karyawan" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/employees" && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
    });

    const [, postInit] = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/employees" && (init as RequestInit | undefined)?.method === "POST",
    )!;
    expect(JSON.parse((postInit as RequestInit).body as string)).toEqual({
      nama: "Budi Karyawan",
      formalName: "",
      email: "budi@example.com",
      noHp: "",
      jabatan: "Guru Kelas",
      campusId: "c1",
      hireDate: "2026-03-01",
      bankName: "Bank BSI",
      bankAccountNo: "1234567890",
      bpjsEnrolled: false,
      role: "TEACHER",
    });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Karyawan ditambahkan (Kode: BS1)"));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/admin/employees/emp-9"));
  });

  it("caps the hire-date picker at today's Jakarta calendar day, not the UTC day (01:00 WIB = 18:00Z the day before)", async () => {
    mockCoarsePointer();
    fixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-04T18:00:00Z")); // 2026-10-05 01:00 WIB
      const user = userEvent.setup();
      render(<EmployeesPage />);

      await user.click(await screen.findByRole("button", { name: "Tambah" }));
      const dialog = await screen.findByRole("dialog", { name: "Tambah Karyawan" });

      expect(within(dialog).getByLabelText("Tanggal Masuk", { exact: false })).toHaveAttribute("max", "2026-10-05");
    } finally {
      vi.useRealTimers();
    }
  });
});
